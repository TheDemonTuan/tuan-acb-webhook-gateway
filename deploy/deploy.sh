#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="${APP_DIR:-$SCRIPT_DIR}"
COMPOSE="$APP_DIR/compose.prod.yaml"
APP_ENV="$APP_DIR/.env.production"
LOCK_FILE="$APP_DIR/.deploy.lock"
CURRENT_IMAGE_FILE="$APP_DIR/.deployed-image"
PREVIOUS_IMAGE_FILE="$APP_DIR/.previous-image"
READY_TIMEOUT="${READY_TIMEOUT:-120}"

log() { printf '%s  %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$*"; }
die() { log "ERROR: $*" >&2; exit 1; }

# shellcheck source=deploy/image-retention.sh
source "$APP_DIR/image-retention.sh"

dc() {
  docker compose --env-file "$APP_ENV" -f "$COMPOSE" "$@"
}

validate_digest() {
  local image="$1"
  [[ "$image" =~ ^ghcr\.io/[a-z0-9._/-]+@sha256:[a-f0-9]{64}$ ]] || \
    die "image must be an immutable GHCR digest: $image"
}

health_status() {
  local container_id
  container_id="$(dc ps -q gateway 2>/dev/null || true)"
  [[ -n "$container_id" ]] || { printf 'missing\n'; return; }
  docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' \
    "$container_id" 2>/dev/null || true
}

verify_ready() {
  local started_at elapsed
  started_at="$(date +%s)"

  while true; do
    if [[ "$(health_status)" == 'healthy' ]] && curl --fail --silent --show-error \
      'http://127.0.0.1:8090/ready' >/dev/null; then
      return 0
    fi

    elapsed="$(( $(date +%s) - started_at ))"
    (( elapsed < READY_TIMEOUT )) || return 1
    sleep 2
  done
}

rollback() {
  local previous="$1"
  log "Rolling back to $previous"
  IMAGE_REF="$previous" dc up -d --remove-orphans --wait --wait-timeout "$READY_TIMEOUT"
  verify_ready || die 'rollback readiness verification failed'
  printf '%s\n' "$previous" > "$CURRENT_IMAGE_FILE"
}

status() {
  printf '=== Bank Event Gateway deployment status ===\n'
  printf 'Current image: %s\n' "$(cat "$CURRENT_IMAGE_FILE" 2>/dev/null || echo none)"
  printf 'Previous image: %s\n' "$(cat "$PREVIOUS_IMAGE_FILE" 2>/dev/null || echo none)"
  printf 'Gateway: %s\n' "$(health_status)"
  dc ps
}

if [[ "${1:-}" == '--status' ]]; then
  status
  exit 0
fi

[[ $# -eq 1 ]] || die "usage: $0 <image@sha256:digest> | --status"
NEW_IMAGE="$1"
validate_digest "$NEW_IMAGE"

command -v docker >/dev/null || die 'docker is required'
docker compose version >/dev/null || die 'Docker Compose v2 is required'
[[ -f "$COMPOSE" ]] || die "missing compose file: $COMPOSE"
[[ -f "$APP_ENV" ]] || die "missing production environment: $APP_ENV"

exec 200>"$LOCK_FILE"
flock -n 200 || die 'another deployment is already in progress'

CURRENT_IMAGE="$(cat "$CURRENT_IMAGE_FILE" 2>/dev/null || cat "$APP_DIR/current.manifest" 2>/dev/null || true)"
if [[ "$NEW_IMAGE" == "$CURRENT_IMAGE" ]]; then
  log "Image is already deployed: $NEW_IMAGE"
  verify_ready || die 'current deployment is not ready'
  exit 0
fi

log "Pulling $NEW_IMAGE"
docker pull "$NEW_IMAGE"

if [[ -f "$APP_DIR/data/gateway.db" ]]; then
  backup="$APP_DIR/data/backup-pre-deploy-$(date -u '+%Y%m%d%H%M%S').db"
  log "Creating SQLite backup at $backup"
  cp "$APP_DIR/data/gateway.db" "$backup"
  [[ ! -f "$APP_DIR/data/gateway.db-wal" ]] || cp "$APP_DIR/data/gateway.db-wal" "$backup-wal"
fi

log 'Applying schema migrations'
docker run --rm --user '1000:1000' \
  -v "$APP_DIR/data:/app/data" \
  -v "$APP_DIR/credentials:/app/credentials:rw" \
  -v "$APP_DIR/secrets:/app/secrets:ro" \
  --env-file "$APP_ENV" \
  "$NEW_IMAGE" node dist/cli.js migrate

log 'Starting updated services'
if ! IMAGE_REF="$NEW_IMAGE" dc up -d --remove-orphans --wait --wait-timeout "$READY_TIMEOUT"; then
  [[ -z "$CURRENT_IMAGE" ]] || rollback "$CURRENT_IMAGE"
  die 'Docker Compose failed to start the updated deployment'
fi

if ! verify_ready; then
  [[ -z "$CURRENT_IMAGE" ]] || rollback "$CURRENT_IMAGE"
  die 'updated deployment did not become ready'
fi

if [[ -n "$CURRENT_IMAGE" ]]; then
  printf '%s\n' "$CURRENT_IMAGE" > "$PREVIOUS_IMAGE_FILE"
fi
printf '%s\n' "$NEW_IMAGE" > "$CURRENT_IMAGE_FILE"
printf '%s\n' "$NEW_IMAGE" > "$APP_DIR/current.manifest"
cleanup_unused_images
log "Deployment completed: $NEW_IMAGE"
