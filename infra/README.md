# Infra Bootstrap

This directory provisions the current AWS Learner Lab deployment with low-cost defaults:

- PostgreSQL RDS instance for the application database
- ECR repository for the application image
- EC2 host for the always-on application container
- DynamoDB table for idempotency records
- SQS standard queues + DLQs for async publishing
- Security group access from the EC2 host to RDS
- Security group access from the nearby Lambda function to RDS
- HTTP API Gateway + Lambda deployment for `GET /v1/resources/nearby`

The application flows behind this infra include:

- request-aware allocation with DynamoDB-backed idempotency
- pickup-to-incident telemetry retargeting
- shelter and hospital transport-start flows
- async SQS publishing for power-grid, shelter-transporting, request-completed, and incident-completed events

By default, OpenTofu creates a small single-AZ PostgreSQL RDS instance. You can still reuse an existing RDS instance by setting `create_rds = false` and filling the `existing_rds_*` variables.

The nearby endpoint is now designed to support a gradual migration path where `GET /v1/resources/nearby` runs on Lambda while the rest of the service remains on EC2.

## Prerequisites

- AWS credentials for Learner Lab are already exported in your shell
- You have an SSH public key available locally
- AWS Learner Lab provides the EC2 instance profile `LabInstanceProfile`
- AWS Learner Lab provides the IAM role `LabRole`
- OpenTofu is installed

## Files

- [versions.tf](/Users/hamin/Documents/CS366/ResourceAllocationService/infra/versions.tf)
- [main.tf](/Users/hamin/Documents/CS366/ResourceAllocationService/infra/main.tf)
- [variables.tf](/Users/hamin/Documents/CS366/ResourceAllocationService/infra/variables.tf)
- [outputs.tf](/Users/hamin/Documents/CS366/ResourceAllocationService/infra/outputs.tf)
- [terraform.tfvars.example](/Users/hamin/Documents/CS366/ResourceAllocationService/infra/terraform.tfvars.example)
- [lambda-nearby.tf](/Users/hamin/Documents/CS366/ResourceAllocationService/infra/lambda-nearby.tf)
- [Nearby Lambda Migration Notes](/Users/hamin/Documents/CS366/ResourceAllocationService/docs/nearby-lambda-migration.md)

## Usage

1. Copy the example tfvars file and choose a strong `rds_password`.
2. Build the Lambda package with `npm run build:lambda:nearby`.
3. Run `tofu init`.
4. Run `tofu plan`.
5. Run `tofu apply`.

## Expected Deployment Flow

1. Apply infrastructure to create RDS, ECR, EC2, DynamoDB, Lambda/API Gateway, SQS, and security rules.
2. Build and push the Docker image to the new ECR repository with `PLATFORM="linux/amd64" ./scripts/build-and-push-ecr.sh <ecr_repository_url>`.
3. SSH into EC2 or use SSM and rerun the Docker pull/run commands if the image was not available during the first boot.
4. Verify queue URLs are present in `/opt/resource-allocation/.env` on EC2.
5. Initialize the new RDS schema and seed data with `npm run init-db`.
6. Validate the nearby Lambda endpoint via `tofu output nearby_api_endpoint`.

## Notes

- This phase intentionally uses the default VPC to reduce complexity in Learner Lab.
- The EC2 host is pinned to `us-east-1a` to avoid unsupported instance-type issues in some default subnets.
- RDS defaults are cost-conscious for Learner Lab: `db.t3.micro`, 20GB storage, single-AZ, private, backup retention `0`, deletion protection off.
- IAM resources are intentionally reused from Learner Lab instead of being created by OpenTofu.
- The nearby Lambda is designed to reuse the existing Learner Lab IAM role `LabRole`.
- The EC2 user-data writes application environment variables locally on the instance.
- SQS is configured as Standard queues (lowest-cost, at-least-once delivery) with per-channel DLQ and `maxReceiveCount = 5`.
- The current app expects queue env names `SQS_USER_LOCATION_REQUEST_COMPLETED_URL` and `SQS_INCIDENT_REPORTER_COMPLETED_URL` even though Terraform outputs them as request/incident completed URLs.
- Shelter and hospital transport flows also rely on `SHELTER_LOCATOR_BASE_URL` and `HOSPITAL_API_BASE_URL` at runtime.
- After `tofu apply`, use `tofu output` to inspect:
  - `rds_endpoint`
  - `rds_security_group_id`
  - `sqs_powergrid_completed_url`
  - `sqs_powergrid_completed_dlq_url`
  - `sqs_shelter_transporting_url`
  - `sqs_shelter_transporting_dlq_url`
  - `sqs_request_completed_url`
  - `sqs_request_completed_dlq_url`
  - `sqs_incident_completed_url`
  - `sqs_incident_completed_dlq_url`
  - `nearby_api_endpoint`
