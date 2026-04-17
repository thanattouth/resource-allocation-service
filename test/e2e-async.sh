#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://184.72.104.140:3000}"
DISPATCHER_TOKEN="${DISPATCHER_BEARER_TOKEN:-}"
TELEMETRY_TOKEN="${TELEMETRY_BEARER_TOKEN:-}"
POWERGRID_QUEUE_URL="${SQS_POWERGRID_ETA_UPDATED_URL:-}"
INCIDENT_ID="${INCIDENT_ID:-INC-2026-E2E-ASYNC-$(date +%s)}"
QUEUE_POLL_ATTEMPTS="${QUEUE_POLL_ATTEMPTS:-8}"
QUEUE_WAIT_SECONDS="${QUEUE_WAIT_SECONDS:-2}"

if [[ -z "${DISPATCHER_TOKEN}" ]]; then
  echo "DISPATCHER_BEARER_TOKEN is required."
  exit 1
fi

if [[ -z "${TELEMETRY_TOKEN}" ]]; then
  echo "TELEMETRY_BEARER_TOKEN is required."
  exit 1
fi

if [[ -z "${POWERGRID_QUEUE_URL}" ]]; then
  echo "SQS_POWERGRID_ETA_UPDATED_URL is required."
  exit 1
fi

require_status() {
  local actual="$1"
  local expected="$2"
  local label="$3"
  if [[ "${actual}" != "${expected}" ]]; then
    echo "[FAIL] ${label}: expected ${expected}, got ${actual}"
    exit 1
  fi
}

extract_json_field() {
  local file_path="$1"
  local expression="$2"
  node -e "
    const fs = require('fs');
    const payload = JSON.parse(fs.readFileSync(process.argv[1], 'utf8'));
    const fn = new Function('payload', \`return ${expression};\`);
    const value = fn(payload);
    if (value === undefined || value === null || value === '') process.exit(1);
    if (typeof value === 'object') {
      console.log(JSON.stringify(value));
    } else {
      console.log(value);
    }
  " "${file_path}"
}

receive_matching_powergrid_message() {
  local incident_id="$1"
  local output_file="$2"
  local receipt_file="$3"

  for attempt in $(seq 1 "${QUEUE_POLL_ATTEMPTS}"); do
    local response_file="/tmp/e2e-async-queue-${attempt}.json"
    aws sqs receive-message \
      --queue-url "${POWERGRID_QUEUE_URL}" \
      --max-number-of-messages 5 \
      --wait-time-seconds "${QUEUE_WAIT_SECONDS}" \
      --message-attribute-names All > "${response_file}"

    if node -e "
      const fs = require('fs');
      const response = JSON.parse(fs.readFileSync(process.argv[1], 'utf8') || '{}');
      const messages = response.Messages || [];
      const incidentId = process.argv[2];
      const match = messages.find((message) => {
        try {
          const body = JSON.parse(message.Body);
          return body.incident_id === incidentId && body.event_type === 'RESOURCE_ETA_UPDATED';
        } catch {
          return false;
        }
      });
      if (!match) process.exit(1);
      fs.writeFileSync(process.argv[3], JSON.stringify(JSON.parse(match.Body), null, 2));
      fs.writeFileSync(process.argv[4], match.ReceiptHandle);
    " "${response_file}" "${incident_id}" "${output_file}" "${receipt_file}"; then
      return 0
    fi
  done

  return 1
}

ensure_no_matching_powergrid_message() {
  local incident_id="$1"

  for attempt in $(seq 1 3); do
    local response_file="/tmp/e2e-async-none-${attempt}.json"
    aws sqs receive-message \
      --queue-url "${POWERGRID_QUEUE_URL}" \
      --max-number-of-messages 5 \
      --wait-time-seconds 1 \
      --message-attribute-names All > "${response_file}"

    if node -e "
      const fs = require('fs');
      const response = JSON.parse(fs.readFileSync(process.argv[1], 'utf8') || '{}');
      const messages = response.Messages || [];
      const incidentId = process.argv[2];
      const found = messages.some((message) => {
        try {
          const body = JSON.parse(message.Body);
          return body.incident_id === incidentId && body.event_type === 'RESOURCE_ETA_UPDATED';
        } catch {
          return false;
        }
      });
      process.exit(found ? 0 : 1);
    " "${response_file}" "${incident_id}"; then
      echo "[FAIL] Unexpected extra PowerGrid ETA event found for ${incident_id}"
      exit 1
    fi
  done
}

delete_message() {
  local receipt_handle
  receipt_handle="$(cat "$1")"
  aws sqs delete-message \
    --queue-url "${POWERGRID_QUEUE_URL}" \
    --receipt-handle "${receipt_handle}" >/dev/null
}

echo "[1/6] Allocate PowerGrid mission resource"
ALLOC_KEY="$(node -e "console.log(require('crypto').randomUUID())")"
alloc_code="$(curl -sS -o /tmp/e2e-async-alloc.json -w "%{http_code}" \
  -X POST "${BASE_URL}/v1/incidents/${INCIDENT_ID}/allocations" \
  -H "Authorization: Bearer ${DISPATCHER_TOKEN}" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: ${ALLOC_KEY}" \
  -d '{
    "incident_location": { "lat": 13.7300, "long": 100.5200 },
    "destination": {
      "destination_type": "POWER_NODE",
      "destination_id": "NODE-ASYNC-77",
      "destination_name": "Async Verification Node",
      "location": { "lat": 13.8200, "long": 100.6000 }
    },
    "severity": "HIGH",
    "required_resource_type": "AMBULANCE_VAN",
    "required_capabilities": ["AED"]
  }')"
require_status "${alloc_code}" "201" "POST /v1/incidents/:incident_id/allocations"

RESOURCE_ID="$(extract_json_field /tmp/e2e-async-alloc.json 'payload.resource.resource_id')"
CURRENT_VERSION="$(extract_json_field /tmp/e2e-async-alloc.json 'payload.version')"

echo "[2/6] Confirm initial PowerGrid ETA event"
if ! receive_matching_powergrid_message "${INCIDENT_ID}" /tmp/e2e-async-initial-event.json /tmp/e2e-async-initial-receipt.txt; then
  echo "[FAIL] Initial PowerGrid ETA event was not published."
  exit 1
fi

INITIAL_ETA="$(extract_json_field /tmp/e2e-async-initial-event.json 'payload.eta_minutes')"
delete_message /tmp/e2e-async-initial-receipt.txt

echo "[3/6] Telemetry update with small movement (should stay below threshold)"
small_move_code="$(curl -sS -o /tmp/e2e-async-small-move.json -w "%{http_code}" \
  -X PATCH "${BASE_URL}/v1/resources/${RESOURCE_ID}/telemetry" \
  -H "Authorization: Bearer ${TELEMETRY_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{
    \"version\": ${CURRENT_VERSION},
    \"status\": \"EN_ROUTE\",
    \"current_location\": { \"lat\": 13.7300, \"long\": 100.5200 },
    \"battery_level\": 81
  }")"
require_status "${small_move_code}" "200" "PATCH /v1/resources/:resource_id/telemetry small movement"
CURRENT_VERSION="$(extract_json_field /tmp/e2e-async-small-move.json 'payload.version')"

echo "[4/6] Confirm no PowerGrid ETA event is published below threshold"
ensure_no_matching_powergrid_message "${INCIDENT_ID}"

echo "[5/6] Telemetry update with large movement (should exceed threshold)"
large_move_code="$(curl -sS -o /tmp/e2e-async-large-move.json -w "%{http_code}" \
  -X PATCH "${BASE_URL}/v1/resources/${RESOURCE_ID}/telemetry" \
  -H "Authorization: Bearer ${TELEMETRY_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{
    \"version\": ${CURRENT_VERSION},
    \"status\": \"EN_ROUTE\",
    \"current_location\": { \"lat\": 13.7900, \"long\": 100.5750 },
    \"battery_level\": 79
  }")"
require_status "${large_move_code}" "200" "PATCH /v1/resources/:resource_id/telemetry large movement"

echo "[6/6] Confirm thresholded PowerGrid ETA event is published"
if ! receive_matching_powergrid_message "${INCIDENT_ID}" /tmp/e2e-async-threshold-event.json /tmp/e2e-async-threshold-receipt.txt; then
  echo "[FAIL] Thresholded PowerGrid ETA event was not published."
  exit 1
fi

THRESHOLD_ETA="$(extract_json_field /tmp/e2e-async-threshold-event.json 'payload.eta_minutes')"
delete_message /tmp/e2e-async-threshold-receipt.txt

if ! node -e "
  const fs = require('fs');
  const initial = JSON.parse(fs.readFileSync(process.argv[1], 'utf8'));
  const threshold = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
  if (initial.incident_id !== threshold.incident_id) process.exit(1);
  if (initial.resource.resource_id !== threshold.resource.resource_id) process.exit(1);
  if (initial.destination.destination_id !== threshold.destination.destination_id) process.exit(1);
  if (threshold.event_id === initial.event_id) process.exit(1);
  if (!Number.isInteger(threshold.eta_minutes) || threshold.eta_minutes <= 0) process.exit(1);
" /tmp/e2e-async-initial-event.json /tmp/e2e-async-threshold-event.json; then
  echo "[FAIL] Thresholded PowerGrid ETA event payload did not match the expected follow-up event shape."
  exit 1
fi

echo "[PASS] Async PowerGrid E2E completed successfully."
echo "Incident: ${INCIDENT_ID}"
echo "Resource: ${RESOURCE_ID}"
echo "Initial ETA: ${INITIAL_ETA}"
echo "Threshold ETA: ${THRESHOLD_ETA}"
