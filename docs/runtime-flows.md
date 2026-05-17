# Runtime Flows

This document describes the current behavior implemented in `app/` and is intended to stay tighter than historical design notes.

## 1. Nearby Search

Route:

- `GET /v1/resources/nearby`

Behavior:

- dispatcher bearer token required
- served by both the EC2 Express app and the Lambda/API Gateway path
- reads from PostgreSQL/PostGIS
- returns resource summaries around the requested point

## 2. Allocation

Routes:

- `POST /v1/allocations`
- `POST /v1/incidents/:incident_id/allocations`
- `POST /v1/requests/:request_id/allocations`

Rules:

- `Idempotency-Key` is required
- at least one of `incident_id` or `request_id` must be provided
- body/path identifier conflicts are rejected
- `destination.destination_type` and `destination.location` are required
- `required_resource_type` must match one of:
  - `AMBULANCE_VAN`
  - `RESCUE_BOAT`
  - `HELICOPTER`
  - `POWER_GENERATOR_TRUCK`
  - `SUPPLY_TRUCK`
- matching resources are selected from `AVAILABLE` rows using PostGIS distance and capability filters

State effect:

- dry run: returns a simulated allocation and does not mutate the resource
- live run: selected resource moves to `EN_ROUTE`
- the app stores:
  - `assigned_incident_id`
  - `assigned_request_id`
  - `destination_*`
  - `incident_location`

## 3. Resource Fetch

Route:

- `GET /v1/resources/:resource_id`

Behavior:

- dispatcher bearer token required
- UUID path validation
- returns current state, assignment identifiers, destination fields, incident location, and version

## 4. Telemetry

Route:

- `PATCH /v1/resources/:resource_id/telemetry`

Input highlights:

- UUID `resource_id`
- integer `version`
- optional `status`
- optional `current_location`
- optional `battery_level`
- optional replacement `destination`

Supported statuses:

- `AVAILABLE`
- `ASSIGNED`
- `EN_ROUTE`
- `ON_SITE`
- `TRANSPORTING`
- `RETURNING`

Important flow rule:

- if a resource is currently at `ON_SITE` for `PICKUP_VOLUNTEER` or `PICKUP_SUPPLY`
- and telemetry sets status to `EN_ROUTE`
- and no new destination is provided
- the app retargets the destination back to the stored incident location

Completion behavior:

- completion means next status is `RETURNING` or `AVAILABLE`
- and previous status was `ON_SITE` or `TRANSPORTING`

Event behavior on completion:

- from `TRANSPORTING`
  - publish `REQUEST_COMPLETED` when `assigned_request_id` exists
  - publish `INCIDENT_COMPLETED` when `assigned_incident_id` exists
- for all `POWER_GENERATOR_TRUCK` completions
  - publish `POWERGRID_COMPLETED`

## 5. Transport Start

Route:

- `POST /v1/resources/:resource_id/transport-start`

Rules:

- dispatcher bearer token required
- `Idempotency-Key` is required
- resource must already be assigned and valid for transition to `TRANSPORTING`
- at least one of `incident_id` or `request_id` is required in the body
- provided identifiers must match the resource currently in progress
- `transport_type` must be one of:
  - `SHELTER_EVACUATION`
  - `HOSPITAL_TRANSFER`

Destination lookup behavior:

- `SHELTER_EVACUATION`
  - calls `SHELTER_LOCATOR_BASE_URL`
  - if a shelter is found, destination becomes `SHELTER`
- `HOSPITAL_TRANSFER`
  - calls `HOSPITAL_API_BASE_URL`
  - picks the first open hospital with available capacity
  - creates a transfer request in the hospital service
  - if successful, destination becomes `HOSPITAL`

Response behavior:

- HTTP `200` when a destination was found
- HTTP `202` when the resource was moved to `TRANSPORTING` but destination lookup stayed pending/unavailable
- `server_instruction` is either:
  - `PROCEED_TO_DESTINATION`
  - `DESTINATION_PENDING`

Async behavior:

- when the chosen destination is a shelter, publish `RESOURCE_TRANSPORTING_TO_SHELTER`

## 6. Idempotency

Write flows backed by DynamoDB:

- allocation
- transport-start

Outcomes:

- replay same payload -> cached success response
- reuse key with different payload -> `IDEMPOTENCY_KEY_REUSED`
- concurrent in-flight reuse -> `IDEMPOTENCY_REQUEST_IN_PROGRESS`

## 7. Downstream Dependencies

Current synchronous dependencies outside PostgreSQL:

- Shelter Locator for shelter evacuation lookup
- Hospital API for hospital transfer lookup and transfer-request creation

Current asynchronous downstream channels:

- Power-grid completion queue
- Shelter-transporting queue
- Request-completed queue
- Incident-completed queue
