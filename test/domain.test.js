const test = require('node:test');
const assert = require('node:assert/strict');

const {
  calculateDistanceKm,
  calculateEstimatedArrivalTimeMinutes,
  shouldPublishEtaUpdate
} = require('../app/domain/allocation');
const { buildRequestFingerprint } = require('../app/utils/idempotency');
const { validateStatusTransition } = require('../app/domain/resourceState');

test('calculateEstimatedArrivalTimeMinutes rounds to at least one minute', () => {
  assert.equal(calculateEstimatedArrivalTimeMinutes(0.2), 1);
  assert.equal(calculateEstimatedArrivalTimeMinutes(10), 15);
});

test('calculateDistanceKm returns a finite value for valid coordinates', () => {
  const distanceKm = calculateDistanceKm(
    { lat: 13.7563, long: 100.5018 },
    { lat: 13.7601, long: 100.5102 }
  );

  assert.equal(Number.isFinite(distanceKm), true);
  assert.equal(distanceKm > 0, true);
});

test('shouldPublishEtaUpdate only emits when ETA moves beyond threshold', () => {
  assert.equal(shouldPublishEtaUpdate(10, 8, 2), true);
  assert.equal(shouldPublishEtaUpdate(10, 9, 2), false);
  assert.equal(shouldPublishEtaUpdate(null, 5, 2), true);
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
