# Session 1 Remediation Log

Service: Resource Allocation  
Source review: [self_review_session1.docx](/Users/hamin/Downloads/self_review_session1.docx)

## Summary

The service is currently in a relatively safe position for Anti-Patterns #1 to #3 because it has not yet implemented synchronous service-to-service calls. However, several protections are still only implicit. This log converts the self-review into concrete follow-up actions that can be checked from code and architecture.

## Remediation Rows

| Anti-Pattern | Current Assessment | Evidence | Risk | Proposed Resolution | Priority | Status |
| --- | --- | --- | --- | --- | --- | --- |
| Distributed Monolith | Low risk now, but only because no external sync dependency exists yet | App boots without calling another service in [main.js](/Users/hamin/Documents/CS366/ResourceAllocationService/app/main.js). DB access is lazy through pool creation in [pool.js](/Users/hamin/Documents/CS366/ResourceAllocationService/app/db/pool.js). | A future Shelter Locator or Hospital lookup call could become a hard runtime dependency and block request completion or cascade failures. | Adopt a sync-call policy before adding any downstream call: strict timeout, bounded retry, fallback response, no dependency calls during startup, and correlation-id propagation. | High | Open |
| Shared Database | Clean at the moment | The service owns the `resources` table in [init-db.js](/Users/hamin/Documents/CS366/ResourceAllocationService/app/db/init-db.js). No evidence of joins or direct reads to another service DB. | Future shortcuts could introduce direct DB coupling to another team’s schema. | Document and enforce “one service, one database; all integration through API or events only.” | Medium | Open |
| Chatty Services | Partially clean | `GET /v1/resources/nearby` returns rich data in [nearbyController.js](/Users/hamin/Documents/CS366/ResourceAllocationService/app/controllers/nearbyController.js). `POST /allocations` returns selected resource details in [allocateController.js](/Users/hamin/Documents/CS366/ResourceAllocationService/app/controllers/allocateController.js). | The current self-review overstates telemetry behavior. `PATCH /telemetry` does not return destination details, so some callers may still need another fetch depending on device flow. | Re-review each sync response against the exact caller journey. Update docs to match implementation, then decide whether telemetry needs extra response fields. | Medium | Open |

## Immediate Actions Before Session 2

1. Keep external sync dependencies out of startup and health-check paths.
2. Use the sync-call policy in [sync-call-policy.md](/Users/hamin/Documents/CS366/ResourceAllocationService/docs/sync-call-policy.md) before implementing any downstream integration.
3. Update design documentation so claims about telemetry responses match the current code.
4. Re-check anti-patterns after adding real external dependencies, not just planned ones.
