const pool = require('../db/pool');
const { RESOURCE_STATUSES } = require('../utils/constants');
const { isDatabaseTimeoutError, runInStatementTimeoutSession } = require('../utils/db');
const { parseCoordinate, sendError, sendTimeoutError } = require('../utils/http');
const {
    calculateDistanceKm,
    calculateEstimatedArrivalTimeMinutes,
    shouldPublishEtaUpdate
} = require('../domain/allocation');
const { publishPowerGridEtaUpdatedEvent } = require('../utils/eventPublisher');
const { validateStatusTransition } = require('../domain/resourceState');
const { isUuidResourceId } = require('../utils/resourceId');

async function updateTelemetry(req, res) {
    const { resource_id } = req.params;
    const {
        status,
        battery_level,
        version,
        current_location,
        lat,
        long
    } = req.body;

    const currentLat = parseCoordinate(current_location?.lat ?? lat);
    const currentLong = parseCoordinate(current_location?.long ?? long);
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
                           destination_type, destination_id, destination_name, resource_type,
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
                           END AS destination_location_point
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

            const query = `
                UPDATE resources SET
                    status = COALESCE($1, status),
                    current_location = CASE
                        WHEN $2::float8 IS NOT NULL AND $3::float8 IS NOT NULL
                        THEN ST_SetSRID(ST_MakePoint($3::float8, $2::float8), 4326)::geography
                        ELSE current_location
                    END,
                    battery_level = COALESCE($4::float8, battery_level),
                    assigned_incident_id = CASE WHEN $1 = 'AVAILABLE' THEN NULL ELSE assigned_incident_id END,
                    destination_location = CASE WHEN $1 = 'AVAILABLE' THEN NULL ELSE destination_location END,
                    destination_type = CASE WHEN $1 = 'AVAILABLE' THEN NULL ELSE destination_type END,
                    destination_id = CASE WHEN $1 = 'AVAILABLE' THEN NULL ELSE destination_id END,
                    destination_name = CASE WHEN $1 = 'AVAILABLE' THEN NULL ELSE destination_name END,
                    last_updated_at = CURRENT_TIMESTAMP,
                    version = version + 1
                WHERE resource_id = $5::uuid AND version = $6::int
                RETURNING resource_id, status, battery_level, version, last_updated_at,
                          assigned_incident_id, destination_type, destination_id, destination_name,
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
                Number(version)
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
        const shouldEvaluatePowerGridEta =
            updated.status === 'EN_ROUTE' &&
            updated.destination_type === 'POWER_NODE' &&
            updated.destination_id &&
            updated.destination_location_point;

        if (shouldEvaluatePowerGridEta) {
            const previousDistanceKm = calculateDistanceKm(
                outcome.previousResource?.current_location_point,
                outcome.previousResource?.destination_location_point
            );
            const nextDistanceKm = calculateDistanceKm(
                updated.current_location_point,
                updated.destination_location_point
            );
            const previousEtaMinutes = calculateEstimatedArrivalTimeMinutes(previousDistanceKm);
            const nextEtaMinutes = calculateEstimatedArrivalTimeMinutes(nextDistanceKm);

            if (shouldPublishEtaUpdate(previousEtaMinutes, nextEtaMinutes)) {
                try {
                    await publishPowerGridEtaUpdatedEvent(
                        {
                            incidentId: updated.assigned_incident_id,
                            allocationId: null,
                            resourceId: updated.resource_id,
                            resourceType: updated.resource_type,
                            destination: {
                                destination_type: updated.destination_type,
                                destination_id: updated.destination_id,
                                destination_name: updated.destination_name || undefined
                            },
                            status: updated.status,
                            etaMinutes: nextEtaMinutes
                        },
                        { traceId: req.traceId }
                    );
                } catch (publishError) {
                    console.error('[telemetry] Failed to publish powergrid ETA event:', publishError.message);
                }
            }
        }

        res.json({
            resource_id: updated.resource_id,
            status: updated.status,
            server_instruction: 'CONTINUE',
            version: updated.version,
            last_updated_at: updated.last_updated_at,
            trace_id: req.traceId
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
            'Unable to update telemetry at this time.'
        );
    }
}

module.exports = updateTelemetry;
