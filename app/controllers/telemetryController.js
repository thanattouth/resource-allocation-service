const pool = require('../db/pool');
const { RESOURCE_STATUSES } = require('../utils/constants');
const { isDatabaseTimeoutError, runInStatementTimeoutSession } = require('../utils/db');
const { parseCoordinate, sendError, sendTimeoutError } = require('../utils/http');
const {
    publishIncidentCompletedEvent,
    publishPowerGridCompletedEvent,
    publishRequestCompletedEvent
} = require('../utils/eventPublisher');
const { validateStatusTransition } = require('../domain/resourceState');
const { isUuidResourceId } = require('../utils/resourceId');

function isCompletionTransition(previousStatus, nextStatus) {
    if (!nextStatus) {
        return false;
    }

    const completionStatuses = ['RETURNING', 'AVAILABLE'];
    const activeCompletionOrigins = ['ON_SITE', 'TRANSPORTING'];

    return completionStatuses.includes(nextStatus) && activeCompletionOrigins.includes(previousStatus);
}

async function updateTelemetry(req, res) {
    const { resource_id } = req.params;
    const {
        status,
        battery_level,
        version,
        current_location,
        location,
        lat,
        long,
        destination
    } = req.body;

    const currentLat = parseCoordinate(current_location?.lat ?? location?.lat ?? lat);
    const currentLong = parseCoordinate(current_location?.long ?? location?.long ?? long);
    const destinationLat = parseCoordinate(destination?.location?.lat);
    const destinationLong = parseCoordinate(destination?.location?.long);
    const battery = battery_level === undefined || battery_level === null
        ? null
        : Number.parseFloat(battery_level);

    if (!resource_id) {
        return sendError(
            res,
            400,
            req.traceId,
            'INVALID_RESOURCE_ID',
            'resource_id path parameter is required.'
        );
    }

    if (!isUuidResourceId(resource_id)) {
        return sendError(
            res,
            400,
            req.traceId,
            'INVALID_RESOURCE_ID',
            'resource_id must be a valid UUID.'
        );
    }

    if (version === undefined || !Number.isInteger(Number(version))) {
        return sendError(
            res,
            400,
            req.traceId,
            'INVALID_VERSION',
            'version is required and must be an integer.'
        );
    }

    if (status && !RESOURCE_STATUSES.includes(status)) {
        return sendError(
            res,
            400,
            req.traceId,
            'INVALID_STATUS',
            `status must be one of: ${RESOURCE_STATUSES.join(', ')}`
        );
    }

    if ((currentLat !== null && (currentLat < -90 || currentLat > 90)) || (currentLong !== null && (currentLong < -180 || currentLong > 180))) {
        return sendError(
            res,
            400,
            req.traceId,
            'INVALID_CURRENT_LOCATION',
            'current_location must contain valid lat/long coordinates.'
        );
    }

    if (battery !== null && (!Number.isFinite(battery) || battery < 0 || battery > 100)) {
        return sendError(
            res,
            400,
            req.traceId,
            'INVALID_BATTERY_LEVEL',
            'battery_level must be between 0 and 100.'
        );
    }

    try {
        const outcome = await runInStatementTimeoutSession(pool, async (client) => {
            const existingResourceResult = await client.query(
                `
                    SELECT resource_id, status, assigned_incident_id, destination_location, version,
                           assigned_request_id, destination_type, destination_id, destination_name, resource_type,
                           CASE
                               WHEN current_location IS NOT NULL THEN json_build_object(
                                   'lat', ST_Y(current_location::geometry),
                                   'long', ST_X(current_location::geometry)
                               )
                               ELSE NULL
                           END AS current_location_point,
                           CASE
                               WHEN destination_location IS NOT NULL THEN json_build_object(
                                   'lat', ST_Y(destination_location::geometry),
                                   'long', ST_X(destination_location::geometry)
                               )
                               ELSE NULL
                           END AS destination_location_point,
                           CASE
                               WHEN incident_location IS NOT NULL THEN json_build_object(
                                   'lat', ST_Y(incident_location::geometry),
                                   'long', ST_X(incident_location::geometry)
                               )
                               ELSE NULL
                           END AS incident_location_point
                    FROM resources
                    WHERE resource_id = $1::uuid
                `,
                [resource_id]
            );

            if (existingResourceResult.rowCount === 0) {
                return {
                    type: 'ERROR',
                    response: sendError(
                        res,
                        404,
                        req.traceId,
                        'RESOURCE_NOT_FOUND',
                        `Resource ID ${resource_id} does not exist.`
                    )
                };
            }

            const currentResource = existingResourceResult.rows[0];
            const transitionError = validateStatusTransition(currentResource, status);

            if (transitionError) {
                return {
                    type: 'ERROR',
                    response: sendError(
                        res,
                        409,
                        req.traceId,
                        transitionError.errorCode,
                        transitionError.message
                    )
                };
            }

            const hasNewDestination = destination && destination.destination_type &&
                destinationLat !== null && destinationLong !== null;

            // Volunteer / supply pickup flow: ON_SITE -> EN_ROUTE without new destination
            // means go to incident_location
            const isPickupToIncident = !!(status === 'EN_ROUTE' &&
                currentResource.status === 'ON_SITE' &&
                (currentResource.destination_type === 'PICKUP_VOLUNTEER' ||
                 currentResource.destination_type === 'PICKUP_SUPPLY') &&
                !hasNewDestination &&
                currentResource.incident_location_point);

            const pickupIncidentLat = isPickupToIncident
                ? currentResource.incident_location_point.lat : null;
            const pickupIncidentLong = isPickupToIncident
                ? currentResource.incident_location_point.long : null;

            const query = `
                UPDATE resources SET
                    status = COALESCE($1, status),
                    current_location = CASE
                        WHEN $2::float8 IS NOT NULL AND $3::float8 IS NOT NULL
                        THEN ST_SetSRID(ST_MakePoint($3::float8, $2::float8), 4326)::geography
                        WHEN destination_location IS NOT NULL
                        THEN destination_location
                        ELSE current_location
                    END,
                    battery_level = COALESCE($4::float8, battery_level),
                    assigned_incident_id = CASE WHEN $1 = 'AVAILABLE' THEN NULL ELSE assigned_incident_id END,
                    assigned_request_id = CASE WHEN $1 = 'AVAILABLE' THEN NULL ELSE assigned_request_id END,
                    destination_location = CASE
                        WHEN $1 = 'AVAILABLE' THEN NULL
                        WHEN $7::boolean = true AND $8::float8 IS NOT NULL AND $9::float8 IS NOT NULL
                        THEN ST_SetSRID(ST_MakePoint($9::float8, $8::float8), 4326)::geography
                        WHEN $13::boolean = true AND $14::float8 IS NOT NULL AND $15::float8 IS NOT NULL
                        THEN ST_SetSRID(ST_MakePoint($15::float8, $14::float8), 4326)::geography
                        ELSE destination_location
                    END,
                    destination_type = CASE
                        WHEN $1 = 'AVAILABLE' THEN NULL
                        WHEN $7::boolean = true THEN $10
                        WHEN $13::boolean = true THEN 'INCIDENT'
                        ELSE destination_type
                    END,
                    destination_id = CASE
                        WHEN $1 = 'AVAILABLE' THEN NULL
                        WHEN $7::boolean = true THEN COALESCE($11, destination_id)
                        WHEN $13::boolean = true THEN assigned_incident_id
                        ELSE destination_id
                    END,
                    destination_name = CASE
                        WHEN $1 = 'AVAILABLE' THEN NULL
                        WHEN $7::boolean = true THEN COALESCE($12, destination_name)
                        ELSE destination_name
                    END,
                    incident_location = CASE WHEN $1 = 'AVAILABLE' THEN NULL ELSE incident_location END,
                    last_updated_at = CURRENT_TIMESTAMP,
                    version = version + 1
                WHERE resource_id = $5::uuid AND version = $6::int
                RETURNING resource_id, status, battery_level, version, last_updated_at,
                          assigned_incident_id, assigned_request_id, destination_type, destination_id, destination_name,
                          resource_type,
                          CASE
                              WHEN current_location IS NOT NULL THEN json_build_object(
                                  'lat', ST_Y(current_location::geometry),
                                  'long', ST_X(current_location::geometry)
                              )
                              ELSE NULL
                          END AS current_location_point,
                          CASE
                              WHEN destination_location IS NOT NULL THEN json_build_object(
                                  'lat', ST_Y(destination_location::geometry),
                                  'long', ST_X(destination_location::geometry)
                              )
                              ELSE NULL
                          END AS destination_location_point;
            `;

            const result = await client.query(query, [
                status,
                currentLat,
                currentLong,
                battery,
                resource_id,
                Number(version),
                hasNewDestination,
                destinationLat,
                destinationLong,
                hasNewDestination ? destination.destination_type : null,
                hasNewDestination ? (destination.destination_id || null) : null,
                hasNewDestination ? (destination.destination_name || null) : null,
                isPickupToIncident,
                pickupIncidentLat,
                pickupIncidentLong
            ]);

            if (result.rowCount === 0) {
                return {
                    type: 'ERROR',
                    response: sendError(
                        res,
                        409,
                        req.traceId,
                        'VERSION_CONFLICT',
                        'Resource version mismatch. Please fetch the latest resource state and retry.'
                    )
                };
            }

            return {
                type: 'SUCCESS',
                payload: result.rows[0],
                previousResource: currentResource
            };
        });

        if (outcome.type === 'ERROR') {
            return outcome.response;
        }

        const updated = outcome.payload;

        const completionTransition = isCompletionTransition(
            outcome.previousResource?.status,
            updated.status
        );

        const publishedEvents = [];

        if (completionTransition) {
            const completionEventInput = {
                incidentId: outcome.previousResource?.assigned_incident_id,
                requestId: outcome.previousResource?.assigned_request_id,
                resourceId: updated.resource_id,
                resourceType: updated.resource_type,
                finalStatus: updated.status,
                completedAt: updated.last_updated_at,
                destination: outcome.previousResource?.destination_id
                    ? {
                        destination_type: outcome.previousResource.destination_type,
                        destination_id: outcome.previousResource.destination_id,
                        destination_name: outcome.previousResource.destination_name || undefined,
                        shelter_id: outcome.previousResource.destination_type === 'SHELTER'
                            ? outcome.previousResource.destination_id
                            : undefined
                    }
                    : undefined
            };

            // Only publish REQUEST_COMPLETED and INCIDENT_COMPLETED when coming from
            // TRANSPORTING status (i.e. after transport-start shelter evacuation)
            const isTransportCompletion = outcome.previousResource?.status === 'TRANSPORTING';

            if (isTransportCompletion && completionEventInput.requestId) {
                try {
                    await publishRequestCompletedEvent(completionEventInput, { traceId: req.traceId });
                    publishedEvents.push({ event_type: 'REQUEST_COMPLETED', status: 'PUBLISHED' });
                } catch (publishError) {
                    console.error('[telemetry] Failed to publish request completion event:', publishError.message);
                    publishedEvents.push({ event_type: 'REQUEST_COMPLETED', status: 'FAILED', error: publishError.message });
                }
            }

            if (isTransportCompletion && completionEventInput.incidentId) {
                try {
                    await publishIncidentCompletedEvent(completionEventInput, { traceId: req.traceId });
                    publishedEvents.push({ event_type: 'INCIDENT_COMPLETED', status: 'PUBLISHED' });
                } catch (publishError) {
                    console.error('[telemetry] Failed to publish incident completion event:', publishError.message);
                    publishedEvents.push({ event_type: 'INCIDENT_COMPLETED', status: 'FAILED', error: publishError.message });
                }
            }

            // Publish POWERGRID_COMPLETED for all POWER_GENERATOR_TRUCK completions
            // regardless of destination_type (POWER_NODE or PICKUP_VOLUNTEER)
            if (updated.resource_type === 'POWER_GENERATOR_TRUCK') {
                try {
                    await publishPowerGridCompletedEvent(completionEventInput, { traceId: req.traceId });
                    publishedEvents.push({ event_type: 'POWERGRID_COMPLETED', status: 'PUBLISHED' });
                } catch (publishError) {
                    console.error('[telemetry] Failed to publish powergrid completion event:', publishError.message);
                    publishedEvents.push({ event_type: 'POWERGRID_COMPLETED', status: 'FAILED', error: publishError.message });
                }
            }
        }

        res.json({
            resource_id: updated.resource_id,
            status: updated.status,
            server_instruction: 'CONTINUE',
            version: updated.version,
            last_updated_at: updated.last_updated_at,
            trace_id: req.traceId,
            ...(publishedEvents.length > 0 && { published_events: publishedEvents })
        });

    } catch (err) {
        console.error('[telemetry] Error:', err.message);
        if (isDatabaseTimeoutError(err)) {
            return sendTimeoutError(
                res,
                503,
                req.traceId,
                'DB_TIMEOUT',
                'Database query timed out while updating telemetry.'
            );
        }

        return sendError(
            res,
            500,
            req.traceId,
            'TELEMETRY_UPDATE_FAILED',
            `Unable to update telemetry: ${err.message}`
        );
    }
}

module.exports = updateTelemetry;
