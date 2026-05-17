# Nearby Lambda Deployment Notes

The current architecture already supports a split path:

- EC2 Express app still serves the full service
- Lambda + API Gateway serves `GET /v1/resources/nearby`

## What Runs In Lambda

- handler: [app/lambda/nearbyHandler.js](/Users/hamin/Documents/CS366/ResourceAllocationService/app/lambda/nearbyHandler.js)
- shared search logic: [app/services/nearbyService.js](/Users/hamin/Documents/CS366/ResourceAllocationService/app/services/nearbyService.js)

## Why This Split Exists

- nearby search is stateless at the HTTP layer
- it benefits from independent scaling
- write-heavy flows still stay on the EC2 app

## Build Package

```bash
npm run build:lambda:nearby
```

This packages:

- `app/`
- `package.json`
- `package-lock.json`
- `node_modules/`

into `dist/nearby-lambda.zip`

## Infra Expectations

The Terraform side provisions:

- Lambda function
- dedicated Lambda security group
- RDS access rule for the Lambda security group
- HTTP API Gateway route `GET /v1/resources/nearby`
- CloudWatch log groups for Lambda and API Gateway

Relevant outputs:

- `nearby_lambda_function_name`
- `nearby_lambda_security_group_id`
- `nearby_api_base_url`
- `nearby_api_endpoint`

## Runtime Contract

The Lambda route keeps the same dispatcher-bearer-token requirement and the same query contract as the EC2 route.

Example:

```bash
curl "$(tofu output -raw nearby_api_endpoint)?lat=13.7563&long=100.5018&radius_km=20" \
  -H "Authorization: Bearer ${DISPATCHER_BEARER_TOKEN}"
```

## Operational Note

Keep the EC2 route available as a fallback while validating the API Gateway path against real data and credentials.
