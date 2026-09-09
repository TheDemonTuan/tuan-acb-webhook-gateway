#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "==> Initiating rollback..."

if [ ! -f "current.manifest" ]; then
  echo "ERROR: current.manifest not found. Cannot determine previous image."
  exit 1
fi

PREVIOUS_IMAGE=$(cat current.manifest)
echo "==> Rolling back to previous image: ${PREVIOUS_IMAGE}"

export IMAGE_REF="${PREVIOUS_IMAGE}"

docker compose --env-file .env.production -f compose.prod.yaml up -d --remove-orphans

echo "==> Verifying previous container health..."
bash verify-deployment.sh

echo "==> Rollback completed successfully."
