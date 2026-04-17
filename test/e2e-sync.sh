#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://44.201.248.113:3000}"
DISPATCHER_TOKEN="${DISPATCHER_BEARER_TOKEN:-}"
TELEMETRY_TOKEN="${TELEMETRY_BEARER_TOKEN:-}"
INCIDENT_ID="${INCIDENT_ID:-INC-2026-E2E-0001}"

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

echo "[1/10] Health check"
health_code="$(curl -sS -o /tmp/e2e-health.json -w "%{http_code}" "${BASE_URL}/health")"
require_status "${health_code}" "200" "GET /health"

echo "[2/10] Nearby search"
nearby_code="$(curl -sS -o /tmp/e2e-nearby.json -w "%{http_code}" \
  "${BASE_URL}/v1/resources/nearby?lat=13.7563&long=100.5018&radius_km=20" \
  -H "Authorization: Bearer ${DISPATCHER_TOKEN}")"
require_status "${nearby_code}" "200" "GET /v1/resources/nearby"

echo "[3/10] Allocate evacuation resource"
ALLOC_KEY="$(node -e "console.log(require('crypto').randomUUID())")"
alloc_code="$(curl -sS -o /tmp/e2e-alloc.json -w "%{http_code}" \
  -X POST "${BASE_URL}/v1/incidents/${INCIDENT_ID}/allocations" \
  -H "Authorization: Bearer ${DISPATCHER_TOKEN}" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: ${ALLOC_KEY}" \
  -d '{
    "incident_location": { "lat": 13.7563, "long": 100.5018 },
    "destination": {
      "destination_type": "POWER_NODE",
      "destination_id": "NODE-77",
      "location": { "lat": 13.7601, "long": 100.5102 }
    },
    "severity": "HIGH",
    "required_resource_type": "AMBULANCE_VAN",
    "required_capabilities": ["AED"]
  }')"
require_status "${alloc_code}" "201" "POST /v1/incidents/:incident_id/allocations"

RESOURCE_ID="$(node -e "const fs=require('fs');const p=JSON.parse(fs.readFileSync('/tmp/e2e-alloc.json','utf8'));if(!p.resource||!p.resource.resource_id){process.exit(1)};console.log(p.resource.resource_id)")"
ALLOCATED_VERSION="$(node -e "const fs=require('fs');const p=JSON.parse(fs.readFileSync('/tmp/e2e-alloc.json','utf8'));if(!Number.isInteger(p.version)){process.exit(1)};console.log(p.version)")"

echo "[4/10] Replay evacuation allocation (idempotency)"
alloc_replay_code="$(curl -sS -o /tmp/e2e-alloc-replay.json -w "%{http_code}" \
  -X POST "${BASE_URL}/v1/incidents/${INCIDENT_ID}/allocations" \
  -H "Authorization: Bearer ${DISPATCHER_TOKEN}" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: ${ALLOC_KEY}" \
  -d '{
    "incident_location": { "lat": 13.7563, "long": 100.5018 },
    "destination": {
      "destination_type": "POWER_NODE",
      "destination_id": "NODE-77",
      "location": { "lat": 13.7601, "long": 100.5102 }
    },
    "severity": "HIGH",
    "required_resource_type": "AMBULANCE_VAN",
    "required_capabilities": ["AED"]
  }')"
require_status "${alloc_replay_code}" "201" "Allocation idempotency replay"

echo "[5/10] Telemetry update to ON_SITE (evacuation)"
telemetry_code="$(curl -sS -o /tmp/e2e-telemetry.json -w "%{http_code}" \
  -X PATCH "${BASE_URL}/v1/resources/${RESOURCE_ID}/telemetry" \
  -H "Authorization: Bearer ${TELEMETRY_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{
    \"version\": ${ALLOCATED_VERSION},
    \"status\": \"ON_SITE\",
    \"current_location\": { \"lat\": 13.7580, \"long\": 100.5050 },
    \"battery_level\": 82
  }")"
require_status "${telemetry_code}" "200" "PATCH /v1/resources/:resource_id/telemetry"

UPDATED_VERSION="$(node -e "const fs=require('fs');const p=JSON.parse(fs.readFileSync('/tmp/e2e-telemetry.json','utf8'));if(!Number.isInteger(p.version)){process.exit(1)};console.log(p.version)")"

echo "[6/10] Start transport mission (evacuation)"
TRANSPORT_KEY="$(node -e "console.log(require('crypto').randomUUID())")"
transport_code="$(curl -sS -o /tmp/e2e-transport.json -w "%{http_code}" \
  -X POST "${BASE_URL}/v1/resources/${RESOURCE_ID}/transport-start" \
  -H "Authorization: Bearer ${DISPATCHER_TOKEN}" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: ${TRANSPORT_KEY}" \
  -d "{
    \"incident_id\": \"${INCIDENT_ID}\",
    \"transport_type\": \"SHELTER_EVACUATION\",
    \"current_location\": { \"lat\": 13.7580, \"long\": 100.5050 },
    \"passenger_count\": 4,
    \"version\": ${UPDATED_VERSION}
  }")"

if [[ "${transport_code}" != "200" && "${transport_code}" != "202" ]]; then
  echo "[FAIL] POST /v1/resources/:resource_id/transport-start: expected 200 or 202, got ${transport_code}"
  exit 1
fi

TRANSPORT_VERSION="$(node -e "const fs=require('fs');const p=JSON.parse(fs.readFileSync('/tmp/e2e-transport.json','utf8'));if(!Number.isInteger(p.version)){process.exit(1)};console.log(p.version)")"

echo "[7/10] Close evacuation job (TRANSPORTING -> AVAILABLE)"
evac_close_code="$(curl -sS -o /tmp/e2e-evac-close.json -w "%{http_code}" \
  -X PATCH "${BASE_URL}/v1/resources/${RESOURCE_ID}/telemetry" \
  -H "Authorization: Bearer ${TELEMETRY_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{
    \"version\": ${TRANSPORT_VERSION},
    \"status\": \"AVAILABLE\",
    \"current_location\": { \"lat\": 13.7590, \"long\": 100.4850 },
    \"battery_level\": 80
  }")"
require_status "${evac_close_code}" "200" "PATCH /v1/resources/:resource_id/telemetry close evacuation"

echo "[8/10] Allocate general mission resource (generator)"
GENERAL_INCIDENT_ID="${INCIDENT_ID}-GEN"
GENERAL_ALLOC_KEY="$(node -e "console.log(require('crypto').randomUUID())")"
general_alloc_code="$(curl -sS -o /tmp/e2e-general-alloc.json -w "%{http_code}" \
  -X POST "${BASE_URL}/v1/incidents/${GENERAL_INCIDENT_ID}/allocations" \
  -H "Authorization: Bearer ${DISPATCHER_TOKEN}" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: ${GENERAL_ALLOC_KEY}" \
  -d '{
    "incident_location": { "lat": 13.7563, "long": 100.5018 },
    "destination": {
      "destination_type": "POWER_NODE",
      "destination_id": "NODE-88",
      "location": { "lat": 13.7611, "long": 100.5122 }
    },
    "severity": "MEDIUM",
    "required_resource_type": "POWER_GENERATOR_TRUCK",
    "required_capabilities": ["200KW"]
  }')"
require_status "${general_alloc_code}" "201" "POST /v1/incidents/:incident_id/allocations general mission"

GENERAL_RESOURCE_ID="$(node -e "const fs=require('fs');const p=JSON.parse(fs.readFileSync('/tmp/e2e-general-alloc.json','utf8'));if(!p.resource||!p.resource.resource_id){process.exit(1)};console.log(p.resource.resource_id)")"
GENERAL_ALLOC_VERSION="$(node -e "const fs=require('fs');const p=JSON.parse(fs.readFileSync('/tmp/e2e-general-alloc.json','utf8'));if(!Number.isInteger(p.version)){process.exit(1)};console.log(p.version)")"

echo "[9/10] Telemetry update to ON_SITE (general mission)"
general_onsite_code="$(curl -sS -o /tmp/e2e-general-onsite.json -w "%{http_code}" \
  -X PATCH "${BASE_URL}/v1/resources/${GENERAL_RESOURCE_ID}/telemetry" \
  -H "Authorization: Bearer ${TELEMETRY_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{
    \"version\": ${GENERAL_ALLOC_VERSION},
    \"status\": \"ON_SITE\",
    \"current_location\": { \"lat\": 13.7611, \"long\": 100.5122 },
    \"battery_level\": 70
  }")"
require_status "${general_onsite_code}" "200" "PATCH /v1/resources/:resource_id/telemetry general ON_SITE"

GENERAL_ONSITE_VERSION="$(node -e "const fs=require('fs');const p=JSON.parse(fs.readFileSync('/tmp/e2e-general-onsite.json','utf8'));if(!Number.isInteger(p.version)){process.exit(1)};console.log(p.version)")"

echo "[10/10] Close general mission (ON_SITE -> AVAILABLE)"
general_close_code="$(curl -sS -o /tmp/e2e-general-close.json -w "%{http_code}" \
  -X PATCH "${BASE_URL}/v1/resources/${GENERAL_RESOURCE_ID}/telemetry" \
  -H "Authorization: Bearer ${TELEMETRY_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{
    \"version\": ${GENERAL_ONSITE_VERSION},
    \"status\": \"AVAILABLE\",
    \"current_location\": { \"lat\": 13.7611, \"long\": 100.5122 },
    \"battery_level\": 68
  }")"
require_status "${general_close_code}" "200" "PATCH /v1/resources/:resource_id/telemetry close general mission"

echo "[PASS] Synchronous API E2E completed with close-out flows."
echo "Evacuation resource: ${RESOURCE_ID}"
echo "General mission resource: ${GENERAL_RESOURCE_ID}"
