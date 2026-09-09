#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

LOCK_FILE="/tmp/bank-gateway-deploy.lock"
exec 200>"$LOCK_FILE"
flock -n 200 || { echo "ERROR: Another deployment is already in progress."; exit 1; }

echo "==> Starting deployment of Bank Event Gateway..."

# 1. Check Arguments / Environment
IMAGE_REF="${1:-${IMAGE_REF:-}}"
if [ -z "$IMAGE_REF" ]; then
  echo "ERROR: IMAGE_REF must be provided as argument or environment variable."
  exit 1
fi

echo "==> Target Image: ${IMAGE_REF}"

# 2. Check Disk Space (at least 1GB free)
FREE_KB=$(df -k "$SCRIPT_DIR" | tail -1 | awk '{print $4}')
if [ "$FREE_KB" -lt 1048576 ]; then
  echo "ERROR: Insufficient disk space. Available: ${FREE_KB}KB, required: 1048576KB"
  exit 1
fi

# 3. Check configuration files
if [ ! -f ".env.production" ]; then
  echo "ERROR: .env.production file is missing in ${SCRIPT_DIR}"
  exit 1
fi

mkdir -p ./data ./credentials ./secrets

# Save previous image if current.manifest exists
PREV_IMAGE=""
if [ -f "current.manifest" ]; then
  PREV_IMAGE=$(cat current.manifest)
fi

# 4. Pull new image before touching running container
echo "==> Pulling image: ${IMAGE_REF}"
docker pull "${IMAGE_REF}"

# 5. Pre-deployment SQLite Database Backup
if [ -f "./data/gateway.db" ]; then
  echo "==> Performing pre-deploy database backup..."
  BACKUP_FILE="./data/backup-pre-deploy-$(date +%Y%m%d%H%M%S).db"
  # Use sqlite3 CLI if available or copy under WAL
  cp "./data/gateway.db" "$BACKUP_FILE"
  if [ -f "./data/gateway.db-wal" ]; then
    cp "./data/gateway.db-wal" "${BACKUP_FILE}-wal"
  fi
  echo "Backup created at ${BACKUP_FILE}"
fi

# 6. Run Database Migrations using new container
echo "==> Running database migrations with new image..."
docker run --rm \
  --user "1000:1000" \
  -v "${SCRIPT_DIR}/data:/app/data" \
  -v "${SCRIPT_DIR}/credentials:/app/credentials:ro" \
  --env-file .env.production \
  "${IMAGE_REF}" node dist/cli.js migrate

# 7. Start/Update Container
echo "==> Launching container with new image..."
export IMAGE_REF
docker compose -f compose.prod.yaml up -d --remove-orphans

# 8. Verify Deployment Health
echo "==> Running health and readiness checks..."
if bash verify-deployment.sh; then
  echo "${IMAGE_REF}" > current.manifest
  echo "==> Deployment SUCCEEDED and recorded to current.manifest."
  exit 0
else
  echo "WARNING: Healthcheck failed! Triggering automatic rollback..."
  if [ -n "$PREV_IMAGE" ]; then
    export IMAGE_REF="$PREV_IMAGE"
    docker compose -f compose.prod.yaml up -d --remove-orphans
    bash verify-deployment.sh || true
    echo "==> Rolled back to ${PREV_IMAGE}."
  else
    echo "ERROR: No previous image available to rollback."
  fi
  exit 1
fi
