#!/usr/bin/env bash
set -Eeuo pipefail

host="${HOST:-127.0.0.1}"
port="${PORT:-8080}"
timeout="${READY_TIMEOUT:-120}"
start="$(date +%s)"

while true; do
  if curl --fail --silent --show-error "http://${host}:${port}/readyz" >/dev/null; then
    printf 'Gateway is ready at http://%s:%s/readyz\n' "$host" "$port"
    exit 0
  fi
  if (( $(date +%s) - start >= timeout )); then
    printf 'Gateway did not become ready within %ss\n' "$timeout" >&2
    exit 1
  fi
  sleep 2
done
