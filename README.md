# Resource Allocation Service

Resource Allocation Service for disaster-response scenarios in AWS Learner Lab. The current system combines:

- an always-on Express app on EC2 for write-heavy workflows
- PostgreSQL/PostGIS for resource state and geospatial search
- DynamoDB for idempotency
- SQS for downstream completion and transport events
- a separate Lambda + API Gateway path for `GET /v1/resources/nearby`

## Runtime Surface

### App routes

- `GET /health`
- `GET /v1/resources/nearby`
- `GET /v1/resources/:resource_id`
- `POST /v1/allocations`
- `POST /v1/incidents/:incident_id/allocations`
- `POST /v1/requests/:request_id/allocations`
- `POST /v1/resources/:resource_id/transport-start`
- `PATCH /v1/resources/:resource_id/telemetry`

### Core behaviors

- `resource_id` is always a UUID
- all write flows require `Idempotency-Key`
- allocation accepts either `incident_id`, `request_id`, or both
- allocation supports `?dry_run=true`
- pickup flows can retarget `ON_SITE -> EN_ROUTE` back to the stored incident location without a new destination payload
- `transport-start` supports both `SHELTER_EVACUATION` and `HOSPITAL_TRANSFER`
- telemetry completion can publish async events depending on the previous state and resource type

## Auth Model

- Dispatcher-only:
  - `GET /v1/resources/nearby`
  - `GET /v1/resources/:resource_id`
  - `POST /v1/resources/:resource_id/transport-start`
- Allocation:
  - `Authorization: Bearer <DISPATCHER_BEARER_TOKEN>`
  - or `Authorization: ApiKey <ALLOCATION_API_KEY>`
- Telemetry:
  - `Authorization: Bearer <TELEMETRY_BEARER_TOKEN>`
  - or `Authorization: <TELEMETRY_API_KEY>`

See [app/env.example](/Users/hamin/Documents/CS366/ResourceAllocationService/app/env.example) for the current environment surface.

## Async Events

Current publish paths in the app:

- `SQS_POWERGRID_COMPLETED_URL` -> `POWERGRID_COMPLETED`
- `SQS_SHELTER_TRANSPORTING_URL` -> `RESOURCE_TRANSPORTING_TO_SHELTER`
- `SQS_USER_LOCATION_REQUEST_COMPLETED_URL` -> `REQUEST_COMPLETED`
- `SQS_INCIDENT_REPORTER_COMPLETED_URL` -> `INCIDENT_COMPLETED`

Notes:

- request and incident completion events are published only when a completion transition comes from `TRANSPORTING`
- power-grid completion is published for all `POWER_GENERATOR_TRUCK` completion transitions
- shelter transporting is published only when `transport-start` found a shelter destination

## Local Development

```bash
npm install
npm run init-db
npm run check
npm test
npm start
```

## Repo Guide

- App runtime: [app/main.js](/Users/hamin/Documents/CS366/ResourceAllocationService/app/main.js)
- Deployment infra: [infra/README.md](/Users/hamin/Documents/CS366/ResourceAllocationService/infra/README.md)
- Runtime flows and event rules: [docs/runtime-flows.md](/Users/hamin/Documents/CS366/ResourceAllocationService/docs/runtime-flows.md)
- AWS rebuild steps: [docs/new-learner-lab-rebuild.md](/Users/hamin/Documents/CS366/ResourceAllocationService/docs/new-learner-lab-rebuild.md)
- Nearby Lambda deployment notes: [docs/nearby-lambda-migration.md](/Users/hamin/Documents/CS366/ResourceAllocationService/docs/nearby-lambda-migration.md)
- E2E checklist: [docs/ec2-rds-e2e-checklist.md](/Users/hamin/Documents/CS366/ResourceAllocationService/docs/ec2-rds-e2e-checklist.md)
- Async consumer contracts: [docs/async-events.md](/Users/hamin/Documents/CS366/ResourceAllocationService/docs/async-events.md)
