#!/usr/bin/env bash
set -Eeuo pipefail

# Run on the VPS. This is intentionally maintenance-mode only until the Go
# online backup command is implemented and restore-tested.
database="${DATABASE_PATH:-./data/gateway.db}"
out="${1:?usage: backup.sh /secure/offsite-target/gateway-YYYYMMDD.db}"
[[ -f "$database" ]] || { printf 'Database not found: %s\n' "$database" >&2; exit 1; }

printf 'Stop gateway writers before copying SQLite data.\n' >&2
printf 'This script refuses to copy a live WAL database.\n' >&2
exit 1
