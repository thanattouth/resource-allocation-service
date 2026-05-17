const test = require('node:test');
const assert = require('node:assert/strict');

const { getDbQueryTimeoutMs, isDatabaseTimeoutError } = require('../app/utils/db');
const { sendError, sendTimeoutError } = require('../app/utils/http');
const { isUuidResourceId } = require('../app/utils/resourceId');
const {
  buildIncidentCompletedEvent,
  buildPowerGridCompletedEvent,
  buildRequestCompletedEvent,
  buildShelterTransportingEvent
} = require('../app/utils/eventPublisher');

test('getDbQueryTimeoutMs falls back to 3000ms by default', () => {
  const original = process.env.DB_QUERY_TIMEOUT_MS;
  delete process.env.DB_QUERY_TIMEOUT_MS;

  assert.equal(getDbQueryTimeoutMs(), 3000);

  process.env.DB_QUERY_TIMEOUT_MS = original;
});

test('isDatabaseTimeoutError detects PostgreSQL statement timeout', () => {
  assert.equal(isDatabaseTimeoutError({ code: '57014' }), true);
  assert.equal(isDatabaseTimeoutError({ code: '23505' }), false);
});

test('sendError keeps the standard contract shape', () => {
  const response = {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    }
  };

  sendError(response, 409, 'trace-123', 'RESOURCE_BUSY_CONFLICT', 'Resource is busy.', {
    attempted_resource_id: 'RES-001'
  });

  assert.equal(response.statusCode, 409);
  assert.deepEqual(response.body, {
    error_code: 'RESOURCE_BUSY_CONFLICT',
    message: 'Resource is busy.',
    trace_id: 'trace-123',
    details: {
      attempted_resource_id: 'RES-001'
    }
  });
});

test('sendTimeoutError marks timeout failures as retryable', () => {
  const response = {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    }
  };

  sendTimeoutError(response, 503, 'trace-456', 'DB_TIMEOUT', 'Database timed out.');

  assert.equal(response.statusCode, 503);
  assert.equal(response.body.error_code, 'DB_TIMEOUT');
  assert.equal(response.body.retryable, true);
  assert.equal(response.body.trace_id, 'trace-456');
});

test('isUuidResourceId accepts UUIDs and rejects human-readable fleet codes', () => {
  assert.equal(isUuidResourceId('550e8400-e29b-41d4-a716-446655440000'), true);
  assert.equal(isUuidResourceId('RES-VAN-005'), false);
});

test('async contract: POWERGRID_COMPLETED payload matches v1 shape', () => {
  const payload = buildPowerGridCompletedEvent({
    incidentId: 'INC-2026-0001',
    requestId: 'REQ-2026-0001',
    resourceId: '550e8400-e29b-41d4-a716-446655440000',
    resourceType: 'POWER_GENERATOR_TRUCK',
    destination: {
      destination_type: 'POWER_NODE',
      destination_id: 'NODE-77',
      destination_name: 'Substation 77'
    },
    finalStatus: 'AVAILABLE',
    completedAt: '2026-04-28T10:05:00.000Z'
  });

  assert.equal(typeof payload.event_id, 'string');
  assert.equal(payload.event_type, 'POWERGRID_COMPLETED');
  assert.equal(typeof payload.timestamp, 'string');
  assert.equal(payload.incident_id, 'INC-2026-0001');
  assert.equal(payload.request_id, 'REQ-2026-0001');
  assert.equal(payload.source_service, 'ResourceAllocationService');
  assert.equal(payload.resource.resource_id, '550e8400-e29b-41d4-a716-446655440000');
  assert.equal(payload.resource.resource_type, 'POWER_GENERATOR_TRUCK');
  assert.equal(payload.destination.destination_type, 'POWER_NODE');
  assert.equal(payload.destination.destination_id, 'NODE-77');
  assert.equal(payload.destination.destination_name, 'Substation 77');
  assert.equal(payload.final_status, 'AVAILABLE');
  assert.equal(payload.completed_at, '2026-04-28T10:05:00.000Z');
});

test('async contract: powergrid payload preserves the current destination context when provided', () => {
  const payload = buildPowerGridCompletedEvent({
    incidentId: 'INC-2026-0001',
    resourceId: '550e8400-e29b-41d4-a716-446655440000',
    resourceType: 'POWER_GENERATOR_TRUCK',
    destination: {
      destination_type: 'PICKUP_VOLUNTEER',
      destination_id: 'VOL-001'
    },
    finalStatus: 'AVAILABLE',
    completedAt: '2026-04-28T10:05:00.000Z'
  });

  assert.equal(payload.destination.destination_type, 'PICKUP_VOLUNTEER');
  assert.equal(payload.destination.destination_id, 'VOL-001');
});

test('async contract: RESOURCE_TRANSPORTING_TO_SHELTER payload matches v1 shape', () => {
  const payload = buildShelterTransportingEvent({
    incidentId: 'INC-2026-0001',
    requestId: 'REQ-2026-0001',
    allocationId: 'ALLOC-998877',
    resourceId: '550e8400-e29b-41d4-a716-446655440000',
    resourceType: 'AMBULANCE_VAN',
    destination: {
      destination_type: 'SHELTER',
      destination_id: 'SHELTER-001',
      destination_name: 'Bangkok Shelter A'
    },
    status: 'TRANSPORTING',
    passengerCount: 4,
    etaMinutes: 10
  });

  assert.equal(typeof payload.event_id, 'string');
  assert.equal(payload.event_type, 'RESOURCE_TRANSPORTING_TO_SHELTER');
  assert.equal(typeof payload.timestamp, 'string');
  assert.equal(payload.incident_id, 'INC-2026-0001');
  assert.equal(payload.request_id, 'REQ-2026-0001');
  assert.equal(payload.allocation_id, 'ALLOC-998877');
  assert.equal(payload.shelter_id, 'SHELTER-001');
  assert.equal(payload.source_service, 'ResourceAllocationService');
  assert.equal(payload.resource.resource_id, '550e8400-e29b-41d4-a716-446655440000');
  assert.equal(payload.resource.resource_type, 'AMBULANCE_VAN');
  assert.equal(payload.destination.destination_type, 'SHELTER');
  assert.equal(payload.destination.destination_id, 'SHELTER-001');
  assert.equal(payload.destination.shelter_id, 'SHELTER-001');
  assert.equal(payload.destination.destination_name, 'Bangkok Shelter A');
  assert.equal(payload.status, 'TRANSPORTING');
  assert.equal(payload.passenger_count, 4);
  assert.equal(payload.eta_minutes, 10);
});

test('async contract: powergrid completion can be published with request_id only', () => {
  const payload = buildPowerGridCompletedEvent({
    requestId: 'REQ-ONLY-0001',
    resourceId: '550e8400-e29b-41d4-a716-446655440000',
    resourceType: 'POWER_GENERATOR_TRUCK',
    destination: {
      destination_type: 'POWER_NODE',
      destination_id: 'NODE-77'
    },
    finalStatus: 'RETURNING',
    completedAt: '2026-04-28T10:07:00.000Z'
  });

  assert.equal(payload.incident_id, undefined);
  assert.equal(payload.request_id, 'REQ-ONLY-0001');
});

test('async contract: powergrid completion can omit destination entirely', () => {
  const payload = buildPowerGridCompletedEvent({
    incidentId: 'INC-2026-0001',
    resourceId: '550e8400-e29b-41d4-a716-446655440000',
    resourceType: 'POWER_GENERATOR_TRUCK',
    finalStatus: 'RETURNING',
    completedAt: '2026-04-28T10:07:00.000Z'
  });

  assert.equal(payload.destination, undefined);
});

test('async contract: shelter payload rejects non-shelter destination', () => {
  assert.throws(
    () =>
      buildShelterTransportingEvent({
        incidentId: 'INC-2026-0001',
        allocationId: 'ALLOC-998877',
        resourceId: '550e8400-e29b-41d4-a716-446655440000',
        resourceType: 'AMBULANCE_VAN',
        destination: {
          destination_type: 'POWER_NODE',
          destination_id: 'NODE-77'
        },
        status: 'TRANSPORTING',
        passengerCount: 4,
        etaMinutes: 10
      }),
    /destination must be a SHELTER/
  );
});

test('async contract: REQUEST_COMPLETED payload includes request and shelter identifiers', () => {
  const payload = buildRequestCompletedEvent({
    requestId: 'REQ-2026-0001',
    incidentId: 'INC-2026-0001',
    resourceId: '550e8400-e29b-41d4-a716-446655440000',
    resourceType: 'AMBULANCE_VAN',
    finalStatus: 'RETURNING',
    completedAt: '2026-04-28T10:00:00.000Z',
    destination: {
      destination_type: 'SHELTER',
      destination_id: 'SHELTER-001',
      destination_name: 'Bangkok Shelter A',
      shelter_id: 'SHELTER-001'
    }
  });

  assert.equal(payload.event_type, 'REQUEST_COMPLETED');
  assert.equal(payload.request_id, 'REQ-2026-0001');
  assert.equal(payload.incident_id, 'INC-2026-0001');
  assert.equal(payload.resource.resource_type, 'AMBULANCE_VAN');
  assert.equal(payload.final_status, 'RETURNING');
  assert.equal(payload.completed_at, '2026-04-28T10:00:00.000Z');
  assert.equal(payload.destination.destination_id, 'SHELTER-001');
  assert.equal(payload.destination.shelter_id, 'SHELTER-001');
});

test('async contract: INCIDENT_COMPLETED payload includes incident and optional request identifiers', () => {
  const payload = buildIncidentCompletedEvent({
    incidentId: 'INC-2026-0001',
    requestId: 'REQ-2026-0001',
    resourceId: '550e8400-e29b-41d4-a716-446655440000',
    resourceType: 'POWER_GENERATOR_TRUCK',
    finalStatus: 'AVAILABLE',
    completedAt: '2026-04-28T10:05:00.000Z',
    destination: {
      destination_type: 'POWER_NODE',
      destination_id: 'NODE-77',
      destination_name: 'Substation 77'
    }
  });

  assert.equal(payload.event_type, 'INCIDENT_COMPLETED');
  assert.equal(payload.incident_id, 'INC-2026-0001');
  assert.equal(payload.request_id, 'REQ-2026-0001');
  assert.equal(payload.resource.resource_type, 'POWER_GENERATOR_TRUCK');
  assert.equal(payload.final_status, 'AVAILABLE');
  assert.equal(payload.completed_at, '2026-04-28T10:05:00.000Z');
  assert.equal(payload.destination.destination_id, 'NODE-77');
});
