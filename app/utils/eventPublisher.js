const { randomUUID } = require('crypto');
const { SQSClient, SendMessageCommand } = require('@aws-sdk/client-sqs');
const { EVENT_TYPES } = require('./constants');

let sqsClient;

function getSqsClient() {
  if (!sqsClient) {
    sqsClient = new SQSClient({
      region: process.env.AWS_REGION || 'us-east-1'
    });
  }
  return sqsClient;
}

function toMessageAttributes(traceId) {
  if (!traceId) {
    return undefined;
  }

  return {
    'x-correlation-id': {
      DataType: 'String',
      StringValue: traceId
    },
    'content-type': {
      DataType: 'String',
      StringValue: 'application/json'
    }
  };
}

function buildPowerGridCompletedEvent({
  incidentId,
  requestId,
  resourceId,
  resourceType,
  destination,
  finalStatus,
  completedAt
}) {
  if (!resourceId || !resourceType || !finalStatus) {
    throw new Error('resource_id, resource_type, and final_status are required for powergrid completion events.');
  }

  // Build destination section only if available (supports both POWER_NODE and other flows)
  const destinationPayload = destination && destination.destination_id
    ? {
        destination: {
          destination_type: destination.destination_type || 'UNKNOWN',
          destination_id: destination.destination_id,
          destination_name: destination.destination_name || undefined
        }
      }
    : {};

  return {
    event_id: randomUUID(),
    event_type: EVENT_TYPES.POWERGRID_COMPLETED,
    timestamp: new Date().toISOString(),
    ...(incidentId ? { incident_id: incidentId } : {}),
    ...(requestId ? { request_id: requestId } : {}),
    source_service: 'ResourceAllocationService',
    resource: {
      resource_id: resourceId,
      resource_type: resourceType
    },
    ...destinationPayload,
    final_status: finalStatus,
    completed_at: completedAt
  };
}

function buildShelterTransportingEvent({
  incidentId,
  requestId,
  allocationId,
  resourceId,
  resourceType,
  destination,
  status,
  passengerCount,
  etaMinutes
}) {
  if (!destination || destination.destination_type !== 'SHELTER' || !destination.destination_id) {
    throw new Error('destination must be a SHELTER with destination_id.');
  }

  const passenger = passengerCount === undefined || passengerCount === null
    ? undefined
    : Number.parseInt(passengerCount, 10);

  if (passengerCount !== undefined && passengerCount !== null && (!Number.isInteger(passenger) || passenger <= 0)) {
    throw new Error('passenger_count must be a positive integer when provided.');
  }

  const eta = Number.parseInt(etaMinutes, 10);
  if (!Number.isInteger(eta) || eta <= 0) {
    throw new Error('eta_minutes must be a positive integer.');
  }

  return {
    event_id: randomUUID(),
    event_type: EVENT_TYPES.RESOURCE_TRANSPORTING_TO_SHELTER,
    timestamp: new Date().toISOString(),
    ...(incidentId ? { incident_id: incidentId } : {}),
    ...(requestId ? { request_id: requestId } : {}),
    allocation_id: allocationId,
    shelter_id: destination.destination_id,
    source_service: 'ResourceAllocationService',
    resource: {
      resource_id: resourceId,
      resource_type: resourceType
    },
    destination: {
      destination_type: destination.destination_type,
      destination_id: destination.destination_id,
      shelter_id: destination.destination_id,
      destination_name: destination.destination_name || undefined
    },
    status,
    passenger_count: passenger,
    eta_minutes: eta
  };
}

function buildRequestCompletedEvent({
  requestId,
  incidentId,
  resourceId,
  resourceType,
  finalStatus,
  completedAt,
  destination
}) {
  if (!requestId) {
    throw new Error('request_id is required for request completion events.');
  }

  if (!resourceId || !resourceType || !finalStatus) {
    throw new Error('resource_id, resource_type, and final_status are required for request completion events.');
  }

  // Generate description based on destination type
  let description = 'Request completed';
  if (destination) {
    if (destination.destination_type === 'SHELTER') {
      description = 'Assisted victims to shelter';
    } else if (destination.destination_type === 'HOSPITAL') {
      description = 'Assisted victims to hospital';
    }
  }

  return {
    event_id: randomUUID(),
    event_type: EVENT_TYPES.REQUEST_COMPLETED,
    timestamp: new Date().toISOString(),
    request_id: requestId,
    ...(incidentId ? { incident_id: incidentId } : {}),
    status: 'SUCCESS',
    source_service: 'ResourceAllocationService',
    description,
    resource: {
      resource_id: resourceId,
      resource_type: resourceType
    },
    final_status: finalStatus,
    completed_at: completedAt,
    destination: destination
      ? {
        destination_type: destination.destination_type,
        destination_id: destination.destination_id,
        ...(destination.destination_name ? { destination_name: destination.destination_name } : {}),
        ...(destination.shelter_id ? { shelter_id: destination.shelter_id } : {})
      }
      : undefined
  };
}

function buildIncidentCompletedEvent({
  incidentId,
  requestId,
  resourceId,
  resourceType,
  finalStatus,
  completedAt,
  destination
}) {
  // Generate description based on destination type
  let description = 'Incident resolved';
  if (destination) {
    if (destination.destination_type === 'SHELTER') {
      description = 'Assisted victims to shelter';
    } else if (destination.destination_type === 'HOSPITAL') {
      description = 'Assisted victims to hospital';
    }
  }

  if (!incidentId) {
    throw new Error('incident_id is required for incident completion events.');
  }

  if (!resourceId || !resourceType || !finalStatus) {
    throw new Error('resource_id, resource_type, and final_status are required for incident completion events.');
  }

  return {
    event_id: randomUUID(),
    event_type: EVENT_TYPES.INCIDENT_COMPLETED,
    timestamp: new Date().toISOString(),
    incident_id: incidentId,
    ...(requestId ? { request_id: requestId } : {}),
    status: 'RESOLVED',
    source_service: 'ResourceAllocationService',
    description,
    resource: {
      resource_id: resourceId,
      resource_type: resourceType
    },
    final_status: finalStatus,
    completed_at: completedAt,
    destination: destination
      ? {
        destination_type: destination.destination_type,
        destination_id: destination.destination_id,
        ...(destination.destination_name ? { destination_name: destination.destination_name } : {}),
        ...(destination.shelter_id ? { shelter_id: destination.shelter_id } : {})
      }
      : undefined
  };
}

async function publishJsonEvent({
  queueUrl,
  payload,
  traceId,
  client = getSqsClient()
}) {
  if (!queueUrl) {
    return {
      status: 'SKIPPED',
      reason: 'Queue URL is not configured.'
    };
  }

  const command = new SendMessageCommand({
    QueueUrl: queueUrl,
    MessageBody: JSON.stringify(payload),
    MessageAttributes: toMessageAttributes(traceId)
  });

  const result = await client.send(command);
  return {
    status: 'PUBLISHED',
    queue: queueUrl,
    message_id: result.MessageId || null
  };
}

async function publishPowerGridCompletedEvent(eventInput, { traceId } = {}) {
  const payload = buildPowerGridCompletedEvent(eventInput);
  return publishJsonEvent({
    queueUrl: process.env.SQS_POWERGRID_COMPLETED_URL,
    payload,
    traceId
  });
}

async function publishShelterTransportingEvent(eventInput, { traceId } = {}) {
  const payload = buildShelterTransportingEvent(eventInput);
  return publishJsonEvent({
    queueUrl: process.env.SQS_SHELTER_TRANSPORTING_URL,
    payload,
    traceId
  });
}

async function publishRequestCompletedEvent(eventInput, { traceId } = {}) {
  const payload = buildRequestCompletedEvent(eventInput);
  return publishJsonEvent({
    queueUrl: process.env.SQS_USER_LOCATION_REQUEST_COMPLETED_URL,
    payload,
    traceId
  });
}

async function publishIncidentCompletedEvent(eventInput, { traceId } = {}) {
  const payload = buildIncidentCompletedEvent(eventInput);
  return publishJsonEvent({
    queueUrl: process.env.SQS_INCIDENT_REPORTER_COMPLETED_URL,
    payload,
    traceId
  });
}

module.exports = {
  buildIncidentCompletedEvent,
  buildPowerGridCompletedEvent,
  buildRequestCompletedEvent,
  buildShelterTransportingEvent,
  publishIncidentCompletedEvent,
  publishPowerGridCompletedEvent,
  publishRequestCompletedEvent,
  publishShelterTransportingEvent
};
