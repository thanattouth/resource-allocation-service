# Nearby Lambda Migration

This document describes the recommended first-step migration for moving `GET /v1/resources/nearby` from the EC2-hosted Express app to AWS Lambda while leaving the rest of the service on EC2.

## Why `nearby` is a good Lambda candidate

- It is read-heavy and stateless at the HTTP layer.
- Its business logic is already separated into [nearbyService.js](/Users/hamin/Documents/CS366/ResourceAllocationService/app/services/nearbyService.js), so the Lambda handler can reuse the same code path as Express.
- It can scale independently from write-heavy endpoints such as allocation and telemetry.
- Failures and traffic spikes on nearby searches no longer compete as directly with the EC2 app process.

## Why not move everything at once

- Lambda introduces packaging, VPC networking, and API Gateway wiring.
- PostgreSQL access from Lambda needs additional security-group rules and can be harder to troubleshoot than the single-host EC2 path.
- Keeping the EC2 route in place during rollout gives you a safety net.

## Recommended rollout

1. Keep the existing EC2 route as-is.
2. Deploy the new nearby Lambda and API Gateway path in parallel.
3. Validate the API response contract and database behavior.
4. Switch clients to the API Gateway URL.
5. Remove the EC2 nearby route only after the Lambda path is stable.

## New infrastructure added

- Reuse IAM role `LabRole` for Lambda execution.
- Add a dedicated Lambda security group and allow it to reach the existing RDS security group.
- Create the nearby Lambda function from a zip artifact.
- Create an HTTP API Gateway route for `GET /v1/resources/nearby`.
- Add CloudWatch log groups for Lambda and API Gateway.

## Package the Lambda

Run this from the repository root:

```bash
bash scripts/build-nearby-lambda.sh
```

This creates:

- `dist/nearby-lambda.zip`

The current packaging approach copies the existing `app/` tree and `node_modules/` into the deployment zip. It is intentionally simple for Learner Lab and good for a first migration.

## Deploy with OpenTofu

From [infra](/Users/hamin/Documents/CS366/ResourceAllocationService/infra):

```bash
cp terraform.tfvars.example terraform.tfvars
tofu init
tofu plan
tofu apply
```

Make sure these values are correct in `terraform.tfvars`:

- `existing_rds_host`
- `existing_rds_port`
- `existing_rds_name`
- `existing_rds_username`
- `existing_rds_password`
- `existing_rds_security_group_id`
- `dispatcher_bearer_token`
- `lambda_role_name = "LabRole"`

## Test the new endpoint

After apply:

```bash
tofu output nearby_api_endpoint
```

Example request:

```bash
curl "$(tofu output -raw nearby_api_endpoint)?lat=13.7563&long=100.5018&radius_km=5" \
  -H "Authorization: Bearer ${DISPATCHER_BEARER_TOKEN}"
```

## Important limitations

- This Terraform assumes the reused RDS instance is reachable from the default VPC subnets selected in the existing infra.
- If your RDS instance is in a different VPC, you must change the subnet and security-group strategy.
- `LabRole` must already have enough permissions for Lambda execution, VPC attachment, and CloudWatch Logs writes.
