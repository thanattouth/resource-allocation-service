const pool = require('./db');

async function updateTelemetry(req, res) {
    const { resource_id } = req.params;
    const { status, lat, long, battery_level, version, new_dest_lat, new_dest_long } = req.body;

    try {
        const query = `
    UPDATE resources SET 
        status = COALESCE($1, status),
        -- เพิ่ม ::float8 เพื่อระบุประเภทข้อมูลให้ชัดเจน
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
        version = version + 1
    WHERE resource_id = $5::uuid AND version = $6::int 
    RETURNING *;
`;
        const result = await pool.query(query, [status, lat, long, battery_level, resource_id, version, new_dest_lat, new_dest_long]);

        if (result.rowCount === 0) return res.status(409).json({ status: "CONFLICT" });
        const updated = result.rows[0];
        res.json({
            status: "SUCCESS",
            data: {
                resource_id: updated.resource_id,
                status: updated.status,
                battery_level: updated.battery_level,
                version: updated.version,
                current_location: { lat: lat ?? null, long: long ?? null }
            }
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
}

module.exports = updateTelemetry;