const pool = require('../db/pool');
const { sendError, sendTimeoutError } = require('../utils/http');
const { isDatabaseTimeoutError, runInStatementTimeoutSession } = require('../utils/db');
const { isUuidResourceId } = require('../utils/resourceId');

async function getResource(req, res) {
  const { resource_id } = req.params;

  if (!resource_id) {
    return sendError(
      res,
      400,
      req.traceId,
      'INVALID_RESOURCE_ID',
      'resource_id path parameter is required.'
    );
  }

  if (!isUuidResourceId(resource_id)) {
    return sendError(
      res,
      400,
      req.traceId,
      'INVALID_RESOURCE_ID',
      'resource_id must be a valid UUID.'
    );
  }

  try {
    const result = await runInStatementTimeoutSession(pool, (client) =>
      client.query(
        `
          SELECT resource_id, resource_type, status, battery_level, version, driver_contact,
                 assigned_incident_id, assigned_request_id, destination_type, destination_id, destination_name,
                 CASE
                   WHEN current_location IS NOT NULL THEN json_build_object(
                     'lat', ST_Y(current_location::geometry),
                     'long', ST_X(current_location::geometry)
                   )
                   ELSE NULL
                 END AS current_location,
                 CASE
                   WHEN destination_location IS NOT NULL THEN json_build_object(
                     'lat', ST_Y(destination_location::geometry),
                     'long', ST_X(destination_location::geometry)
                   )
                   ELSE NULL
                 END AS destination_location,
                 CASE
                   WHEN incident_location IS NOT NULL THEN json_build_object(
                     'lat', ST_Y(incident_location::geometry),
                     'long', ST_X(incident_location::geometry)
                   )
                   ELSE NULL
                 END AS incident_location,
                 last_updated_at
          FROM resources
          WHERE resource_id = $1::uuid
        `,
        [resource_id]
      )
    );

    if (result.rowCount === 0) {
      return sendError(
        res,
        404,
        req.traceId,
        'RESOURCE_NOT_FOUND',
        `Resource ID ${resource_id} does not exist.`
      );
    }

    const resource = result.rows[0];
    return res.status(200).json({
      resource_id: resource.resource_id,
      resource_type: resource.resource_type,
      status: resource.status,
      battery_level: resource.battery_level,
      version: resource.version,
      driver_contact: resource.driver_contact,
      assigned_incident_id: resource.assigned_incident_id,
      assigned_request_id: resource.assigned_request_id,
      destination_type: resource.destination_type,
      destination_id: resource.destination_id,
      destination_name: resource.destination_name,
      current_location: resource.current_location,
      destination_location: resource.destination_location,
      incident_location: resource.incident_location,
      last_updated_at: resource.last_updated_at,
      trace_id: req.traceId
    });
  } catch (error) {
    if (isDatabaseTimeoutError(error)) {
      return sendTimeoutError(
        res,
        503,
        req.traceId,
        'DB_TIMEOUT',
        'Database query timed out while fetching the resource.'
      );
    }

    console.error('[resource] Error:', error.message);
    return sendError(
      res,
      500,
      req.traceId,
      'RESOURCE_FETCH_FAILED',
      'Unable to fetch resource at this time.'
    );
  }
}

module.exports = getResource;
