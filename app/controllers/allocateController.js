const pool = require('../db/pool');
const { randomUUID } = require('crypto');

async function allocateResource(req, res) {
    const { incident_id } = req.params;
    const { incident_location, required_resource_type, required_capabilities = [] } = req.body;

    if (!incident_location?.lat || !incident_location?.long || !required_resource_type) {
        return res.status(400).json({ error: 'Missing required fields' });
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
            incident_location.lat,
            incident_location.long,
            required_resource_type,
            JSON.stringify(required_capabilities)
        ]);

        if (findRes.rowCount === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ status: 'FAILED', message: 'No resource found' });
        }

        const resrc = findRes.rows[0];

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
            incident_location.lat,
            incident_location.long,
            resrc.resource_id,
            resrc.version
        ]);

        if (updateRes.rowCount === 0) {
            await client.query('ROLLBACK');
            return res.status(409).json({
                error_code: 'RESOURCE_BUSY_CONFLICT',
                message: 'The optimal resource was locked by another transaction. Please retry.',
                trace_id: randomUUID(),
                details: { attempted_resource_id: resrc.resource_id }
            });
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
            distance_km: parseFloat(resrc.dist_km.toFixed(2))
        });

    } catch (err) {
        await client.query('ROLLBACK');
        console.error('[allocate] Error:', err.message);
        res.status(500).json({ error: err.message, trace_id: randomUUID() });
    } finally {
        client.release();
    }
}

module.exports = allocateResource;
