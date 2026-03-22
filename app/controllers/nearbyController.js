const pool = require('../db/pool');

async function getNearbyResources(req, res) {
    const { lat, long, radius_km = 5, status } = req.query;

    if (!lat || !long) {
        return res.status(400).json({
            error_code: 'INVALID_COORDINATES',
            message: 'lat and long are required'
        });
    }

    const radiusMeters = parseFloat(radius_km) * 1000;
    if (isNaN(radiusMeters) || radiusMeters <= 0 || radiusMeters > 50000) {
        return res.status(400).json({
            error_code: 'INVALID_RADIUS',
            message: 'radius_km must be between 1 and 50'
        });
    }

    try {
        const params = [parseFloat(lat), parseFloat(long), radiusMeters];
        let statusFilter = '';

        if (status) {
            params.push(status);
            statusFilter = `AND status = $${params.length}`;
        }

        const query = `
            SELECT
                resource_id,
                resource_type,
                status,
                battery_level,
                capabilities,
                version,
                json_build_object(
                    'lat',  ST_Y(current_location::geometry),
                    'long', ST_X(current_location::geometry)
                ) AS location,
                ST_Distance(
                    current_location::geography,
                    ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography
                ) / 1000 AS distance_from_center_km
            FROM resources
            WHERE ST_DWithin(
                current_location::geography,
                ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography,
                $3
            )
            ${statusFilter}
            ORDER BY distance_from_center_km ASC;
        `;

        const result = await pool.query(query, params);
        res.json({ count: result.rowCount, radius_km: parseFloat(radius_km), resources: result.rows });

    } catch (err) {
        console.error('[nearby] Error:', err.message);
        res.status(500).json({ error: err.message });
    }
}

module.exports = getNearbyResources;
