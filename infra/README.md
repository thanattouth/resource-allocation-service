# Infra Bootstrap

This directory provisions the lowest-cost first phase of the AWS Learner Lab deployment:

- ECR repository for the application image
- EC2 host for the always-on application container
- DynamoDB table for idempotency records
- SQS standard queues + DLQs for async publishing
- Security group access from the EC2 host to an existing RDS instance
- Security group access from the nearby Lambda function to an existing RDS instance
- HTTP API Gateway + Lambda deployment for `GET /v1/resources/nearby`

The existing RDS database is reused instead of recreated.

The nearby endpoint is now designed to support a gradual migration path where `GET /v1/resources/nearby` runs on Lambda while the rest of the service remains on EC2.

## Prerequisites

- AWS credentials for Learner Lab are already exported in your shell
- An existing PostgreSQL/PostGIS RDS instance already exists
- You know the RDS security group ID
- You have an SSH public key available locally
- AWS Learner Lab provides the EC2 instance profile `LabInstanceProfile`
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

1. Copy the example tfvars file and fill in the RDS details.
2. Run `tofu init`
3. Run `tofu plan`
4. Run `tofu apply`
5. Build the Lambda package with `npm run build:lambda:nearby` before planning/applying the nearby Lambda resources.

## Expected Deployment Flow

1. Apply infrastructure to create ECR, EC2, DynamoDB, Lambda/API Gateway, and security rules.
2. Build and push the Docker image to the new ECR repository.
3. SSH into EC2 or use SSM and rerun the Docker pull/run commands if the image was not available during the first boot.
4. Verify SQS URLs are present in `/opt/resource-allocation/.env` on EC2.
5. Validate the nearby Lambda endpoint via `tofu output nearby_api_endpoint`.

## Notes

- This phase intentionally uses the default VPC to reduce complexity in Learner Lab.
- The EC2 host is pinned to `us-east-1a` to avoid unsupported instance-type issues in some default subnets.
- IAM resources are intentionally reused from Learner Lab instead of being created by OpenTofu.
- The nearby Lambda is designed to reuse the existing Learner Lab IAM role `LabRole`.
- The EC2 user-data writes application environment variables locally on the instance.
- SQS is configured as Standard queues (lowest-cost, at-least-once delivery) with per-channel DLQ and `maxReceiveCount = 5`.
- After `tofu apply`, use `tofu output` to inspect:
  - `sqs_powergrid_eta_updated_url`
  - `sqs_powergrid_eta_updated_dlq_url`
  - `sqs_shelter_transporting_url`
  - `sqs_shelter_transporting_dlq_url`
  - `nearby_api_endpoint`
