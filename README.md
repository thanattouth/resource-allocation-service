# Resource Allocation Service

Resource Allocation microservice for disaster response scenarios. This service is designed to run in AWS Learner Lab with PostgreSQL/PostGIS on RDS.

## Current API

- `GET /health`
- `GET /v1/resources/nearby`
- `POST /v1/incidents/:incident_id/allocations`
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

## Architecture Notes

- [Session 1 Remediation Log](/Users/hamin/Documents/CS366/ResourceAllocationService/docs/remediation-log-session1.md)
- [Sync Call Policy](/Users/hamin/Documents/CS366/ResourceAllocationService/docs/sync-call-policy.md)
- [Self-Review vs Implementation Notes](/Users/hamin/Documents/CS366/ResourceAllocationService/docs/self-review-implementation-notes.md)
