const pool = require('../db/pool');

async function updateTelemetry(req, res) {
    const { resource_id } = req.params;
    const { status, lat, long, battery_level, version, new_dest_lat, new_dest_long } = req.body;

    // Validate: ถ้า status = TRANSPORTING ต้องมี destination
    if (status === 'TRANSPORTING' && (!new_dest_lat || !new_dest_long)) {
        return res.status(400).json({
            error_code: 'MISSING_DESTINATION',
            message: 'destination_location is required when status is TRANSPORTING'
        });
    }

    try {
        const query = `
            UPDATE resources SET 
                status = COALESCE($1, status),
                current_location = CASE 
                    WHEN $2::float8 IS NOT NULL AND $3::float8 IS NOT NULL 
                    THEN ST_SetSRID(ST_MakePoint($3::float8, $2::float8), 4326)::geography 
                    ELSE current_location 
                END,
                destination_location = CASE 
                    WHEN $1 = 'TRANSPORTING' AND $7::float8 IS NOT NULL AND $8::float8 IS NOT NULL 
                    THEN ST_SetSRID(ST_MakePoint($8::float8, $7::float8), 4326)::geography
                    WHEN $1 = 'AVAILABLE' THEN NULL 
                    ELSE destination_location 
                END,
                battery_level = COALESCE($4::float8, battery_level),
                assigned_incident_id = CASE WHEN $1 = 'AVAILABLE' THEN NULL ELSE assigned_incident_id END,
                last_updated_at = CURRENT_TIMESTAMP,
                version = version + 1
            WHERE resource_id = $5::uuid AND version = $6::int 
            RETURNING resource_id, status, battery_level, version, last_updated_at;
        `;

        const result = await pool.query(query, [
            status, lat, long, battery_level,
            resource_id, version,
            new_dest_lat, new_dest_long
        ]);

        if (result.rowCount === 0) {
            return res.status(409).json({
                error_code: 'VERSION_CONFLICT',
                message: 'Resource not found or version mismatch'
            });
        }

        const updated = result.rows[0];
        res.json({
            resource_id: updated.resource_id,
            status: updated.status,
            server_instruction: 'CONTINUE',
            last_updated_at: updated.last_updated_at
        });

    } catch (err) {
        console.error('[telemetry] Error:', err.message);
        res.status(500).json({ error: err.message });
    }
}

module.exports = updateTelemetry;
