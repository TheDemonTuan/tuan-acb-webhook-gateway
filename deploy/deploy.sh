#!/usr/bin/env bash
set -Eeuo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
env_file="${ENV_FILE:-$script_dir/.env.production}"
compose_file="${COMPOSE_FILE:-$script_dir/compose.prod.yaml}"
image_ref="${1:-${IMAGE_REF:-}}"
browser_image_ref="${2:-${AUTH_BROWSER_IMAGE_REF:-}}"
image_pattern='^[^[:space:]]+@sha256:[a-f0-9]{64}$'

[[ -f "$env_file" ]] || { printf 'Missing production env file: %s\n' "$env_file" >&2; exit 1; }
[[ "$image_ref" =~ $image_pattern ]] || { printf 'Pass an immutable gateway image digest as first argument.\n' >&2; exit 1; }
[[ "$browser_image_ref" =~ $image_pattern ]] || { printf 'Pass an immutable auth-browser image digest as second argument.\n' >&2; exit 1; }

export IMAGE_REF="$image_ref"
export AUTH_BROWSER_IMAGE_REF="$browser_image_ref"

lock="$script_dir/.deploy.lock"
exec 9>"$lock"
flock -n 9 || { printf 'Another deployment is active.\n' >&2; exit 1; }

# Ensure data and secrets directories exist with proper permissions for container user (UID 1000)
mkdir -p "$script_dir/data" "$script_dir/secrets"
chmod 775 "$script_dir/data" || true

# Stop writers before checkpointing and backing up SQLite.
docker stop acb-transaction-gateway bank-gateway-auth-browser 2>/dev/null || true

# Ensure secrets/app_master_key file exists before Docker mounts it
if [[ ! -f "$script_dir/secrets/app_master_key" ]]; then
  if [[ -n "${APP_MASTER_KEY:-}" ]]; then
    printf '%s\n' "$APP_MASTER_KEY" > "$script_dir/secrets/app_master_key"
  elif grep -q '^APP_MASTER_KEY=' "$env_file" 2>/dev/null; then
    val="$(grep '^APP_MASTER_KEY=' "$env_file" | head -n1 | cut -d= -f2- | tr -d ' "[:space:]' | tr -d "'")"
    if [[ -n "$val" ]]; then
      printf '%s\n' "$val" > "$script_dir/secrets/app_master_key"
    else
      openssl rand -hex 32 > "$script_dir/secrets/app_master_key"
    fi
  else
    openssl rand -hex 32 > "$script_dir/secrets/app_master_key"
  fi
fi
chmod 600 "$script_dir/secrets/app_master_key"

# 1. Execute pre-deployment offline backup
if [[ -f "$script_dir/data/gateway.db" ]]; then
  printf 'Executing pre-deployment backup with WAL checkpoint...\n'
  DATABASE_PATH="$script_dir/data/gateway.db" BACKUP_DIR="$script_dir/data/backups" "$script_dir/backup.sh"
fi

docker compose --env-file "$env_file" -f "$compose_file" config --quiet
gateway_current_file="$script_dir/.deployed-image"
browser_current_file="$script_dir/.deployed-browser-image"
gateway_current="$(cat "$gateway_current_file" 2>/dev/null || true)"
browser_current="$(cat "$browser_current_file" 2>/dev/null || true)"

# 2. Pull images and execute migration-only gate
if ! docker compose --env-file "$env_file" -f "$compose_file" pull gateway auth-browser; then
  echo "Failed to pull deployment images." >&2
  exit 1
fi

printf 'Executing database migration gate (--migrate-only)...\n'
if ! docker compose --env-file "$env_file" -f "$compose_file" run --rm --no-deps gateway /gateway --migrate-only; then
  echo "Database migration gate failed. Aborting deployment." >&2
  exit 1
fi

printf 'Verifying database integrity before startup (--check)...\n'
if ! docker compose --env-file "$env_file" -f "$compose_file" run --rm --no-deps gateway /gateway --check; then
  echo "Database integrity check failed. Aborting deployment." >&2
  exit 1
fi

# 3. Start services with health wait
if ! docker compose --env-file "$env_file" -f "$compose_file" up -d --remove-orphans --wait; then
  echo "Docker compose deployment failed. Dumping container status and logs:" >&2
  docker compose --env-file "$env_file" -f "$compose_file" ps -a || true
  docker compose --env-file "$env_file" -f "$compose_file" logs --tail 50 gateway auth-browser || true
  exit 1
fi

PORT="${PORT:-8080}" "$script_dir/verify-deployment.sh"
if [[ -n "$gateway_current" && "$gateway_current" != "$image_ref" ]]; then
  printf '%s\n' "$gateway_current" > "$script_dir/.previous-image"
fi
if [[ -n "$browser_current" && "$browser_current" != "$browser_image_ref" ]]; then
  printf '%s\n' "$browser_current" > "$script_dir/.previous-browser-image"
fi
printf '%s\n' "$image_ref" > "$gateway_current_file"
printf '%s\n' "$browser_image_ref" > "$browser_current_file"
printf 'Deployment successful: gateway=%s auth-browser=%s\n' "$image_ref" "$browser_image_ref"
