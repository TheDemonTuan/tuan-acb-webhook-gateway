#!/usr/bin/env bash
set -euo pipefail

# Health & Readiness Verification Script
TARGET_HOST="127.0.0.1"
TARGET_PORT="${PORT:-8090}"
MAX_WAIT_SECONDS=30
CHECK_INTERVAL=2

echo "==> Verifying deployment readiness on http://${TARGET_HOST}:${TARGET_PORT}/ready..."

START_TIME=$(date +%s)
READY=0

while true; do
  CURRENT_TIME=$(date +%s)
  ELAPSED=$((CURRENT_TIME - START_TIME))

  if [ "$ELAPSED" -ge "$MAX_WAIT_SECONDS" ]; then
    echo "ERROR: Gateway readiness verification timed out after ${MAX_WAIT_SECONDS} seconds."
    exit 1
  fi

  # Query /ready endpoint
  HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "http://${TARGET_HOST}:${TARGET_PORT}/ready" || true)

  if [ "$HTTP_STATUS" -eq 200 ]; then
    echo "SUCCESS: Gateway reported HTTP 200 Ready."
    READY=1
    break
  else
    echo "Waiting for gateway readiness (HTTP status: ${HTTP_STATUS}, elapsed: ${ELAPSED}s)..."
    sleep "$CHECK_INTERVAL"
  fi
done

if [ "$READY" -eq 1 ]; then
  echo "==> Deployment verification PASSED."
  exit 0
else
  echo "==> Deployment verification FAILED."
  exit 1
fi
