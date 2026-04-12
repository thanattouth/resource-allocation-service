const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

const { app } = require('../app/main');

test('GET /health returns status and trace_id', async () => {
  const response = await request(app).get('/health');

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.status, 'ok');
  assert.ok(response.body.trace_id);
  assert.equal(response.headers['x-correlation-id'], response.body.trace_id);
});

test('GET /v1/resources/nearby rejects invalid coordinates', async () => {
  const response = await request(app)
    .get('/v1/resources/nearby?lat=999&long=100.5');

  assert.equal(response.statusCode, 400);
  assert.equal(response.body.error_code, 'INVALID_COORDINATES');
  assert.ok(response.body.trace_id);
});

test('POST /v1/incidents/:incident_id/allocations requires Idempotency-Key', async () => {
  const response = await request(app)
    .post('/v1/incidents/INC-2024-0801/allocations')
    .send({
      incident_location: { lat: 13.7563, long: 100.5018 },
      required_resource_type: 'AMBULANCE_VAN',
      required_capabilities: ['AED']
    });

  assert.equal(response.statusCode, 400);
  assert.equal(response.body.error_code, 'MISSING_IDEMPOTENCY_KEY');
});

test('PATCH /v1/resources/:resource_id/telemetry requires integer version', async () => {
  const response = await request(app)
    .patch('/v1/resources/00000000-0000-0000-0000-000000000001/telemetry')
    .send({
      status: 'TRANSPORTING',
      current_location: { lat: 13.758, long: 100.505 }
    });

  assert.equal(response.statusCode, 400);
  assert.equal(response.body.error_code, 'INVALID_VERSION');
});

test('POST /v1/resources/:resource_id/transport-start requires Idempotency-Key', async () => {
  const response = await request(app)
    .post('/v1/resources/00000000-0000-0000-0000-000000000001/transport-start')
    .send({
      incident_id: 'INC-2024-0801',
      transport_type: 'SHELTER_EVACUATION',
      current_location: { lat: 13.758, long: 100.505 },
      version: 1
    });

  assert.equal(response.statusCode, 400);
  assert.equal(response.body.error_code, 'MISSING_IDEMPOTENCY_KEY');
});
