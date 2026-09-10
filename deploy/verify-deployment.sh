#!/usr/bin/env bash
set -Eeuo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
host="${HOST:-127.0.0.1}"
port="${PORT:-8080}"
timeout="${READY_TIMEOUT:-120}"
start="$(date +%s)"

while true; do
  if curl --fail --silent --show-error "http://${host}:${port}/readyz" >/dev/null 2>&1; then
    printf 'Gateway is ready at http://%s:%s/readyz\n' "$host" "$port"
    exit 0
  fi
  if (( $(date +%s) - start >= timeout )); then
    printf 'Gateway did not become ready within %ss\n' "$timeout" >&2
    if command -v docker >/dev/null 2>&1 && [[ -f "$script_dir/compose.prod.yaml" ]]; then
      echo "=== Docker Compose Container Status ===" >&2
      docker compose -f "$script_dir/compose.prod.yaml" ps -a >&2 || true
      echo "=== Gateway Logs ===" >&2
      docker compose -f "$script_dir/compose.prod.yaml" logs --tail 50 gateway >&2 || true
    fi
    exit 1
  fi
  sleep 2
done
