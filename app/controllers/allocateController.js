const pool = require('../db/pool');
const { randomUUID } = require('crypto');
const { RESOURCE_TYPES } = require('../utils/constants');
const { parseBoolean, parseCoordinate, sendError } = require('../utils/http');
const { calculateEstimatedArrivalTimeMinutes } = require('../domain/allocation');
const { buildRequestFingerprint } = require('../utils/idempotency');

function buildAllocationResponse({
    allocationId,
    incidentId,
    requiredResourceType,
    resourceId,
    driverContact,
    distanceKm,
    traceId,
    dryRun = false
}) {
    const roundedDistanceKm = Number.parseFloat(Number(distanceKm).toFixed(2));

    return {
        allocation_id: dryRun ? null : allocationId,
        incident_id: incidentId,
        status: dryRun ? 'SIMULATED' : 'ASSIGNED',
        dry_run: dryRun,
        resource: {
            resource_id: resourceId,
            resource_type: requiredResourceType,
            driver_contact: driverContact
        },
        estimated_arrival_time_mins: calculateEstimatedArrivalTimeMinutes(roundedDistanceKm),
        distance_km: roundedDistanceKm,
        trace_id: traceId
    };
}

async function allocateResource(req, res) {
    const { incident_id } = req.params;
    const { incident_location, required_resource_type, required_capabilities = [], severity = 'MEDIUM' } = req.body;
    const idempotencyKey = req.get('Idempotency-Key');
    const dryRun = parseBoolean(req.query.dry_run, false);
    const latitude = parseCoordinate(incident_location?.lat);
    const longitude = parseCoordinate(incident_location?.long);
    const requestFingerprint = buildRequestFingerprint({
        incident_id,
        dry_run: dryRun,
        incident_location,
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

    if (!incident_id) {
        return sendError(
            res,
            400,
            req.traceId,
            'INVALID_INCIDENT_ID',
            'incident_id path parameter is required.'
        );
    }

    if (latitude === null || longitude === null || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
        return sendError(
            res,
            400,
            req.traceId,
            'INVALID_INCIDENT_LOCATION',
            'incident_location.lat and incident_location.long must be valid coordinates.'
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

    const client = await pool.connect();
    let transactionOpen = false;
    try {
        await client.query('BEGIN');
        transactionOpen = true;

        const existingIdempotency = await client.query(
            `
                SELECT incident_id, request_fingerprint, response_payload, status
                FROM allocation_requests
                WHERE idempotency_key = $1
                FOR UPDATE
            `,
            [idempotencyKey]
        );

        if (existingIdempotency.rowCount > 0) {
            const record = existingIdempotency.rows[0];

            if (record.request_fingerprint !== requestFingerprint || record.incident_id !== incident_id) {
                await client.query('ROLLBACK');
                return sendError(
                    res,
                    409,
                    req.traceId,
                    'IDEMPOTENCY_KEY_REUSED',
                    'This Idempotency-Key was already used with a different request payload.'
                );
            }

            if (record.status === 'COMPLETED' && record.response_payload) {
                await client.query('COMMIT');
                transactionOpen = false;
                return res.status(dryRun ? 200 : 201).json({
                    ...record.response_payload,
                    trace_id: req.traceId
                });
            }
        } else {
            await client.query(
                `
                    INSERT INTO allocation_requests (idempotency_key, incident_id, request_fingerprint, status)
                    VALUES ($1, $2, $3, 'PROCESSING')
                `,
                [idempotencyKey, incident_id, requestFingerprint]
            );
        }

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
            latitude,
            longitude,
            required_resource_type,
            JSON.stringify(required_capabilities)
        ]);

        if (findRes.rowCount === 0) {
            await client.query('ROLLBACK');
            transactionOpen = false;
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
                incidentId: incident_id,
                requiredResourceType: required_resource_type,
                resourceId: resrc.resource_id,
                driverContact: resrc.driver_contact,
                distanceKm: Number(resrc.dist_km),
                traceId: req.traceId,
                dryRun: true
            });

            await client.query(
                `
                    UPDATE allocation_requests
                    SET response_payload = $2::jsonb,
                        status = 'COMPLETED',
                        updated_at = CURRENT_TIMESTAMP
                    WHERE idempotency_key = $1
                `,
                [idempotencyKey, JSON.stringify(responsePayload)]
            );
            await client.query('COMMIT');
            transactionOpen = false;
            return res.status(200).json(responsePayload);
        }

        const updateQuery = `
            UPDATE resources
            SET status = 'EN_ROUTE',
                assigned_incident_id = $1,
                version = version + 1,
                destination_location = ST_SetSRID(ST_MakePoint($3, $2), 4326)::geography
            WHERE resource_id = $4 AND version = $5
            RETURNING *;
        `;
        const updateRes = await client.query(updateQuery, [
            incident_id,
            latitude,
            longitude,
            resrc.resource_id,
            resrc.version
        ]);

        if (updateRes.rowCount === 0) {
            await client.query('ROLLBACK');
            transactionOpen = false;
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
            incidentId: incident_id,
            requiredResourceType: required_resource_type,
            resourceId: resrc.resource_id,
            driverContact: resrc.driver_contact,
            distanceKm: Number(resrc.dist_km),
            traceId: req.traceId
        });

        await client.query(
            `
                UPDATE allocation_requests
                SET allocation_id = $2,
                    response_payload = $3::jsonb,
                    status = 'COMPLETED',
                    updated_at = CURRENT_TIMESTAMP
                WHERE idempotency_key = $1
            `,
            [idempotencyKey, allocationId, JSON.stringify(responsePayload)]
        );

        await client.query('COMMIT');
        transactionOpen = false;
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
