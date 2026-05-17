# Async Event Guide

This service currently publishes directly to SQS.

## Queue Map

- `SQS_POWERGRID_COMPLETED_URL` -> `POWERGRID_COMPLETED`
- `SQS_SHELTER_TRANSPORTING_URL` -> `RESOURCE_TRANSPORTING_TO_SHELTER`
- `SQS_USER_LOCATION_REQUEST_COMPLETED_URL` -> `REQUEST_COMPLETED`
- `SQS_INCIDENT_REPORTER_COMPLETED_URL` -> `INCIDENT_COMPLETED`

Terraform outputs use shorter queue names:

- `sqs_powergrid_completed_url`
- `sqs_shelter_transporting_url`
- `sqs_request_completed_url`
- `sqs_incident_completed_url`

## Publish Rules

### `POWERGRID_COMPLETED`

Published when:

- a `POWER_GENERATOR_TRUCK` completes work
- and telemetry moves from `ON_SITE` or `TRANSPORTING`
- to `AVAILABLE` or `RETURNING`

Notes:

- destination may be a `POWER_NODE`
- destination may also reflect other in-progress mission context because the current app publishes for all generator completions

### `RESOURCE_TRANSPORTING_TO_SHELTER`

Published when:

- `transport-start` succeeds with a found shelter destination

### `REQUEST_COMPLETED`

Published when:

- telemetry completes a transport flow from `TRANSPORTING`
- and the resource still carries `assigned_request_id`

### `INCIDENT_COMPLETED`

Published when:

- telemetry completes a transport flow from `TRANSPORTING`
- and the resource still carries `assigned_incident_id`

## Delivery Characteristics

- SQS standard queues
- at-least-once delivery
- consumers must be idempotent
- correlation id is forwarded as message attribute `x-correlation-id`

## Example Payload Shapes

### `POWERGRID_COMPLETED`

```json
{
  "event_id": "uuid",
  "event_type": "POWERGRID_COMPLETED",
  "timestamp": "2026-05-10T00:00:00.000Z",
  "incident_id": "INC-2026-0001",
  "request_id": "REQ-2026-0001",
  "source_service": "ResourceAllocationService",
  "resource": {
    "resource_id": "550e8400-e29b-41d4-a716-446655440000",
    "resource_type": "POWER_GENERATOR_TRUCK"
  },
  "destination": {
    "destination_type": "POWER_NODE",
    "destination_id": "NODE-77",
    "destination_name": "Substation 77"
  },
  "final_status": "AVAILABLE",
  "completed_at": "2026-05-10T00:00:00.000Z"
}
```

### `RESOURCE_TRANSPORTING_TO_SHELTER`

```json
{
  "event_id": "uuid",
  "event_type": "RESOURCE_TRANSPORTING_TO_SHELTER",
  "timestamp": "2026-05-10T00:00:00.000Z",
  "incident_id": "INC-2026-0001",
  "request_id": "REQ-2026-0001",
  "allocation_id": null,
  "shelter_id": "SHELTER-001",
  "source_service": "ResourceAllocationService",
  "resource": {
    "resource_id": "550e8400-e29b-41d4-a716-446655440000",
    "resource_type": "AMBULANCE_VAN"
  },
  "destination": {
    "destination_type": "SHELTER",
    "destination_id": "SHELTER-001",
    "shelter_id": "SHELTER-001",
    "destination_name": "Bangkok Shelter A"
  },
  "status": "TRANSPORTING",
  "passenger_count": 4,
  "eta_minutes": 12
}
```

## Consumer Guidance

- long polling is preferred
- treat `event_id` as the deduplication key
- delete messages only after successful local processing
