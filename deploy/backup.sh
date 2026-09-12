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

# Execute WAL checkpoint to ensure all journal data is flushed prior to backup
if command -v sqlite3 >/dev/null 2>&1; then
  sqlite3 "$database" "PRAGMA wal_checkpoint(TRUNCATE);" || true
  sqlite3 "$database" ".backup '$out'"
elif command -v python3 >/dev/null 2>&1; then
  python3 -c "
import sqlite3, sys
src = sqlite3.connect('$database')
try:
    src.execute('PRAGMA wal_checkpoint(TRUNCATE);')
except Exception:
    pass
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

chmod 600 "$out" || true

# Backup master key if present
key_file="${APP_MASTER_KEY_FILE:-./secrets/app_master_key}"
if [[ -f "$key_file" ]]; then
  key_out="$(dirname "$out")/app_master_key-$(basename "$out" .db)"
  cp -p "$key_file" "$key_out"
  chmod 600 "$key_out" || true
fi

if [[ -s "$out" ]]; then
  printf 'Backup created successfully: %s (%d bytes)\n' "$out" "$(wc -c < "$out")"
else
  printf 'Backup failed: output file is empty: %s\n' "$out" >&2
  exit 1
fi
