const test = require('node:test');
const assert = require('node:assert/strict');

const allocateResource = require('../app/controllers/allocateController');
const getResource = require('../app/controllers/resourceController');
const updateTelemetry = require('../app/controllers/telemetryController');
const startTransport = require('../app/controllers/transportStartController');
const {
  requireAllocationAuth,
  requireTelemetryAuth,
  validateDispatcherAuthorizationHeader
} = require('../app/middleware/auth');

function createResponse() {
  return {
    statusCode: 200,
    body: null,
    headers: {},
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
    set(name, value) {
      this.headers[name.toLowerCase()] = value;
      return this;
    }
  };
}

function createRequest({
  params = {},
  body = {},
  query = {},
  headers = {},
  traceId = 'trace-test-123'
} = {}) {
  return {
    params,
    body,
    query,
    traceId,
    get(name) {
      const match = Object.keys(headers).find((key) => key.toLowerCase() === name.toLowerCase());
      return match ? headers[match] : undefined;
    }
  };
}

test('dispatcher auth validator rejects missing authorization', () => {
  const result = validateDispatcherAuthorizationHeader(undefined);

  assert.equal(result.ok, false);
  assert.equal(result.errorCode, 'AUTHORIZATION_REQUIRED');
});

test('dispatcher auth validator accepts bearer token', () => {
  process.env.DISPATCHER_BEARER_TOKEN = 'dispatcher-dev-token';

  const result = validateDispatcherAuthorizationHeader('Bearer dispatcher-dev-token');

  assert.deepEqual(result, {
    ok: true,
    auth: { actor: 'dispatcher', scheme: 'Bearer' }
  });
});

test('allocation auth middleware accepts ApiKey format', () => {
  process.env.ALLOCATION_API_KEY = 'allocation-upstream-key';

  const req = createRequest({
    headers: {
      Authorization: 'ApiKey allocation-upstream-key'
    }
  });
  const res = createResponse();
  let nextCalled = false;

  requireAllocationAuth(req, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, true);
  assert.deepEqual(req.auth, { actor: 'upstream-service', scheme: 'ApiKey' });
});

test('telemetry auth middleware accepts bare API key value', () => {
  process.env.TELEMETRY_API_KEY = 'telemetry-device-key';

  const req = createRequest({
    headers: {
      Authorization: 'telemetry-device-key'
    }
  });
  const res = createResponse();
  let nextCalled = false;

  requireTelemetryAuth(req, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, true);
  assert.deepEqual(req.auth, { actor: 'resource-device', scheme: 'ApiKey' });
});

test('allocate rejects missing Idempotency-Key before DB work', async () => {
  const req = createRequest({
    body: {
      incident_id: 'INC-1',
      destination: {
        destination_type: 'POWER_NODE',
        location: { lat: 13.76, long: 100.51 }
      },
      incident_location: { lat: 13.75, long: 100.5 },
      required_resource_type: 'AMBULANCE_VAN'
    }
  });
  const res = createResponse();

  await allocateResource(req, res);

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error_code, 'MISSING_IDEMPOTENCY_KEY');
});

test('allocate rejects conflicting identifiers', async () => {
  const req = createRequest({
    params: { incident_id: 'INC-1' },
    headers: { 'Idempotency-Key': 'same-key' },
    body: {
      incident_id: 'INC-2',
      destination: {
        destination_type: 'POWER_NODE',
        location: { lat: 13.76, long: 100.51 }
      },
      incident_location: { lat: 13.75, long: 100.5 },
      required_resource_type: 'AMBULANCE_VAN'
    }
  });
  const res = createResponse();

  await allocateResource(req, res);

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error_code, 'IDENTIFIER_CONFLICT');
});

test('allocate accepts request-only addressing but still requires destination coordinates', async () => {
  const req = createRequest({
    params: { request_id: 'REQ-1' },
    headers: { 'Idempotency-Key': 'req-only-key' },
    body: {
      incident_location: { lat: 13.75, long: 100.5 },
      destination: {
        destination_type: 'POWER_NODE'
      },
      required_resource_type: 'AMBULANCE_VAN'
    }
  });
  const res = createResponse();

  await allocateResource(req, res);

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error_code, 'INVALID_DESTINATION_LOCATION');
});

test('transport-start rejects invalid passenger_count early', async () => {
  const req = createRequest({
    params: {
      resource_id: '550e8400-e29b-41d4-a716-446655440000'
    },
    headers: { 'Idempotency-Key': 'transport-key' },
    body: {
      incident_id: 'INC-1',
      transport_type: 'SHELTER_EVACUATION',
      current_location: { lat: 13.75, long: 100.5 },
      passenger_count: 0,
      version: 1
    }
  });
  const res = createResponse();

  await startTransport(req, res);

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error_code, 'INVALID_PASSENGER_COUNT');
});

test('transport-start rejects invalid transport type', async () => {
  const req = createRequest({
    params: {
      resource_id: '550e8400-e29b-41d4-a716-446655440000'
    },
    headers: { 'Idempotency-Key': 'transport-key' },
    body: {
      incident_id: 'INC-1',
      transport_type: 'BOAT_SHUTTLE',
      current_location: { lat: 13.75, long: 100.5 },
      version: 1
    }
  });
  const res = createResponse();

  await startTransport(req, res);

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error_code, 'INVALID_TRANSPORT_TYPE');
});

test('telemetry rejects non-UUID resource_id', async () => {
  const req = createRequest({
    params: { resource_id: 'RES-VAN-005' },
    body: {
      version: 1,
      status: 'ON_SITE',
      current_location: { lat: 13.75, long: 100.5 }
    }
  });
  const res = createResponse();

  await updateTelemetry(req, res);

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error_code, 'INVALID_RESOURCE_ID');
});

test('telemetry rejects invalid battery level', async () => {
  const req = createRequest({
    params: {
      resource_id: '550e8400-e29b-41d4-a716-446655440000'
    },
    body: {
      version: 1,
      status: 'ON_SITE',
      battery_level: 120
    }
  });
  const res = createResponse();

  await updateTelemetry(req, res);

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error_code, 'INVALID_BATTERY_LEVEL');
});

test('get resource rejects non-UUID path parameter before DB work', async () => {
  const req = createRequest({
    params: { resource_id: 'not-a-uuid' }
  });
  const res = createResponse();

  await getResource(req, res);

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error_code, 'INVALID_RESOURCE_ID');
});
