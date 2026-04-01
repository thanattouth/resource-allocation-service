# Sync Call Policy

This document defines how the Resource Allocation service is allowed to make synchronous calls to other services. Its purpose is to prevent Distributed Monolith behavior as the system grows.

## Goals

- Keep this service able to start and accept traffic even if every other service is offline.
- Prevent a single downstream outage from breaking core allocation flows.
- Keep caller responses useful even when a downstream dependency is slow or unavailable.

## Non-Negotiable Rules

1. No downstream sync call is allowed during startup.
   Evidence target: [main.js](/Users/hamin/Documents/CS366/ResourceAllocationService/app/main.js) should remain free of service-to-service warmup checks.
2. `/health` must report only local process health.
   It must not ping another service or database before returning.
3. Every downstream sync call must have a timeout.
   Default policy: fail fast in 1-2 seconds unless a shorter SLA is documented.
4. Retries must be bounded and only for safe failure modes.
   No unbounded retry loops and no retry storms.
5. Every call must have a fallback behavior.
   If the dependency is unavailable, return a degraded but valid business response when possible.
6. Correlation ids must be propagated.
   Forward `x-correlation-id` from incoming requests to downstream calls and emitted events.
7. Core allocation logic must not depend on optional enrichment.
   If external data is “nice to have,” the allocation must still complete without it.

## Allowed Usage Pattern

Use a downstream sync call only when all of the following are true:

- The caller needs an immediate answer in the same request.
- The data cannot be obtained from local state or a prior event.
- A documented fallback still exists if the dependency fails.

If these conditions are not met, prefer asynchronous integration.

## Required Design Template For Every New Sync Dependency

Before adding a new external call, document:

- Dependency name
- Calling endpoint(s)
- Why sync is required
- Timeout value
- Retry policy
- Fallback behavior
- Whether the dependency is mandatory or optional
- What happens to the user response when the dependency is down

## Example: Shelter Locator

If Resource Allocation later calls a Shelter Locator service:

- Good pattern:
  Resource Allocation calculates allocation from its own DB first, then optionally asks Shelter Locator for enriched destination hints with a short timeout and a fallback to “destination pending.”
- Bad pattern:
  Resource Allocation cannot complete allocation until Shelter Locator responds successfully.

## Code Review Checklist

- Is the new external call outside startup code?
- Is there an explicit timeout?
- Is there a clear fallback?
- Does the endpoint still produce a valid response without the dependency?
- Is `x-correlation-id` propagated?
- Is this really required to be sync, or should it be event-driven instead?
