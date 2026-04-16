# EC2 to RDS End-to-End Checklist

Use this checklist after deploying in AWS Learner Lab to confirm the app, RDS/PostGIS, and DynamoDB idempotency path are all working together.

## Before testing

- Confirm EC2 is running and the app container is up
- Confirm RDS security group allows inbound traffic from the EC2 security group
- Confirm `.env` on EC2 includes:
  - `DB_HOST`
  - `DB_PORT`
  - `DB_USER`
  - `DB_PASSWORD`
  - `DB_NAME`
  - `AWS_REGION`
  - `DYNAMODB_IDEMPOTENCY_TABLE`
  - `DISPATCHER_BEARER_TOKEN`
  - `TELEMETRY_BEARER_TOKEN` or `TELEMETRY_API_KEY`
- Confirm the DynamoDB table exists and EC2 instance role can read/write it
- Confirm PostGIS is enabled in the target database
- Confirm all `resource_id` values are UUIDs

## Basic health

```bash
curl http://44.210.125.19:3000/health
```

Expected:

- HTTP `200`
- JSON with `status: "ok"`
- `trace_id` present

## 1. Search nearby resources

```bash
curl "http://44.210.125.19:3000/v1/resources/nearby?lat=13.7563&long=100.5018&radius_km=5"
  -H "Authorization: Bearer ${DISPATCHER_BEARER_TOKEN}"
```

Expected:

- HTTP `200`
- `count` and `resources` returned
- Each resource has location and distance

Checks:

- DB connectivity works
- PostGIS functions work
- seeded resources are queryable

## 2. Allocate resource with DynamoDB idempotency

```bash
curl -X POST "http://44.210.125.19:3000/v1/incidents/INC-2026-0001/allocations" \
  -H "Authorization: Bearer ${DISPATCHER_BEARER_TOKEN}" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: 11111111-1111-1111-1111-111111111111" \
  -d '{
    "incident_location": { "lat": 13.7563, "long": 100.5018 },
    "severity": "HIGH",
    "required_resource_type": "AMBULANCE_VAN",
    "required_capabilities": ["AED"]
  }'
```

Expected:

- HTTP `201`
- `allocation_id` returned
- `status` is `ASSIGNED`
- `trace_id` present

Then send the exact same request again with the same `Idempotency-Key`.

Expected:

- same response should be replayed
- no duplicate allocation should happen

Checks:

- app can read/write DynamoDB
- idempotency record completes correctly
- app can read/write RDS in one allocation flow

## 3. Update telemetry

Use the actual UUID `resource_id` returned from DB or from the allocation response context.

```bash
curl -X PATCH "http://44.210.125.19:3000/v1/resources/<RESOURCE_UUID>/telemetry" \
  -H "Authorization: Bearer ${TELEMETRY_BEARER_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "version": 2,
    "status": "ON_SITE",
    "current_location": { "lat": 13.7580, "long": 100.5050 },
    "battery_level": 82
  }'
```

Expected:

- HTTP `200`
- updated `status`
- incremented `version`
- `trace_id` present

Checks:

- optimistic locking works
- resource state persists in RDS

## Optional validation in AWS

- Inspect DynamoDB table item for the test `Idempotency-Key`
- Inspect the `resources` row in RDS after allocation and telemetry update
- Confirm CloudWatch or container logs show no DB or DynamoDB errors

## Known follow-up after this checklist

- Add async publisher to SQS for `resource.events.powergrid_eta_updated`
- Add async publisher to SQS for `resource.events.shelter_transporting`
- Add automated integration tests that mock DynamoDB and DB boundaries
