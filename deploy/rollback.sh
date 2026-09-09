#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PREVIOUS_IMAGE_FILE="$SCRIPT_DIR/.previous-image"
CURRENT_IMAGE_FILE="$SCRIPT_DIR/.deployed-image"

[[ -f "$PREVIOUS_IMAGE_FILE" ]] || {
  echo 'ERROR: no previous image is recorded.' >&2
  exit 1
}

previous="$(cat "$PREVIOUS_IMAGE_FILE")"
[[ "$previous" =~ ^ghcr\.io/[a-z0-9._/-]+@sha256:[a-f0-9]{64}$ ]] || {
  echo 'ERROR: previous image is not an immutable GHCR digest.' >&2
  exit 1
}

current="$(cat "$CURRENT_IMAGE_FILE" 2>/dev/null || true)"
"$SCRIPT_DIR/deploy.sh" "$previous"

if [[ -n "$current" && "$current" != "$previous" ]]; then
  printf '%s\n' "$current" > "$PREVIOUS_IMAGE_FILE"
fi
