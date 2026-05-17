#!/bin/bash
# Setup PostgreSQL on EC2 (cost-focused local alternative to the default RDS path)

set -euo pipefail

echo "================================"
echo "Setup PostgreSQL on EC2"
echo "================================"

# Install Docker if not present
if ! command -v docker &> /dev/null; then
    echo "Installing Docker..."
    sudo yum update -y
    sudo yum install -y docker
    sudo systemctl start docker
    sudo systemctl enable docker
    sudo usermod -aG docker ec2-user
fi

# Install Docker Compose
if ! command -v docker-compose &> /dev/null; then
    echo "Installing Docker Compose..."
    sudo curl -L "https://github.com/docker/compose/releases/download/v2.23.0/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
    sudo chmod +x /usr/local/bin/docker-compose
fi

# Create app directory
APP_DIR="/opt/resource-allocation"
sudo mkdir -p $APP_DIR
cd $APP_DIR

# Export current env vars to .env file
cat > .env << EOF
DB_USER=postgres
DB_PASSWORD=postgres123
DB_NAME=disaster_db
DB_HOST=postgres
DB_PORT=5432
DB_SSL=false
AWS_REGION=us-east-1
DYNAMODB_IDEMPOTENCY_TABLE=resource-allocation-idempotency
IDEMPOTENCY_TTL_HOURS=24
DISPATCHER_BEARER_TOKEN=${DISPATCHER_BEARER_TOKEN:-dispatcher-dev-token}
ALLOCATION_API_KEY=${ALLOCATION_API_KEY:-allocation-upstream-key}
TELEMETRY_BEARER_TOKEN=${TELEMETRY_BEARER_TOKEN:-telemetry-device-token}
TELEMETRY_API_KEY=${TELEMETRY_API_KEY:-telemetry-device-key}
SQS_POWERGRID_COMPLETED_URL=${SQS_POWERGRID_COMPLETED_URL}
SQS_SHELTER_TRANSPORTING_URL=${SQS_SHELTER_TRANSPORTING_URL}
SQS_USER_LOCATION_REQUEST_COMPLETED_URL=${SQS_USER_LOCATION_REQUEST_COMPLETED_URL}
SQS_INCIDENT_REPORTER_COMPLETED_URL=${SQS_INCIDENT_REPORTER_COMPLETED_URL}
SHELTER_LOCATOR_BASE_URL=${SHELTER_LOCATOR_BASE_URL:-}
HOSPITAL_API_BASE_URL=${HOSPITAL_API_BASE_URL:-https://3w10sext9e.execute-api.us-east-1.amazonaws.com}
IMAGE_URI=${IMAGE_URI}
EOF

echo "✅ Environment file created at $APP_DIR/.env"
echo ""
echo "Next steps:"
echo "1. Copy docker-compose.yml to $APP_DIR"
echo "2. Run: docker-compose up -d postgres"
echo "3. Wait for postgres to be healthy"
echo "4. Run: docker-compose up -d app"
echo "5. Run the schema bootstrap manually inside the app container image with npm run init-db"
echo ""
echo "To save more costs, you can:"
echo "- Stop containers when not in use: docker-compose stop"
echo "- Start again: docker-compose start"
echo "- View logs: docker-compose logs -f"
