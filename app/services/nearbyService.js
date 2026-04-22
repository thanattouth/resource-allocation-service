const pool = require('../db/pool');
const { RESOURCE_STATUSES } = require('../utils/constants');
const { isDatabaseTimeoutError, runInStatementTimeoutSession } = require('../utils/db');
const { parseCoordinate } = require('../utils/http');

function createNearbyServiceError(statusCode, errorCode, message, details, metadata = {}) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.errorCode = errorCode;
  error.details = details;
  error.metadata = metadata;
  return error;
}

async function searchNearbyResources(
  { lat, long, radius_km = 5, status, traceId },
  { poolOverride = pool } = {}
) {
  const latitude = parseCoordinate(lat);
  const longitude = parseCoordinate(long);

  if (
    latitude === null ||
    longitude === null ||
    latitude < -90 ||
    latitude > 90 ||
    longitude < -180 ||
    longitude > 180
  ) {
    throw createNearbyServiceError(
      400,
      'INVALID_COORDINATES',
      'lat must be between -90 and 90, and long must be between -180 and 180.'
    );
  }

  const radiusKmValue = Number.parseFloat(radius_km);
  const radiusMeters = radiusKmValue * 1000;
  if (!Number.isFinite(radiusMeters) || radiusMeters <= 0 || radiusMeters > 50000) {
    throw createNearbyServiceError(
      400,
      'INVALID_RADIUS',
      'radius_km must be between 1 and 50'
    );
  }

  if (status && !RESOURCE_STATUSES.includes(status)) {
    throw createNearbyServiceError(
      400,
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

    const result = await runInStatementTimeoutSession(poolOverride, (client) =>
      client.query(query, params)
    );

    return {
      count: result.rowCount,
      radius_km: radiusKmValue,
      resources: result.rows.map((resource) => ({
        ...resource,
        distance_from_center_km: Number.parseFloat(Number(resource.distance_from_center_km).toFixed(2))
      })),
      trace_id: traceId
    };
  } catch (error) {
    if (error.statusCode) {
      throw error;
    }

    if (isDatabaseTimeoutError(error)) {
      console.error('[nearbyService] Database timeout', {
        traceId,
        code: error.code,
        message: error.message
      });
      throw createNearbyServiceError(
        503,
        'DB_TIMEOUT',
        'Database query timed out while searching nearby resources.',
        undefined,
        { retryable: true }
      );
    }

    console.error('[nearbyService] Database query failed', {
      traceId,
      code: error.code,
      message: error.message,
      detail: error.detail,
      hint: error.hint,
      name: error.name
    });

    throw createNearbyServiceError(
      500,
      'DB_QUERY_FAILED',
      'Unable to search nearby resources at this time.'
    );
  }
}

module.exports = {
  createNearbyServiceError,
  searchNearbyResources
};
