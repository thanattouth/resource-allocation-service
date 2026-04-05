const pool = require('../db/pool');
const { RESOURCE_STATUSES } = require('../utils/constants');
const { parseCoordinate, sendError } = require('../utils/http');
const { validateStatusTransition } = require('../domain/resourceState');

async function updateTelemetry(req, res) {
    const { resource_id } = req.params;
    const {
        status,
        battery_level,
        version,
        current_location,
        destination_location,
        lat,
        long,
        new_dest_lat,
        new_dest_long
    } = req.body;

    const currentLat = parseCoordinate(current_location?.lat ?? lat);
    const currentLong = parseCoordinate(current_location?.long ?? long);
    const destinationLat = parseCoordinate(destination_location?.lat ?? new_dest_lat);
    const destinationLong = parseCoordinate(destination_location?.long ?? new_dest_long);
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

    if (status === 'TRANSPORTING' && (destinationLat === null || destinationLong === null)) {
        return sendError(
            res,
            400,
            req.traceId,
            'MISSING_DESTINATION',
            'destination_location is required when status is TRANSPORTING'
        );
    }

    if ((destinationLat !== null && (destinationLat < -90 || destinationLat > 90)) || (destinationLong !== null && (destinationLong < -180 || destinationLong > 180))) {
        return sendError(
            res,
            400,
            req.traceId,
            'INVALID_DESTINATION_LOCATION',
            'destination_location must contain valid lat/long coordinates.'
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
        const existingResourceResult = await pool.query(
            `
                SELECT resource_id, status, assigned_incident_id, destination_location, version
                FROM resources
                WHERE resource_id = $1::uuid
            `,
            [resource_id]
        );

        if (existingResourceResult.rowCount === 0) {
            return sendError(
                res,
                404,
                req.traceId,
                'RESOURCE_NOT_FOUND',
                `Resource ID ${resource_id} does not exist.`
            );
        }

        const currentResource = existingResourceResult.rows[0];
        const transitionError = validateStatusTransition(currentResource, status);

        if (transitionError) {
            return sendError(
                res,
                409,
                req.traceId,
                transitionError.errorCode,
                transitionError.message
            );
        }

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
            status,
            currentLat,
            currentLong,
            battery,
            resource_id,
            Number(version),
            destinationLat,
            destinationLong
        ]);

        if (result.rowCount === 0) {
            return sendError(
                res,
                409,
                req.traceId,
                'VERSION_CONFLICT',
                'Resource version mismatch. Please fetch the latest resource state and retry.'
            );
        }

        const updated = result.rows[0];
        res.json({
            resource_id: updated.resource_id,
            status: updated.status,
            server_instruction: 'CONTINUE',
            version: updated.version,
            destination_location: destinationLat !== null && destinationLong !== null
                ? {
                    ...(destination_location?.name ? { name: destination_location.name } : {}),
                    lat: destinationLat,
                    long: destinationLong
                }
                : null,
            last_updated_at: updated.last_updated_at,
            trace_id: req.traceId
        });

    } catch (err) {
        console.error('[telemetry] Error:', err.message);
        if (err.code === '22P02') {
            return sendError(
                res,
                400,
                req.traceId,
                'INVALID_RESOURCE_ID',
                'resource_id must be a valid UUID.'
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
