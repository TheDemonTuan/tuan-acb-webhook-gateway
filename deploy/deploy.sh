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

# Stop and remove any containers from previous project names to free ports
docker stop acb-transaction-gateway acb-transaction-gateway-tunnel tuan-bank-gateway tuan-bank-gateway-tunnel 2>/dev/null || true
docker rm -f acb-transaction-gateway acb-transaction-gateway-tunnel tuan-bank-gateway tuan-bank-gateway-tunnel 2>/dev/null || true

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

docker compose --env-file "$env_file" -f "$compose_file" config --quiet
gateway_current_file="$script_dir/.deployed-image"
browser_current_file="$script_dir/.deployed-browser-image"
gateway_current="$(cat "$gateway_current_file" 2>/dev/null || true)"
browser_current="$(cat "$browser_current_file" 2>/dev/null || true)"

if ! docker compose --env-file "$env_file" -f "$compose_file" pull gateway auth-browser || \
   ! docker compose --env-file "$env_file" -f "$compose_file" up -d --remove-orphans --wait; then
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
