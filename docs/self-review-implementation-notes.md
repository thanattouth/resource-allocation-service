# Self-Review vs Implementation Notes

This note compares the current self-review statements in [self_review_session1.docx](/Users/hamin/Downloads/self_review_session1.docx) against the actual implementation in this repository.

## Accurate Statements

- The service does not currently make outbound service-to-service calls during startup.
- The database connection is lazy through the PostgreSQL pool in [pool.js](/Users/hamin/Documents/CS366/ResourceAllocationService/app/db/pool.js).
- `GET /v1/resources/nearby` returns rich resource details in [nearbyController.js](/Users/hamin/Documents/CS366/ResourceAllocationService/app/controllers/nearbyController.js).
- `POST /v1/incidents/:incident_id/allocations` returns selected resource details immediately in [allocateController.js](/Users/hamin/Documents/CS366/ResourceAllocationService/app/controllers/allocateController.js).

## Statements That Need Tightening

- The self-review says `PATCH /telemetry` returns destination information back to the IoT device.
  Current code in [telemetryController.js](/Users/hamin/Documents/CS366/ResourceAllocationService/app/controllers/telemetryController.js) only returns `resource_id`, `status`, `server_instruction`, `last_updated_at`, and `trace_id`.
- The self-review marks Chatty Services as clean.
  That is mostly true for search and allocation, but only partially true for telemetry because the response may still be too thin for some device-side flows.
- The self-review says Distributed Monolith is safe.
  That is true only for the current codebase state. It should be recorded as “safe for now, but must be re-evaluated when the first downstream sync integration is added.”

## What To Say In Session 2

Use this wording:

1. Distributed Monolith is not currently detected in code, but the risk is forward-looking because no external sync dependency has been implemented yet.
2. Shared Database is currently clean because this service owns its schema and does not read another service’s database directly.
3. Chatty Services is mostly clean for search and allocation, but telemetry should be called “partially verified” until the exact caller response needs are finalized.
