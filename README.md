# Resource Allocation Service

Resource Allocation microservice for disaster response scenarios. This service is designed to run in AWS Learner Lab with PostgreSQL/PostGIS on RDS.

## Current API

- `GET /health`
- `GET /v1/resources/nearby`
- `POST /v1/incidents/:incident_id/allocations`
- `POST /v1/resources/:resource_id/transport-start`
- `PATCH /v1/resources/:resource_id/telemetry`

## Required environment variables

See [app/env.example](/Users/hamin/Documents/CS366/ResourceAllocationService/app/env.example).

## Local run

```bash
npm install
npm run init-db
npm start
```

## Notes

- `POST /v1/incidents/:incident_id/allocations` supports `?dry_run=true`
- Every response includes `trace_id`
- `Idempotency-Key` is currently required on allocation requests
- `POST /v1/resources/:resource_id/transport-start` is used for `ON_SITE -> TRANSPORTING` transitions
- Idempotency records are stored in DynamoDB via `DYNAMODB_IDEMPOTENCY_TABLE`
- Allocation publish path supports SQS async event `resource.events.powergrid_eta_updated` via `SQS_POWERGRID_ETA_UPDATED_URL`
- Transport start publish path supports SQS async event `resource.events.shelter_transporting` via `SQS_SHELTER_TRANSPORTING_URL`
- Allocation endpoint accepts either `Authorization: Bearer <DISPATCHER_BEARER_TOKEN>` or `Authorization: ApiKey <ALLOCATION_API_KEY>`
- Nearby and transport-start endpoints require `Authorization: Bearer <DISPATCHER_BEARER_TOKEN>`
- Telemetry endpoint requires either `Authorization: Bearer <TELEMETRY_BEARER_TOKEN>` or `Authorization: <TELEMETRY_API_KEY>`
- `resource_id` is locked to UUID format across the service contract and runtime validation

## Out of Scope

This service is responsible only for resource discovery, allocation decisions, and resource telemetry updates.

The following capabilities are explicitly out of scope:

- Creating or managing incident records
- Dispatching notifications or communication to responders
- Managing shelter master data, hospital master data, or destination capacity
- User accounts, authentication, or role management
- Cross-service reporting, analytics, or command-center dashboards
- Long-term route planning or navigation guidance for vehicles
- Direct control of IoT devices beyond accepting telemetry updates

This service may consume destination recommendations from downstream services for transport scenarios, but it does not own or manage those destination domains.

## Architecture Notes

- [Session 1 Remediation Log](/Users/hamin/Documents/CS366/ResourceAllocationService/docs/remediation-log-session1.md)
- [Sync Call Policy](/Users/hamin/Documents/CS366/ResourceAllocationService/docs/sync-call-policy.md)
- [Self-Review vs Implementation Notes](/Users/hamin/Documents/CS366/ResourceAllocationService/docs/self-review-implementation-notes.md)
- [Infra Bootstrap](/Users/hamin/Documents/CS366/ResourceAllocationService/infra/README.md)
- [PowerGrid Consumer Guide](/Users/hamin/Documents/CS366/ResourceAllocationService/docs/powergrid-consumer-guide.md)
- EC2 to RDS validation should cover `GET /v1/resources/nearby`, `POST /v1/incidents/:incident_id/allocations`, `POST /v1/resources/:resource_id/transport-start`, and `PATCH /v1/resources/:resource_id/telemetry`
