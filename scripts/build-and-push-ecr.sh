#!/usr/bin/env bash

set -euo pipefail

AWS_REGION="${AWS_REGION:-us-east-1}"
IMAGE_TAG="${IMAGE_TAG:-latest}"
PLATFORM="${PLATFORM:-linux/amd64}"

if [[ $# -ne 1 ]]; then
  echo "Usage: $0 <ecr_repository_url>" >&2
  echo "Example: $0 123456789012.dkr.ecr.us-east-1.amazonaws.com/resource-allocation-learnerlab-app" >&2
  exit 1
fi

ECR_REPOSITORY_URL="$1"
ECR_REGISTRY="${ECR_REPOSITORY_URL%%/*}"
IMAGE_URI="${ECR_REPOSITORY_URL}:${IMAGE_TAG}"

echo "[ecr] Logging in to ${ECR_REGISTRY}"
aws ecr get-login-password --region "${AWS_REGION}" \
  | docker login --username AWS --password-stdin "${ECR_REGISTRY}"

echo "[docker] Building ${IMAGE_URI} for ${PLATFORM}"
docker buildx build \
  --platform "${PLATFORM}" \
  --tag "${IMAGE_URI}" \
  --push \
  .

echo "[done] Pushed ${IMAGE_URI}"
