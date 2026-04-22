const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createNearbyLambdaHandler
} = require('../app/lambda/nearbyHandler');

test('Lambda nearby handler requires dispatcher authorization', async () => {
  const handler = createNearbyLambdaHandler({
    searchNearbyResourcesImpl: async () => ({})
  });

  const response = await handler({
    headers: {},
    queryStringParameters: {
      lat: '13.7563',
      long: '100.5018'
    }
  });

  assert.equal(response.statusCode, 401);
  assert.equal(response.headers['Content-Type'], 'application/json');
  const body = JSON.parse(response.body);
  assert.equal(body.error_code, 'AUTHORIZATION_REQUIRED');
  assert.ok(body.trace_id);
});

test('Lambda nearby handler returns payload and preserves correlation id', async () => {
  const handler = createNearbyLambdaHandler({
    searchNearbyResourcesImpl: async ({ lat, long, radius_km, traceId }) => ({
      count: 1,
      radius_km: Number(radius_km),
      resources: [
        {
          resource_id: '550e8400-e29b-41d4-a716-446655440000',
          resource_type: 'POWER_GENERATOR_TRUCK',
          status: 'AVAILABLE',
          distance_from_center_km: 1.23
        }
      ],
      query: { lat, long },
      trace_id: traceId
    })
  });

  const response = await handler({
    headers: {
      Authorization: 'Bearer dispatcher-dev-token',
      'x-correlation-id': 'trace-nearby-123'
    },
    queryStringParameters: {
      lat: '13.7563',
      long: '100.5018',
      radius_km: '5'
    }
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.headers['x-correlation-id'], 'trace-nearby-123');
  const body = JSON.parse(response.body);
  assert.equal(body.trace_id, 'trace-nearby-123');
  assert.equal(body.count, 1);
  assert.equal(body.resources[0].resource_type, 'POWER_GENERATOR_TRUCK');
});

test('Lambda nearby handler maps structured service errors', async () => {
  const handler = createNearbyLambdaHandler({
    searchNearbyResourcesImpl: async () => {
      const error = new Error('radius_km must be between 1 and 50');
      error.statusCode = 400;
      error.errorCode = 'INVALID_RADIUS';
      throw error;
    }
  });

  const response = await handler({
    headers: {
      Authorization: 'Bearer dispatcher-dev-token'
    },
    queryStringParameters: {
      lat: '13.7563',
      long: '100.5018',
      radius_km: '500'
    }
  });

  assert.equal(response.statusCode, 400);
  const body = JSON.parse(response.body);
  assert.equal(body.error_code, 'INVALID_RADIUS');
});
