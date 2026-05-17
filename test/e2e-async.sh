#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://127.0.0.1:3000}"
DISPATCHER_TOKEN="${DISPATCHER_BEARER_TOKEN:-}"
TELEMETRY_TOKEN="${TELEMETRY_BEARER_TOKEN:-}"
POWERGRID_QUEUE_URL="${SQS_POWERGRID_COMPLETED_URL:-}"
REQUEST_COMPLETED_QUEUE_URL="${SQS_USER_LOCATION_REQUEST_COMPLETED_URL:-}"
INCIDENT_COMPLETED_QUEUE_URL="${SQS_INCIDENT_REPORTER_COMPLETED_URL:-}"
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
  echo "SQS_POWERGRID_COMPLETED_URL is required."
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
    if (typeof value === 'object') console.log(JSON.stringify(value));
    else console.log(value);
  " "${file_path}"
}

receive_matching_message() {
  local queue_url="$1"
  local event_type="$2"
  local incident_id="$3"
  local output_file="$4"
  local receipt_file="$5"

  for attempt in $(seq 1 "${QUEUE_POLL_ATTEMPTS}"); do
    local response_file="/tmp/e2e-queue-${event_type}-${attempt}.json"
    aws sqs receive-message \
      --queue-url "${queue_url}" \
      --max-number-of-messages 5 \
      --wait-time-seconds "${QUEUE_WAIT_SECONDS}" \
      --message-attribute-names All > "${response_file}"

    if node -e "
      const fs = require('fs');
      const response = JSON.parse(fs.readFileSync(process.argv[1], 'utf8') || '{}');
      const eventType = process.argv[2];
      const incidentId = process.argv[3];
      const messages = response.Messages || [];
      const match = messages.find((message) => {
        try {
          const body = JSON.parse(message.Body);
          return body.event_type === eventType && body.incident_id === incidentId;
        } catch {
          return false;
        }
      });
      if (!match) process.exit(1);
      fs.writeFileSync(process.argv[4], JSON.stringify(JSON.parse(match.Body), null, 2));
      fs.writeFileSync(process.argv[5], match.ReceiptHandle);
    " "${response_file}" "${event_type}" "${incident_id}" "${output_file}" "${receipt_file}"; then
      return 0
    fi
  done

  return 1
}

delete_message() {
  local queue_url="$1"
  local receipt_file="$2"
  local receipt_handle
  receipt_handle="$(cat "${receipt_file}")"
  aws sqs delete-message --queue-url "${queue_url}" --receipt-handle "${receipt_handle}" >/dev/null
}

echo "[1/5] Allocate generator for async completion"
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
    "required_resource_type": "POWER_GENERATOR_TRUCK",
    "required_capabilities": ["200KW"]
  }')"
require_status "${alloc_code}" "201" "POST async allocation"

RESOURCE_ID="$(extract_json_field /tmp/e2e-async-alloc.json 'payload.resource.resource_id')"
CURRENT_VERSION="$(extract_json_field /tmp/e2e-async-alloc.json 'payload.version')"

echo "[2/5] Move generator to ON_SITE"
onsite_code="$(curl -sS -o /tmp/e2e-async-onsite.json -w "%{http_code}" \
  -X PATCH "${BASE_URL}/v1/resources/${RESOURCE_ID}/telemetry" \
  -H "Authorization: Bearer ${TELEMETRY_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{
    \"version\": ${CURRENT_VERSION},
    \"status\": \"ON_SITE\",
    \"current_location\": { \"lat\": 13.8200, \"long\": 100.6000 },
    \"battery_level\": 81
  }")"
require_status "${onsite_code}" "200" "PATCH async ON_SITE"
CURRENT_VERSION="$(extract_json_field /tmp/e2e-async-onsite.json 'payload.version')"

echo "[3/5] Complete generator mission"
close_code="$(curl -sS -o /tmp/e2e-async-close.json -w "%{http_code}" \
  -X PATCH "${BASE_URL}/v1/resources/${RESOURCE_ID}/telemetry" \
  -H "Authorization: Bearer ${TELEMETRY_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{
    \"version\": ${CURRENT_VERSION},
    \"status\": \"AVAILABLE\",
    \"current_location\": { \"lat\": 13.7900, \"long\": 100.5750 },
    \"battery_level\": 79
  }")"
require_status "${close_code}" "200" "PATCH async completion"

echo "[4/5] Confirm POWERGRID_COMPLETED on SQS"
if ! receive_matching_message "${POWERGRID_QUEUE_URL}" "POWERGRID_COMPLETED" "${INCIDENT_ID}" \
  /tmp/e2e-async-powergrid-event.json /tmp/e2e-async-powergrid-receipt.txt; then
  echo "[FAIL] POWERGRID_COMPLETED event was not published."
  exit 1
fi
delete_message "${POWERGRID_QUEUE_URL}" /tmp/e2e-async-powergrid-receipt.txt

node -e "
  const fs = require('fs');
  const payload = JSON.parse(fs.readFileSync(process.argv[1], 'utf8'));
  if (payload.event_type !== 'POWERGRID_COMPLETED') process.exit(1);
  if (payload.incident_id !== process.argv[2]) process.exit(1);
  if (payload.destination.destination_id !== 'NODE-ASYNC-77') process.exit(1);
  if (!['AVAILABLE', 'RETURNING'].includes(payload.final_status)) process.exit(1);
" /tmp/e2e-async-powergrid-event.json "${INCIDENT_ID}"

echo "[5/5] Optionally inspect request/incident completion queues"
if [[ -n "${REQUEST_COMPLETED_QUEUE_URL}" ]]; then
  echo "Request completion queue configured: ${REQUEST_COMPLETED_QUEUE_URL}"
fi
if [[ -n "${INCIDENT_COMPLETED_QUEUE_URL}" ]]; then
  echo "Incident completion queue configured: ${INCIDENT_COMPLETED_QUEUE_URL}"
fi

echo "[PASS] Async E2E verified generator completion publishing."
echo "Incident: ${INCIDENT_ID}"
echo "Resource: ${RESOURCE_ID}"
