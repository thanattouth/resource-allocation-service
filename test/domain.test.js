const test = require('node:test');
const assert = require('node:assert/strict');

const { calculateEstimatedArrivalTimeMinutes } = require('../app/domain/allocation');
const { buildRequestFingerprint } = require('../app/utils/idempotency');
const { validateStatusTransition } = require('../app/domain/resourceState');

test('calculateEstimatedArrivalTimeMinutes rounds to at least one minute', () => {
  assert.equal(calculateEstimatedArrivalTimeMinutes(0.2), 1);
  assert.equal(calculateEstimatedArrivalTimeMinutes(10), 15);
});

test('buildRequestFingerprint is stable for same object content', () => {
  const first = buildRequestFingerprint({
    incident_id: 'INC-1',
    incident_location: { long: 100.5, lat: 13.7 },
    required_capabilities: ['AED', 'OXYGEN']
  });

  const second = buildRequestFingerprint({
    required_capabilities: ['AED', 'OXYGEN'],
    incident_location: { lat: 13.7, long: 100.5 },
    incident_id: 'INC-1'
  });

  assert.equal(first, second);
});

test('validateStatusTransition rejects invalid state movement', () => {
  const result = validateStatusTransition(
    { status: 'AVAILABLE', assigned_incident_id: null },
    'TRANSPORTING'
  );

  assert.equal(result.errorCode, 'INVALID_STATUS_TRANSITION');
});

test('validateStatusTransition allows ON_SITE to TRANSPORTING when assigned', () => {
  const result = validateStatusTransition(
    { status: 'ON_SITE', assigned_incident_id: 'INC-1' },
    'TRANSPORTING'
  );

  assert.equal(result, null);
});
