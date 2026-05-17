# Learner Lab Rebuild Runbook

Use this when the AWS Learner Lab account has rolled over and the whole stack must be recreated.

## 1. Start A Fresh Lab

Export fresh credentials:

```bash
export AWS_ACCESS_KEY_ID="..."
export AWS_SECRET_ACCESS_KEY="..."
export AWS_SESSION_TOKEN="..."
export AWS_DEFAULT_REGION="us-east-1"
```

Verify:

```bash
aws sts get-caller-identity
```

## 2. Archive Old Local State

From `infra/`:

```bash
mkdir -p state-archive
mv terraform.tfstate state-archive/terraform.tfstate.old-lab 2>/dev/null || true
mv terraform.tfstate.backup state-archive/terraform.tfstate.backup.old-lab 2>/dev/null || true
```

## 3. Prepare `terraform.tfvars`

```bash
cd infra
cp terraform.tfvars.example terraform.tfvars
```

Pick one database path.

### A. Create RDS with OpenTofu

Recommended default:

```hcl
create_rds                   = true
rds_instance_class           = "db.t3.micro"
rds_allocated_storage_gb     = 20
rds_max_allocated_storage_gb = 25
rds_storage_type             = "gp2"
rds_db_name                  = "disaster_db"
rds_username                 = "postgres"
rds_password                 = "choose-a-strong-password"
rds_backup_retention_days    = 0
rds_deletion_protection      = false
```

### B. Reuse Existing RDS

```hcl
create_rds                     = false
existing_rds_host              = "..."
existing_rds_port              = 5432
existing_rds_name              = "disaster_db"
existing_rds_username          = "postgres"
existing_rds_password          = "..."
existing_rds_security_group_id = "sg-..."
```

## 4. Build The Nearby Lambda Package

From the repo root:

```bash
npm install
npm run build:lambda:nearby
```

Output:

- `dist/nearby-lambda.zip`

## 5. Apply Infra

```bash
cd infra
tofu init
tofu plan
tofu apply
tofu output
```

Core resources expected from the current infra:

- EC2 host for the Express app
- PostgreSQL RDS or wiring to an existing RDS
- DynamoDB idempotency table
- SQS queues and DLQs for all four async channels
- ECR repository
- nearby Lambda + HTTP API Gateway

## 6. Push The App Image

```bash
ECR_REPO="<ecr_repository_url_from_tofu_output>"
AWS_REGION="us-east-1" PLATFORM="linux/amd64" ./scripts/build-and-push-ecr.sh "${ECR_REPO}"
```

If EC2 booted before the image was available, SSH in and rerun the pull/run commands.

## 7. Initialize Schema And Seed Data

From EC2:

```bash
docker run --rm \
  --env-file /opt/resource-allocation/.env \
  <container_image_uri> \
  npm run init-db
```

This creates:

- PostGIS
- `pgcrypto`
- `resources` table
- seeded demo resources for ambulance, generator, boat, helicopter, and supply-truck flows

## 8. Verify The Stack

Minimum checks:

```bash
curl "http://<ec2_public_ip>:3000/health"
curl "http://<ec2_public_ip>:3000/v1/resources/nearby?lat=13.7563&long=100.5018&radius_km=20" \
  -H "Authorization: Bearer ${DISPATCHER_BEARER_TOKEN}"
curl "<nearby_api_endpoint>?lat=13.7563&long=100.5018&radius_km=20" \
  -H "Authorization: Bearer ${DISPATCHER_BEARER_TOKEN}"
```

Then run:

```bash
BASE_URL="http://<ec2_public_ip>:3000" \
DISPATCHER_BEARER_TOKEN="..." \
TELEMETRY_BEARER_TOKEN="..." \
npm run test:e2e:sync
```

## 9. Important Current Caveat

The app supports shelter and hospital transport integrations, but those flows depend on runtime environment values outside the database core:

- `SHELTER_LOCATOR_BASE_URL`
- `HOSPITAL_API_BASE_URL`

If your deployment path does not inject them automatically, add them to `/opt/resource-allocation/.env` before testing transport flows.

## 10. Share Only What Other Services Need

- EC2 base URL
- nearby API endpoint
- SQS queue URLs

Do not share:

- DB password
- AWS secrets
- Terraform state files
