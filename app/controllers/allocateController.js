const pool = require('../db/pool');
const { randomUUID } = require('crypto');
const { RESOURCE_TYPES } = require('../utils/constants');
const { parseBoolean, parseCoordinate, sendError } = require('../utils/http');

async function allocateResource(req, res) {
    const { incident_id } = req.params;
    const { incident_location, required_resource_type, required_capabilities = [] } = req.body;
    const idempotencyKey = req.get('Idempotency-Key');
    const dryRun = parseBoolean(req.query.dry_run, false);
    const latitude = parseCoordinate(incident_location?.lat);
    const longitude = parseCoordinate(incident_location?.long);

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
    try {
        await client.query('BEGIN');

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
            await client.query('ROLLBACK');
            return res.status(200).json({
                allocation_id: null,
                incident_id,
                status: 'SIMULATED',
                dry_run: true,
                resource: {
                    resource_id: resrc.resource_id,
                    resource_type: required_resource_type,
                    driver_contact: resrc.driver_contact
                },
                distance_km: Number.parseFloat(Number(resrc.dist_km).toFixed(2)),
                trace_id: req.traceId
            });
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
            return sendError(
                res,
                409,
                req.traceId,
                'RESOURCE_BUSY_CONFLICT',
                'The optimal resource was locked by another transaction. Please retry.',
                { attempted_resource_id: resrc.resource_id }
            );
        }

        await client.query('COMMIT');

        res.status(201).json({
            allocation_id: `ALLOC-${Date.now()}`,
            incident_id,
            status: 'ASSIGNED',
            resource: {
                resource_id: resrc.resource_id,
                resource_type: required_resource_type,
                driver_contact: resrc.driver_contact
            },
            distance_km: Number.parseFloat(Number(resrc.dist_km).toFixed(2)),
            trace_id: req.traceId
        });

    } catch (err) {
        await client.query('ROLLBACK');
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
