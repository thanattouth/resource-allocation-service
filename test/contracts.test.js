const test = require('node:test');
const assert = require('node:assert/strict');

const { getDbQueryTimeoutMs, isDatabaseTimeoutError } = require('../app/utils/db');
const { sendError, sendTimeoutError } = require('../app/utils/http');

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
