# Contract Alignment Notes

These notes lock two contract decisions that must stay consistent between the implementation, test data, and the external design document.

## Authorization

- `GET /v1/resources/nearby`
- `POST /v1/incidents/{incident_id}/allocations`
- `POST /v1/resources/{resource_id}/transport-start`

All three dispatcher-facing endpoints require:

```http
Authorization: Bearer <DISPATCHER_BEARER_TOKEN>
```

- `PATCH /v1/resources/{resource_id}/telemetry`

The telemetry endpoint requires one of:

```http
Authorization: Bearer <TELEMETRY_BEARER_TOKEN>
```

or

```http
Authorization: <TELEMETRY_API_KEY>
```

## Resource ID Format

- `resource_id` is a UUID in the database schema
- `resource_id` must be a UUID in all path parameters and response payloads
- Human-readable fleet labels such as `RES-VAN-005` can exist as external display codes in another system, but they are not the canonical API identifier in this service

## Recommended wording for the external document

- Data field: `resource_id (UUID)`
- Path parameter: `resource_id (String, UUID format, Required)`
- Example value:

```text
550e8400-e29b-41d4-a716-446655440000
```
