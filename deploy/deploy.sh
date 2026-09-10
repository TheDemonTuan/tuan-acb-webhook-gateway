#!/usr/bin/env bash
set -Eeuo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
env_file="${ENV_FILE:-$script_dir/.env.production}"
compose_file="${COMPOSE_FILE:-$script_dir/compose.prod.yaml}"
image_ref="${1:-${IMAGE_REF:-}}"

[[ -f "$env_file" ]] || { printf 'Missing production env file: %s\n' "$env_file" >&2; exit 1; }
[[ "$image_ref" =~ ^[^[:space:]]+@sha256:[a-f0-9]{64}$ ]] || { printf 'Pass an immutable image digest as IMAGE_REF or first argument.\n' >&2; exit 1; }

lock="$script_dir/.deploy.lock"
exec 9>"$lock"
flock -n 9 || { printf 'Another deployment is active.\n' >&2; exit 1; }

IMAGE_REF="$image_ref" docker compose --env-file "$env_file" -f "$compose_file" config --quiet
current_file="$script_dir/.deployed-image"
current="$(cat "$current_file" 2>/dev/null || true)"
IMAGE_REF="$image_ref" docker compose --env-file "$env_file" -f "$compose_file" up -d --remove-orphans
PORT="${PORT:-8080}" "$script_dir/verify-deployment.sh"
if [[ -n "$current" && "$current" != "$image_ref" ]]; then
  printf '%s\n' "$current" > "$script_dir/.previous-image"
fi
printf '%s\n' "$image_ref" > "$current_file"
