#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIST_DIR="${ROOT_DIR}/dist"
STAGE_DIR="${DIST_DIR}/nearby-lambda"
ZIP_PATH="${DIST_DIR}/nearby-lambda.zip"

if [[ ! -d "${ROOT_DIR}/node_modules" ]]; then
  echo "node_modules not found. Run 'npm install' first." >&2
  exit 1
fi

rm -rf "${STAGE_DIR}" "${ZIP_PATH}"
mkdir -p "${STAGE_DIR}"

cp -R "${ROOT_DIR}/app" "${STAGE_DIR}/app"
cp "${ROOT_DIR}/package.json" "${STAGE_DIR}/package.json"
cp "${ROOT_DIR}/package-lock.json" "${STAGE_DIR}/package-lock.json"
cp -R "${ROOT_DIR}/node_modules" "${STAGE_DIR}/node_modules"

(
  cd "${STAGE_DIR}"
  zip -qr "${ZIP_PATH}" .
)

echo "Created ${ZIP_PATH}"
