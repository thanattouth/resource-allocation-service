#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://127.0.0.1:3000}"
DISPATCHER_TOKEN="${DISPATCHER_BEARER_TOKEN:-}"
TELEMETRY_TOKEN="${TELEMETRY_BEARER_TOKEN:-}"
INCIDENT_ID="${INCIDENT_ID:-INC-2026-E2E-SYNC-$(date +%s)}"

if [[ -z "${DISPATCHER_TOKEN}" ]]; then
  echo "DISPATCHER_BEARER_TOKEN is required."
  exit 1
fi

if [[ -z "${TELEMETRY_TOKEN}" ]]; then
  echo "TELEMETRY_BEARER_TOKEN is required."
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

echo "[1/12] Health check"
health_code="$(curl -sS -o /tmp/e2e-health.json -w "%{http_code}" "${BASE_URL}/health")"
require_status "${health_code}" "200" "GET /health"

echo "[2/12] Nearby search"
nearby_code="$(curl -sS -o /tmp/e2e-nearby.json -w "%{http_code}" \
  "${BASE_URL}/v1/resources/nearby?lat=13.7563&long=100.5018&radius_km=20" \
  -H "Authorization: Bearer ${DISPATCHER_TOKEN}")"
require_status "${nearby_code}" "200" "GET /v1/resources/nearby"

echo "[3/12] Allocate generator to a power node"
GEN_ALLOC_KEY="$(node -e "console.log(require('crypto').randomUUID())")"
gen_alloc_code="$(curl -sS -o /tmp/e2e-gen-alloc.json -w "%{http_code}" \
  -X POST "${BASE_URL}/v1/incidents/${INCIDENT_ID}/allocations" \
  -H "Authorization: Bearer ${DISPATCHER_TOKEN}" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: ${GEN_ALLOC_KEY}" \
  -d '{
    "incident_location": { "lat": 13.7563, "long": 100.5018 },
    "destination": {
      "destination_type": "POWER_NODE",
      "destination_id": "NODE-77",
      "destination_name": "Substation 77",
      "location": { "lat": 13.7601, "long": 100.5102 }
    },
    "severity": "HIGH",
    "required_resource_type": "POWER_GENERATOR_TRUCK",
    "required_capabilities": ["200KW"]
  }')"
require_status "${gen_alloc_code}" "201" "POST power-grid allocation"

GEN_RESOURCE_ID="$(extract_json_field /tmp/e2e-gen-alloc.json 'payload.resource.resource_id')"
GEN_VERSION="$(extract_json_field /tmp/e2e-gen-alloc.json 'payload.version')"

echo "[4/12] Confirm resource fetch works"
gen_fetch_code="$(curl -sS -o /tmp/e2e-gen-resource.json -w "%{http_code}" \
  "${BASE_URL}/v1/resources/${GEN_RESOURCE_ID}" \
  -H "Authorization: Bearer ${DISPATCHER_TOKEN}")"
require_status "${gen_fetch_code}" "200" "GET /v1/resources/:resource_id"

echo "[5/12] Move generator to ON_SITE"
gen_onsite_code="$(curl -sS -o /tmp/e2e-gen-onsite.json -w "%{http_code}" \
  -X PATCH "${BASE_URL}/v1/resources/${GEN_RESOURCE_ID}/telemetry" \
  -H "Authorization: Bearer ${TELEMETRY_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{
    \"version\": ${GEN_VERSION},
    \"status\": \"ON_SITE\",
    \"current_location\": { \"lat\": 13.7601, \"long\": 100.5102 },
    \"battery_level\": 81
  }")"
require_status "${gen_onsite_code}" "200" "PATCH generator ON_SITE"
GEN_VERSION="$(extract_json_field /tmp/e2e-gen-onsite.json 'payload.version')"

echo "[6/12] Complete generator mission"
gen_close_code="$(curl -sS -o /tmp/e2e-gen-close.json -w "%{http_code}" \
  -X PATCH "${BASE_URL}/v1/resources/${GEN_RESOURCE_ID}/telemetry" \
  -H "Authorization: Bearer ${TELEMETRY_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{
    \"version\": ${GEN_VERSION},
    \"status\": \"AVAILABLE\",
    \"current_location\": { \"lat\": 13.7601, \"long\": 100.5102 },
    \"battery_level\": 79
  }")"
require_status "${gen_close_code}" "200" "PATCH generator AVAILABLE"

echo "[7/12] Allocate request-only pickup mission"
REQ_ID="REQ-2026-E2E-$(date +%s)"
PICKUP_ALLOC_KEY="$(node -e "console.log(require('crypto').randomUUID())")"
pickup_alloc_code="$(curl -sS -o /tmp/e2e-pickup-alloc.json -w "%{http_code}" \
  -X POST "${BASE_URL}/v1/requests/${REQ_ID}/allocations" \
  -H "Authorization: Bearer ${DISPATCHER_TOKEN}" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: ${PICKUP_ALLOC_KEY}" \
  -d '{
    "incident_location": { "lat": 13.7800, "long": 100.5200 },
    "destination": {
      "destination_type": "PICKUP_VOLUNTEER",
      "destination_id": "VOL-001",
      "destination_name": "Volunteer Pickup",
      "location": { "lat": 13.7850, "long": 100.5250 }
    },
    "required_resource_type": "RESCUE_BOAT",
    "required_capabilities": ["FLOOD_RESCUE"]
  }')"
require_status "${pickup_alloc_code}" "201" "POST request-only pickup allocation"

PICKUP_RESOURCE_ID="$(extract_json_field /tmp/e2e-pickup-alloc.json 'payload.resource.resource_id')"
PICKUP_VERSION="$(extract_json_field /tmp/e2e-pickup-alloc.json 'payload.version')"

echo "[8/12] Reach pickup point"
pickup_onsite_code="$(curl -sS -o /tmp/e2e-pickup-onsite.json -w "%{http_code}" \
  -X PATCH "${BASE_URL}/v1/resources/${PICKUP_RESOURCE_ID}/telemetry" \
  -H "Authorization: Bearer ${TELEMETRY_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{
    \"version\": ${PICKUP_VERSION},
    \"status\": \"ON_SITE\",
    \"current_location\": { \"lat\": 13.7850, \"long\": 100.5250 }
  }")"
require_status "${pickup_onsite_code}" "200" "PATCH pickup ON_SITE"
PICKUP_VERSION="$(extract_json_field /tmp/e2e-pickup-onsite.json 'payload.version')"

echo "[9/12] Retarget pickup mission back to incident"
pickup_enroute_code="$(curl -sS -o /tmp/e2e-pickup-enroute.json -w "%{http_code}" \
  -X PATCH "${BASE_URL}/v1/resources/${PICKUP_RESOURCE_ID}/telemetry" \
  -H "Authorization: Bearer ${TELEMETRY_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{
    \"version\": ${PICKUP_VERSION},
    \"status\": \"EN_ROUTE\",
    \"current_location\": { \"lat\": 13.7850, \"long\": 100.5250 }
  }")"
require_status "${pickup_enroute_code}" "200" "PATCH pickup EN_ROUTE"
PICKUP_VERSION="$(extract_json_field /tmp/e2e-pickup-enroute.json 'payload.version')"

echo "[10/12] Reach incident after pickup"
pickup_incident_code="$(curl -sS -o /tmp/e2e-pickup-incident.json -w "%{http_code}" \
  -X PATCH "${BASE_URL}/v1/resources/${PICKUP_RESOURCE_ID}/telemetry" \
  -H "Authorization: Bearer ${TELEMETRY_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{
    \"version\": ${PICKUP_VERSION},
    \"status\": \"ON_SITE\",
    \"current_location\": { \"lat\": 13.7800, \"long\": 100.5200 }
  }")"
require_status "${pickup_incident_code}" "200" "PATCH incident ON_SITE"
PICKUP_VERSION="$(extract_json_field /tmp/e2e-pickup-incident.json 'payload.version')"

echo "[11/12] Start shelter evacuation transport"
TRANSPORT_KEY="$(node -e "console.log(require('crypto').randomUUID())")"
transport_code="$(curl -sS -o /tmp/e2e-transport.json -w "%{http_code}" \
  -X POST "${BASE_URL}/v1/resources/${PICKUP_RESOURCE_ID}/transport-start" \
  -H "Authorization: Bearer ${DISPATCHER_TOKEN}" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: ${TRANSPORT_KEY}" \
  -d "{
    \"request_id\": \"${REQ_ID}\",
    \"transport_type\": \"SHELTER_EVACUATION\",
    \"current_location\": { \"lat\": 13.7800, \"long\": 100.5200 },
    \"passenger_count\": 4,
    \"version\": ${PICKUP_VERSION}
  }")"
if [[ "${transport_code}" != "200" && "${transport_code}" != "202" ]]; then
  echo "[FAIL] POST /v1/resources/:resource_id/transport-start: expected 200 or 202, got ${transport_code}"
  exit 1
fi
PICKUP_VERSION="$(extract_json_field /tmp/e2e-transport.json 'payload.version')"

echo "[12/12] Close the transport mission"
pickup_close_code="$(curl -sS -o /tmp/e2e-pickup-close.json -w "%{http_code}" \
  -X PATCH "${BASE_URL}/v1/resources/${PICKUP_RESOURCE_ID}/telemetry" \
  -H "Authorization: Bearer ${TELEMETRY_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{
    \"version\": ${PICKUP_VERSION},
    \"status\": \"AVAILABLE\",
    \"current_location\": { \"lat\": 13.7900, \"long\": 100.4850 }
  }")"
require_status "${pickup_close_code}" "200" "PATCH transport completion"

echo "[PASS] Sync E2E covered nearby, allocation, pickup retargeting, transport-start, and completion."
echo "Generator resource: ${GEN_RESOURCE_ID}"
echo "Pickup resource: ${PICKUP_RESOURCE_ID}"
