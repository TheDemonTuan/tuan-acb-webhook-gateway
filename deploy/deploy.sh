#!/usr/bin/env bash
set -Eeuo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
env_file="${ENV_FILE:-$script_dir/.env.production}"
compose_file="${COMPOSE_FILE:-$script_dir/compose.prod.yaml}"
image_ref="${1:-${IMAGE_REF:-}}"

[[ -f "$env_file" ]] || { printf 'Missing production env file: %s\n' "$env_file" >&2; exit 1; }
[[ "$image_ref" =~ ^[^[:space:]]+@sha256:[a-f0-9]{64}$ || "$image_ref" =~ ^[^[:space:]]+:[a-zA-Z0-9_.-]+$ ]] || { printf 'Pass an image reference or immutable digest as first argument.\n' >&2; exit 1; }

lock="$script_dir/.deploy.lock"
exec 9>"$lock"
flock -n 9 || { printf 'Another deployment is active.\n' >&2; exit 1; }

# Ensure data and secrets directories exist
mkdir -p "$script_dir/data" "$script_dir/secrets"

# Ensure secrets/app_master_key file exists before Docker mounts it
if [[ ! -f "$script_dir/secrets/app_master_key" ]]; then
  if [[ -n "${APP_MASTER_KEY:-}" ]]; then
    printf '%s\n' "$APP_MASTER_KEY" > "$script_dir/secrets/app_master_key"
  elif grep -q '^APP_MASTER_KEY=' "$env_file" 2>/dev/null; then
    val="$(grep '^APP_MASTER_KEY=' "$env_file" | head -n1 | cut -d= -f2- | tr -d '"'"'[:space:]')"
    if [[ -n "$val" ]]; then
      printf '%s\n' "$val" > "$script_dir/secrets/app_master_key"
    else
      openssl rand -hex 32 > "$script_dir/secrets/app_master_key"
    fi
  else
    openssl rand -hex 32 > "$script_dir/secrets/app_master_key"
  fi
  chmod 600 "$script_dir/secrets/app_master_key"
fi

IMAGE_REF="$image_ref" docker compose --env-file "$env_file" -f "$compose_file" config --quiet
current_file="$script_dir/.deployed-image"
current="$(cat "$current_file" 2>/dev/null || true)"
IMAGE_REF="$image_ref" docker compose --env-file "$env_file" -f "$compose_file" up -d --remove-orphans
PORT="${PORT:-8080}" "$script_dir/verify-deployment.sh"
if [[ -n "$current" && "$current" != "$image_ref" ]]; then
  printf '%s\n' "$current" > "$script_dir/.previous-image"
fi
printf '%s\n' "$image_ref" > "$current_file"
printf 'Deployment successful: %s\n' "$image_ref"
