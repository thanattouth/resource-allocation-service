const pool = require('../db/pool');
const { randomUUID } = require('crypto');
const { RESOURCE_TYPES } = require('../utils/constants');
const { isDatabaseTimeoutError, setLocalStatementTimeout } = require('../utils/db');
const { parseBoolean, parseCoordinate, sendError, sendTimeoutError } = require('../utils/http');
const { calculateEstimatedArrivalTimeMinutes } = require('../domain/allocation');
const { buildRequestFingerprint } = require('../utils/idempotency');
const {
    buildIdentifierContext,
    hasAnyRequestIdentifier,
    resolveRequestIdentifiers,
    toIdentifierPayload
} = require('../utils/requestIdentifiers');
const {
    claimIdempotencyRecord,
    completeIdempotencyRecord,
    releaseIdempotencyRecord
} = require('../utils/dynamoIdempotency');

function buildAllocationResponse({
    allocationId,
    incidentId,
    requestId,
    requiredResourceType,
    resourceId,
    driverContact,
    destination,
    distanceKm,
    version,
    traceId,
    dryRun = false
}) {
    const roundedDistanceKm = Number.parseFloat(Number(distanceKm).toFixed(2));

    return {
        allocation_id: dryRun ? null : allocationId,
        ...toIdentifierPayload({ incidentId, requestId }),
        status: dryRun ? 'SIMULATED' : 'ASSIGNED',
        dry_run: dryRun,
        resource: {
            resource_id: resourceId,
            resource_type: requiredResourceType,
            driver_contact: driverContact
        },
        destination,
        estimated_arrival_time_mins: calculateEstimatedArrivalTimeMinutes(roundedDistanceKm),
        distance_km: roundedDistanceKm,
        version: Number.isInteger(Number(version)) ? Number(version) : undefined,
        trace_id: traceId
    };
}

async function allocateResource(req, res) {
    const {
        incident_id: bodyIncidentId,
        request_id: bodyRequestId,
        incident_location,
        destination,
        required_resource_type,
        required_capabilities = [],
        severity = 'MEDIUM'
    } = req.body;
    const { incidentId, requestId, conflicts } = resolveRequestIdentifiers({
        pathIncidentId: req.params.incident_id,
        pathRequestId: req.params.request_id,
        bodyIncidentId,
        bodyRequestId
    });
    const idempotencyKey = req.get('Idempotency-Key');
    const dryRun = parseBoolean(req.query.dry_run, false);
    const destinationLatitude = parseCoordinate(destination?.location?.lat);
    const destinationLongitude = parseCoordinate(destination?.location?.long);
    // Search for nearest resource using destination.location if provided, otherwise incident_location
    const searchLatitude = parseCoordinate(destination?.location?.lat ?? incident_location?.lat);
    const searchLongitude = parseCoordinate(destination?.location?.long ?? incident_location?.long);
    // incident_location is always stored in DB for multi-leg journeys
    const incidentLatitude = parseCoordinate(incident_location?.lat);
    const incidentLongitude = parseCoordinate(incident_location?.long);
    const identifierContext = buildIdentifierContext({ incidentId, requestId });
    const requestFingerprint = buildRequestFingerprint({
        ...identifierContext,
        dry_run: dryRun,
        incident_location,
        destination,
        required_resource_type,
        required_capabilities,
        severity
    });

    if (!idempotencyKey) {
        return sendError(
            res,
            400,
            req.traceId,
            'MISSING_IDEMPOTENCY_KEY',
            'Idempotency-Key header is required for allocation requests.'
        );
    }

    if (conflicts.length > 0) {
        return sendError(
            res,
            400,
            req.traceId,
            'IDENTIFIER_CONFLICT',
            `Conflicting identifier values were provided for: ${conflicts.join(', ')}.`
        );
    }

    if (!hasAnyRequestIdentifier({ incidentId, requestId })) {
        return sendError(
            res,
            400,
            req.traceId,
            'MISSING_REQUEST_IDENTIFIER',
            'At least one of incident_id or request_id is required.'
        );
    }

    if (searchLatitude === null || searchLongitude === null || searchLatitude < -90 || searchLatitude > 90 || searchLongitude < -180 || searchLongitude > 180) {
        return sendError(
            res,
            400,
            req.traceId,
            'INVALID_INCIDENT_LOCATION',
            'incident_location.lat and incident_location.long must be valid coordinates (or fallback to destination.location).'
        );
    }

    if (!destination || !destination.destination_type) {
        return sendError(
            res,
            400,
            req.traceId,
            'INVALID_DESTINATION',
            'destination.destination_type is required.'
        );
    }

    if (
        destinationLatitude === null ||
        destinationLongitude === null ||
        destinationLatitude < -90 ||
        destinationLatitude > 90 ||
        destinationLongitude < -180 ||
        destinationLongitude > 180
    ) {
        return sendError(
            res,
            400,
            req.traceId,
            'INVALID_DESTINATION_LOCATION',
            'destination.location.lat and destination.location.long must be valid coordinates.'
        );
    }

    if (!required_resource_type || !RESOURCE_TYPES.includes(required_resource_type)) {
        return sendError(
            res,
            400,
            req.traceId,
            'INVALID_RESOURCE_TYPE',
            `required_resource_type must be one of: ${RESOURCE_TYPES.join(', ')}`
        );
    }

    if (!Array.isArray(required_capabilities)) {
        return sendError(
            res,
            400,
            req.traceId,
            'INVALID_CAPABILITIES',
            'required_capabilities must be an array.'
        );
    }

    let idempotencyClaimed = false;
    let idempotencyCompleted = false;

    let claimResult;
    try {
        claimResult = await claimIdempotencyRecord({
            idempotencyKey,
            identifierContext,
            requestFingerprint
        });
    } catch (error) {
        console.error('[allocate] DynamoDB claim error:', error.message);
        return sendError(
            res,
            500,
            req.traceId,
            'IDEMPOTENCY_STORE_UNAVAILABLE',
            'Unable to verify idempotency for this request.'
        );
    }

    if (claimResult.kind === 'RETRY') {
        return sendError(
            res,
            409,
            req.traceId,
            'IDEMPOTENCY_RETRY_REQUIRED',
            'Idempotency state could not be confirmed. Please retry the same request.'
        );
    }

    if (claimResult.kind === 'CONFLICT') {
        return sendError(
            res,
            409,
            req.traceId,
            'IDEMPOTENCY_KEY_REUSED',
            'This Idempotency-Key was already used with a different request payload.'
        );
    }

    if (claimResult.kind === 'REPLAY') {
        const responsePayload = {
            ...claimResult.responsePayload,
            trace_id: req.traceId
        };
        return res.status(responsePayload.dry_run ? 200 : 201).json(responsePayload);
    }

    if (claimResult.kind === 'PROCESSING') {
        return sendError(
            res,
            409,
            req.traceId,
            'IDEMPOTENCY_REQUEST_IN_PROGRESS',
            'An identical request with this Idempotency-Key is still being processed.'
        );
    }

    idempotencyClaimed = true;

    const client = await pool.connect();
    let transactionOpen = false;
    let transactionCommitted = false;
    try {
        await client.query('BEGIN');
        transactionOpen = true;
        await setLocalStatementTimeout(client);

        const findQuery = `
            SELECT resource_id, version, driver_contact,
                ST_Distance(current_location::geography, ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography) / 1000 AS dist_km
            FROM resources 
            WHERE status = 'AVAILABLE'
              AND resource_type = $3
              AND capabilities @> $4::jsonb
            ORDER BY current_location <-> ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography
            LIMIT 1 FOR UPDATE SKIP LOCKED;
        `;
        const findRes = await client.query(findQuery, [
            searchLatitude,
            searchLongitude,
            required_resource_type,
            JSON.stringify(required_capabilities)
        ]);

        if (findRes.rowCount === 0) {
            await client.query('ROLLBACK');
            transactionOpen = false;
            if (idempotencyClaimed) {
                await releaseIdempotencyRecord(idempotencyKey);
                idempotencyClaimed = false;
            }
            return sendError(
                res,
                404,
                req.traceId,
                'RESOURCE_NOT_FOUND',
                'No matching resource is currently available.'
            );
        }

        const resrc = findRes.rows[0];

        if (dryRun) {
            const responsePayload = buildAllocationResponse({
                allocationId: null,
                incidentId,
                requestId,
                requiredResourceType: required_resource_type,
                resourceId: resrc.resource_id,
                driverContact: resrc.driver_contact,
                destination,
                distanceKm: Number(resrc.dist_km),
                version: Number(resrc.version),
                traceId: req.traceId,
                dryRun: true
            });

            await client.query('COMMIT');
            transactionOpen = false;
            transactionCommitted = true;
            await completeIdempotencyRecord({
                idempotencyKey,
                allocationId: null,
                responsePayload
            });
            idempotencyCompleted = true;
            return res.status(200).json(responsePayload);
        }

        const updateQuery = `
            UPDATE resources
            SET status = 'EN_ROUTE',
                assigned_incident_id = $1,
                assigned_request_id = $2,
                version = version + 1,
                destination_location = ST_SetSRID(ST_MakePoint($4, $3), 4326)::geography,
                incident_location = CASE WHEN $10::float8 IS NOT NULL AND $11::float8 IS NOT NULL
                    THEN ST_SetSRID(ST_MakePoint($11::float8, $10::float8), 4326)::geography
                    ELSE NULL
                END,
                destination_type = $5,
                destination_id = COALESCE($6, destination_id),
                destination_name = $7
            WHERE resource_id = $8 AND version = $9
            RETURNING *;
        `;
        const updateRes = await client.query(updateQuery, [
            incidentId,
            requestId,
            destinationLatitude,
            destinationLongitude,
            destination.destination_type,
            destination.destination_id || null,
            destination.destination_name || null,
            resrc.resource_id,
            resrc.version,
            incidentLatitude,
            incidentLongitude
        ]);

        if (updateRes.rowCount === 0) {
            await client.query('ROLLBACK');
            transactionOpen = false;
            if (idempotencyClaimed) {
                await releaseIdempotencyRecord(idempotencyKey);
                idempotencyClaimed = false;
            }
            return sendError(
                res,
                409,
                req.traceId,
                'RESOURCE_BUSY_CONFLICT',
                'The optimal resource was locked by another transaction. Please retry.',
                { attempted_resource_id: resrc.resource_id }
            );
        }

        const allocationId = `ALLOC-${Date.now()}`;
        const responsePayload = buildAllocationResponse({
            allocationId,
            incidentId,
            requestId,
            requiredResourceType: required_resource_type,
            resourceId: resrc.resource_id,
            driverContact: resrc.driver_contact,
            destination,
            distanceKm: Number(resrc.dist_km),
            version: Number(updateRes.rows[0].version),
            traceId: req.traceId
        });

        await client.query('COMMIT');
        transactionOpen = false;
        transactionCommitted = true;
        await completeIdempotencyRecord({
            idempotencyKey,
            allocationId,
            responsePayload
        });
        idempotencyCompleted = true;

        res.status(201).json(responsePayload);

    } catch (err) {
        if (transactionOpen) {
            try {
                await client.query('ROLLBACK');
            } catch (rollbackError) {
                console.error('[allocate] Rollback error:', rollbackError.message);
            }
        }
        console.error('[allocate] Error:', err.message);

        if (isDatabaseTimeoutError(err)) {
            return sendTimeoutError(
                res,
                503,
                req.traceId || randomUUID(),
                'DB_TIMEOUT',
                'Database query timed out while allocating a resource.'
            );
        }

        if (idempotencyClaimed && !idempotencyCompleted && !transactionCommitted) {
            try {
                await releaseIdempotencyRecord(idempotencyKey);
            } catch (releaseError) {
                console.error('[allocate] DynamoDB release error:', releaseError.message);
            }
        }
        return sendError(
            res,
            500,
            req.traceId || randomUUID(),
            'ALLOCATION_FAILED',
            'Unable to allocate a resource at this time.'
        );
    } finally {
        client.release();
    }
}

module.exports = allocateResource;
