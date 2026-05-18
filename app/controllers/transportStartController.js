const pool = require('../db/pool');
const { parseCoordinate, sendError, sendTimeoutError } = require('../utils/http');
const { buildRequestFingerprint } = require('../utils/idempotency');
const { TRANSPORT_TYPES } = require('../utils/constants');
const {
  calculateDistanceKm,
  calculateEstimatedArrivalTimeMinutes
} = require('../domain/allocation');
const { validateStatusTransition } = require('../domain/resourceState');
const { suggestNearbyShelter } = require('../clients/shelterLocatorClient');
const { findBestHospital, createTransferRequest } = require('../clients/hospitalClient');
const { isUuidResourceId } = require('../utils/resourceId');
const {
  publishShelterTransportingEvent
} = require('../utils/eventPublisher');
const {
  isDatabaseTimeoutError,
  runInStatementTimeoutSession
} = require('../utils/db');
const {
  claimIdempotencyRecord,
  completeIdempotencyRecord,
  releaseIdempotencyRecord
} = require('../utils/dynamoIdempotency');
const {
  buildIdentifierContext,
  hasAnyRequestIdentifier,
  matchesAssignedIdentifiers,
  resolveRequestIdentifiers,
  toIdentifierPayload
} = require('../utils/requestIdentifiers');

function buildDestinationResponse(shelter) {
  if (!shelter) {
    return null;
  }

  return {
    destination_type: 'SHELTER',
    destination_id: shelter.shelter_id,
    destination_name: shelter.name,
    location: shelter.location,
    status: shelter.shelter_status,
    power_status: shelter.power_status
  };
}

function buildHospitalDestinationResponse(hospital) {
  if (!hospital) {
    return null;
  }

  return {
    destination_type: 'HOSPITAL',
    destination_id: hospital.hospitalId,
    destination_name: hospital.name,
    location: {
      lat: hospital.lat,
      long: hospital.lon
    },
    status: hospital.status,
    address: hospital.address,
    available_beds: hospital.availableBeds,
    available_icu: hospital.availableICU,
    available_emergency_bed: hospital.availableEmergencyBed
  };
}

async function startTransport(req, res) {
  const { resource_id } = req.params;
  const idempotencyKey = req.get('Idempotency-Key');
    const {
    incident_id: bodyIncidentId,
    request_id: bodyRequestId,
    transport_type,
    current_location,
    passenger_count,
    injury_description,
    version
  } = req.body;
  const { incidentId, requestId, conflicts } = resolveRequestIdentifiers({
    bodyIncidentId,
    bodyRequestId
  });

  const latitude = parseCoordinate(current_location?.lat);
  const longitude = parseCoordinate(current_location?.long);
  const identifierContext = buildIdentifierContext({ incidentId, requestId });
  const requestFingerprint = buildRequestFingerprint({
    ...identifierContext,
    transport_type,
    current_location,
    passenger_count,
    injury_description,
    version
  });

  if (!idempotencyKey) {
    return sendError(
      res,
      400,
      req.traceId,
      'MISSING_IDEMPOTENCY_KEY',
      'Idempotency-Key header is required for transport start requests.'
    );
  }

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

  if (conflicts.length > 0) {
    return sendError(
      res,
      400,
      req.traceId,
      'IDENTIFIER_CONFLICT',
      `Conflicting identifier values were provided for: ${conflicts.join(', ')}.`
    );
  }

  if (!hasAnyRequestIdentifier({ incidentId, requestId })) {
    return sendError(
      res,
      400,
      req.traceId,
      'MISSING_REQUEST_IDENTIFIER',
      'At least one of incident_id or request_id is required.'
    );
  }

  if (!transport_type || !TRANSPORT_TYPES.includes(transport_type)) {
    return sendError(
      res,
      400,
      req.traceId,
      'INVALID_TRANSPORT_TYPE',
      `transport_type must be one of: ${TRANSPORT_TYPES.join(', ')}`
    );
  }

  if (latitude === null || longitude === null || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
    return sendError(
      res,
      400,
      req.traceId,
      'INVALID_CURRENT_LOCATION',
      'current_location.lat and current_location.long must be valid coordinates.'
    );
  }

  if (passenger_count !== undefined && (!Number.isInteger(Number(passenger_count)) || Number(passenger_count) <= 0)) {
    return sendError(
      res,
      400,
      req.traceId,
      'INVALID_PASSENGER_COUNT',
      'passenger_count must be a positive integer when provided.'
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

  let idempotencyClaimed = false;
  let idempotencyCompleted = false;

  try {
    const claimResult = await claimIdempotencyRecord({
      idempotencyKey,
      identifierContext,
      requestFingerprint
    });

    if (claimResult.kind === 'RETRY') {
      return sendError(
        res,
        409,
        req.traceId,
        'IDEMPOTENCY_RETRY_REQUIRED',
        'Idempotency state could not be confirmed. Please retry the same request.'
      );
    }

    if (claimResult.kind === 'CONFLICT') {
      return sendError(
        res,
        409,
        req.traceId,
        'IDEMPOTENCY_KEY_REUSED',
        'This Idempotency-Key was already used with a different request payload.'
      );
    }

    if (claimResult.kind === 'REPLAY') {
      const responsePayload = {
        ...claimResult.responsePayload,
        trace_id: req.traceId
      };
      const statusCode = responsePayload.server_instruction === 'DESTINATION_PENDING' ? 202 : 200;
      return res.status(statusCode).json(responsePayload);
    }

    if (claimResult.kind === 'PROCESSING') {
      return sendError(
        res,
        409,
        req.traceId,
        'IDEMPOTENCY_REQUEST_IN_PROGRESS',
        'An identical request with this Idempotency-Key is still being processed.'
      );
    }

    idempotencyClaimed = true;

    const existingResourceResult = await runInStatementTimeoutSession(pool, (client) =>
      client.query(
        `
          SELECT resource_id, status, assigned_incident_id, assigned_request_id, version, resource_type
          FROM resources
          WHERE resource_id = $1::uuid
        `,
        [resource_id]
      )
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
    const transitionError = validateStatusTransition(currentResource, 'TRANSPORTING');

    if (transitionError) {
      return sendError(
        res,
        409,
        req.traceId,
        transitionError.errorCode,
        transitionError.message
      );
    }

    if (!matchesAssignedIdentifiers(currentResource, { incidentId, requestId })) {
      return sendError(
        res,
        409,
        req.traceId,
        'IDENTIFIER_MISMATCH',
        'Provided incident_id/request_id does not match the resource assignment currently in progress.'
      );
    }

    let shelterLookup = {
      status: 'UNAVAILABLE',
      reason: 'Shelter lookup was not attempted.'
    };

    let hospitalLookup = {
      status: 'UNAVAILABLE',
      reason: 'Hospital lookup was not attempted.',
      hospital: null,
      transferRequest: null
    };

    if (transport_type === 'SHELTER_EVACUATION') {
      shelterLookup = await suggestNearbyShelter({
        latitude,
        longitude,
        traceId: req.traceId
      });
    }

    if (transport_type === 'HOSPITAL_TRANSFER') {
      hospitalLookup.status = 'SEARCHING';
      try {
        const hospital = await findBestHospital({
          lat: latitude,
          lon: longitude,
          severityLevel: 'low'
        });

        if (hospital) {
          // Create transfer request
          const transferRequest = await createTransferRequest({
            incidentId: incidentId || currentResource.assigned_incident_id || 'UNKNOWN',
            hospitalId: hospital.hospitalId,
            severityLevel: 'LOW',
            injuryDescription: injury_description || 'Emergency transport from disaster scene',
            lat: latitude,
            lon: longitude,
            requestedBy: 'ResourceAllocationService'
          });

          hospitalLookup = {
            status: 'FOUND',
            reason: 'Hospital found and transfer request created',
            hospital: hospital,
            transferRequest: transferRequest
          };
        } else {
          hospitalLookup = {
            status: 'UNAVAILABLE',
            reason: 'No available hospitals with open beds found nearby.',
            hospital: null,
            transferRequest: null
          };
        }
      } catch (error) {
        console.error('[transport-start] Hospital lookup failed:', error.message);
        hospitalLookup = {
          status: 'ERROR',
          reason: `Hospital API error: ${error.message}`,
          hospital: null,
          transferRequest: null
        };
      }
    }

    const destinationLat = shelterLookup.status === 'FOUND'
      ? shelterLookup.shelter.location.lat
      : (hospitalLookup.status === 'FOUND' ? hospitalLookup.hospital.lat : null);
    const destinationLong = shelterLookup.status === 'FOUND'
      ? shelterLookup.shelter.location.long
      : (hospitalLookup.status === 'FOUND' ? hospitalLookup.hospital.lon : null);
    const updateResult = await runInStatementTimeoutSession(pool, (client) =>
      client.query(
        `
          UPDATE resources
          SET status = 'TRANSPORTING',
              current_location = ST_SetSRID(ST_MakePoint($2::float8, $1::float8), 4326)::geography,
              destination_location = CASE
                WHEN $3::float8 IS NOT NULL AND $4::float8 IS NOT NULL
                THEN ST_SetSRID(ST_MakePoint($4::float8, $3::float8), 4326)::geography
                ELSE destination_location
              END,
              destination_type = CASE
                WHEN $7::text IS NOT NULL THEN $7
                ELSE destination_type
              END,
              destination_id = CASE
                WHEN $8::text IS NOT NULL THEN $8
                ELSE destination_id
              END,
              destination_name = CASE
                WHEN $9::text IS NOT NULL THEN $9
                ELSE destination_name
              END,
              last_updated_at = CURRENT_TIMESTAMP,
              version = version + 1
          WHERE resource_id = $5::uuid
            AND version = $6::int
          RETURNING resource_id, status, version, last_updated_at;
        `,
        [
          latitude,
          longitude,
          destinationLat,
          destinationLong,
          resource_id,
          Number(version),
          shelterLookup.status === 'FOUND' ? 'SHELTER' : (hospitalLookup.status === 'FOUND' ? 'HOSPITAL' : null),
          shelterLookup.status === 'FOUND' ? shelterLookup.shelter.shelter_id : (hospitalLookup.status === 'FOUND' ? hospitalLookup.hospital.hospitalId : null),
          shelterLookup.status === 'FOUND' ? shelterLookup.shelter.name : (hospitalLookup.status === 'FOUND' ? hospitalLookup.hospital.name : null)
        ]
      )
    );

    if (updateResult.rowCount === 0) {
      return sendError(
        res,
        409,
        req.traceId,
        'VERSION_CONFLICT',
        'Resource version mismatch. Please fetch the latest resource state and retry.'
      );
    }

    const updated = updateResult.rows[0];
    
    // Determine destination based on transport type
    const destination = shelterLookup.status === 'FOUND'
      ? buildDestinationResponse(shelterLookup.shelter)
      : (hospitalLookup.status === 'FOUND' ? buildHospitalDestinationResponse(hospitalLookup.hospital) : null);
    
    const isDestinationFound = shelterLookup.status === 'FOUND' || hospitalLookup.status === 'FOUND';
    const destinationReason = shelterLookup.status === 'FOUND'
      ? null
      : (hospitalLookup.status === 'FOUND' ? null : (hospitalLookup.reason || shelterLookup.reason));
    
    const responsePayload = {
      resource_id: updated.resource_id,
      ...toIdentifierPayload({ incidentId, requestId }),
      status: updated.status,
      transport_type,
      destination,
      server_instruction: isDestinationFound
        ? 'PROCEED_TO_DESTINATION'
        : 'DESTINATION_PENDING',
      destination_pending: !isDestinationFound,
      degraded: !isDestinationFound,
      degraded_reason: destinationReason,
      version: updated.version,
      last_updated_at: updated.last_updated_at,
      trace_id: req.traceId
    };

    const httpStatus = (shelterLookup.status === 'FOUND' || hospitalLookup.status === 'FOUND') ? 200 : 202;
    
    // Track published events
    const publishedEvents = [];
    
    await completeIdempotencyRecord({
      idempotencyKey,
      allocationId: null,
      responsePayload
    });
    idempotencyCompleted = true;

    if (responsePayload.destination && responsePayload.destination.destination_type === 'SHELTER') {
      const estimatedDistanceKm = calculateDistanceKm(
        current_location,
        responsePayload.destination.location
      );
      const etaMinutes = calculateEstimatedArrivalTimeMinutes(estimatedDistanceKm);
      try {
        await publishShelterTransportingEvent(
          {
            incidentId,
            requestId,
            allocationId: null,
            resourceId: responsePayload.resource_id,
            resourceType: currentResource.resource_type,
            destination: responsePayload.destination,
            status: responsePayload.status,
            passengerCount: passenger_count,
            etaMinutes: etaMinutes || 1
          },
          { traceId: req.traceId }
        );
        publishedEvents.push({ event_type: 'SHELTER_TRANSPORTING', status: 'PUBLISHED' });
      } catch (publishError) {
        console.error('[transport-start] Failed to publish shelter transporting event:', publishError.message);
        publishedEvents.push({ event_type: 'SHELTER_TRANSPORTING', status: 'FAILED', error: publishError.message });
      }
    }
    
    // Add published events to response
    if (publishedEvents.length > 0) {
      responsePayload.published_events = publishedEvents;
    }

    return res.status(httpStatus).json(responsePayload);
  } catch (err) {
    console.error('[transport-start] Error:', err.message);

    if (isDatabaseTimeoutError(err)) {
      return sendTimeoutError(
        res,
        503,
        req.traceId,
        'DB_TIMEOUT',
        'Database query timed out while starting transport.'
      );
    }

    if (idempotencyClaimed && !idempotencyCompleted) {
      try {
        await releaseIdempotencyRecord(idempotencyKey);
      } catch (releaseError) {
        console.error('[transport-start] DynamoDB release error:', releaseError.message);
      }
    }

    return sendError(
      res,
      500,
      req.traceId,
      'TRANSPORT_START_FAILED',
      'Unable to start transport at this time.'
    );
  }
}

module.exports = startTransport;
