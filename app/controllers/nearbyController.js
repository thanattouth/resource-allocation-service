const pool = require('../db/pool');
const { RESOURCE_STATUSES } = require('../utils/constants');
const { parseCoordinate, sendError } = require('../utils/http');

async function getNearbyResources(req, res) {
    const { lat, long, radius_km = 5, status } = req.query;
    const latitude = parseCoordinate(lat);
    const longitude = parseCoordinate(long);

    if (latitude === null || longitude === null || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
        return sendError(
            res,
            400,
            req.traceId,
            'INVALID_COORDINATES',
            'lat must be between -90 and 90, and long must be between -180 and 180.'
        );
    }

    const radiusMeters = parseFloat(radius_km) * 1000;
    if (isNaN(radiusMeters) || radiusMeters <= 0 || radiusMeters > 50000) {
        return sendError(
            res,
            400,
            req.traceId,
            'INVALID_RADIUS',
            'radius_km must be between 1 and 50'
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

    try {
        const params = [latitude, longitude, radiusMeters];
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
        res.json({
            count: result.rowCount,
            radius_km: parseFloat(radius_km),
            resources: result.rows.map((resource) => ({
                ...resource,
                distance_from_center_km: Number.parseFloat(Number(resource.distance_from_center_km).toFixed(2))
            })),
            trace_id: req.traceId
        });

    } catch (err) {
        console.error('[nearby] Error:', err.message);
        return sendError(
            res,
            500,
            req.traceId,
            'DB_QUERY_FAILED',
            'Unable to search nearby resources at this time.'
        );
    }
}

module.exports = getNearbyResources;
