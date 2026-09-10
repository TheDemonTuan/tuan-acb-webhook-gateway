#!/usr/bin/env bash
set -Eeuo pipefail

database="${DATABASE_PATH:-./data/gateway.db}"
out="${1:-}"

if [[ -z "$out" ]]; then
  backup_dir="${BACKUP_DIR:-./data/backups}"
  mkdir -p "$backup_dir"
  out="$backup_dir/gateway-$(date -u +%Y%m%d%H%M%S).db"
fi

[[ -f "$database" ]] || { printf 'Database not found: %s\n' "$database" >&2; exit 1; }

mkdir -p "$(dirname "$out")"

if command -v sqlite3 >/dev/null 2>&1; then
  sqlite3 "$database" ".backup '$out'"
elif command -v python3 >/dev/null 2>&1; then
  python3 -c "
import sqlite3, sys
src = sqlite3.connect('$database')
dst = sqlite3.connect('$out')
with dst:
    src.backup(dst)
dst.close()
src.close()
"
else
  printf 'Neither sqlite3 nor python3 found for safe online WAL backup.\n' >&2
  exit 1
fi

if [[ -s "$out" ]]; then
  printf 'Backup created successfully: %s (%d bytes)\n' "$out" "$(wc -c < "$out")"
else
  printf 'Backup failed: output file is empty: %s\n' "$out" >&2
  exit 1
fi
