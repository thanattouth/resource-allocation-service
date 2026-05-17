# EC2 / RDS End-to-End Checklist

Use this after deploying the current Learner Lab stack.

## Quick Commands

Sync validation:

```bash
BASE_URL="http://<ec2-public-ip>:3000" \
DISPATCHER_BEARER_TOKEN="..." \
TELEMETRY_BEARER_TOKEN="..." \
npm run test:e2e:sync
```

Async validation:

```bash
BASE_URL="http://<ec2-public-ip>:3000" \
DISPATCHER_BEARER_TOKEN="..." \
TELEMETRY_BEARER_TOKEN="..." \
SQS_POWERGRID_COMPLETED_URL="..." \
npm run test:e2e:async
```

## Prerequisites

- EC2 is up and the app container is running
- RDS is reachable from the EC2 security group
- DynamoDB table exists and the instance role can read/write it
- PostGIS and `pgcrypto` are enabled in the target database
- `.env` on EC2 includes the current runtime variables from [app/env.example](/Users/hamin/Documents/CS366/ResourceAllocationService/app/env.example)

Useful minimum set:

- `DB_HOST`
- `DB_PORT`
- `DB_USER`
- `DB_PASSWORD`
- `DB_NAME`
- `AWS_REGION`
- `DYNAMODB_IDEMPOTENCY_TABLE`
- `DISPATCHER_BEARER_TOKEN`
- `ALLOCATION_API_KEY`
- `TELEMETRY_BEARER_TOKEN` or `TELEMETRY_API_KEY`

Optional but flow-dependent:

- `SHELTER_LOCATOR_BASE_URL`
- `HOSPITAL_API_BASE_URL`
- `SQS_POWERGRID_COMPLETED_URL`
- `SQS_SHELTER_TRANSPORTING_URL`
- `SQS_USER_LOCATION_REQUEST_COMPLETED_URL`
- `SQS_INCIDENT_REPORTER_COMPLETED_URL`

## What The Current E2E Scripts Cover

### `test/e2e-sync.sh`

- health check
- nearby search
- power-grid allocation and completion
- request-only pickup allocation
- pickup `ON_SITE -> EN_ROUTE -> ON_SITE` incident handoff
- shelter transport start
- shelter completion closeout

### `test/e2e-async.sh`

- power-generator allocation to a power node
- `ON_SITE -> AVAILABLE` completion
- polling SQS for `POWERGRID_COMPLETED`

Optional queue checks for request and incident completion are performed only when the corresponding queue URLs are present.

## Manual Spot Checks

### 1. Health

```bash
curl "http://<ec2-public-ip>:3000/health"
```

Expect:

- HTTP `200`
- `status: "ok"`
- `trace_id`

### 2. Nearby

```bash
curl "http://<ec2-public-ip>:3000/v1/resources/nearby?lat=13.7563&long=100.5018&radius_km=20" \
  -H "Authorization: Bearer ${DISPATCHER_BEARER_TOKEN}"
```

Expect:

- HTTP `200`
- resources and distance fields

### 3. Resource Fetch

```bash
curl "http://<ec2-public-ip>:3000/v1/resources/<RESOURCE_UUID>" \
  -H "Authorization: Bearer ${DISPATCHER_BEARER_TOKEN}"
```

Expect:

- HTTP `200`
- UUID resource
- version
- assignment and destination fields when active

### 4. Transport Start

For transport flows, expect either:

- `200` + `PROCEED_TO_DESTINATION`
- or `202` + `DESTINATION_PENDING`

## Database / Queue Validation

After a run, confirm:

- resource versions increment over time
- `assigned_incident_id` and `assigned_request_id` are cleared after completion to `AVAILABLE`
- power-grid completion messages appear on the power-grid queue when configured
- request and incident completion messages appear after transport completion when configured

## Known Limits

- the E2E scripts hit real downstream services for shelter/hospital lookup behavior
- local `npm test` is intentionally lighter and avoids binding a test server in restricted environments
