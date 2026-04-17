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

function parsePositiveInteger(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
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

function buildPowerGridEtaUpdatedEvent({
  incidentId,
  allocationId,
  resourceId,
  resourceType,
  destination,
  status,
  etaMinutes
}) {
  const eta = parsePositiveInteger(etaMinutes);
  if (!eta) {
    throw new Error('eta_minutes must be a positive integer.');
  }

  if (!destination || destination.destination_type !== 'POWER_NODE' || !destination.destination_id) {
    throw new Error('destination must be a POWER_NODE with destination_id.');
  }

  return {
    event_id: randomUUID(),
    event_type: EVENT_TYPES.RESOURCE_ETA_UPDATED,
    timestamp: new Date().toISOString(),
    incident_id: incidentId,
    allocation_id: allocationId,
    source_service: 'ResourceAllocationService',
    resource: {
      resource_id: resourceId,
      resource_type: resourceType
    },
    destination: {
      destination_type: destination.destination_type,
      destination_id: destination.destination_id
    },
    status,
    eta_minutes: eta
  };
}

function buildShelterTransportingEvent({
  incidentId,
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

  const eta = parsePositiveInteger(etaMinutes);
  if (!eta) {
    throw new Error('eta_minutes must be a positive integer.');
  }

  const passenger = passengerCount === undefined || passengerCount === null
    ? undefined
    : parsePositiveInteger(passengerCount);

  if (passengerCount !== undefined && passengerCount !== null && passenger === null) {
    throw new Error('passenger_count must be a positive integer when provided.');
  }

  return {
    event_id: randomUUID(),
    event_type: EVENT_TYPES.RESOURCE_TRANSPORTING_TO_SHELTER,
    timestamp: new Date().toISOString(),
    incident_id: incidentId,
    allocation_id: allocationId,
    source_service: 'ResourceAllocationService',
    resource: {
      resource_id: resourceId,
      resource_type: resourceType
    },
    destination: {
      destination_type: destination.destination_type,
      destination_id: destination.destination_id,
      destination_name: destination.destination_name || undefined
    },
    status,
    passenger_count: passenger,
    eta_minutes: eta
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

async function publishPowerGridEtaUpdatedEvent(eventInput, { traceId } = {}) {
  const payload = buildPowerGridEtaUpdatedEvent(eventInput);
  return publishJsonEvent({
    queueUrl: process.env.SQS_POWERGRID_ETA_UPDATED_URL,
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

module.exports = {
  buildPowerGridEtaUpdatedEvent,
  buildShelterTransportingEvent,
  publishPowerGridEtaUpdatedEvent,
  publishShelterTransportingEvent
};
