#!/usr/bin/env bash
set -Eeuo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
previous_gateway_file="$script_dir/.previous-image"
previous_browser_file="$script_dir/.previous-browser-image"
previous_tts_file="$script_dir/.previous-tts-image"
previous_compose_file="$script_dir/.previous-compose.yaml"
image_pattern='^[^[:space:]]+@sha256:[a-f0-9]{64}$'

[[ -f "$previous_gateway_file" ]] || { printf 'No previous gateway image digest is recorded.\n' >&2; exit 1; }
[[ -f "$previous_browser_file" ]] || { printf 'No previous auth-browser image digest is recorded.\n' >&2; exit 1; }

previous_gateway="$(<"$previous_gateway_file")"
previous_browser="$(<"$previous_browser_file")"
[[ "$previous_gateway" =~ $image_pattern ]] || { printf 'Invalid previous gateway image digest in %s.\n' "$previous_gateway_file" >&2; exit 1; }
[[ "$previous_browser" =~ $image_pattern ]] || { printf 'Invalid previous auth-browser image digest in %s.\n' "$previous_browser_file" >&2; exit 1; }

previous_tts=""
if [[ -f "$previous_tts_file" ]]; then
  previous_tts="$(<"$previous_tts_file")"
fi
if [[ -z "$previous_tts" && -f "$script_dir/.deployed-tts-image" ]]; then
  previous_tts="$(<"$script_dir/.deployed-tts-image")"
fi
[[ "$previous_tts" =~ $image_pattern ]] || { printf 'No valid previous tts-gateway image digest is recorded (checked %s and .deployed-tts-image).\n' "$previous_tts_file" >&2; exit 1; }

staged_compose=""
if [[ -f "$previous_compose_file" ]]; then
  cp "$previous_compose_file" "$script_dir/compose.prod.yaml.rollback"
  staged_compose="$script_dir/compose.prod.yaml.rollback"
fi

exec "$script_dir/deploy.sh" "$previous_gateway" "$previous_browser" "$previous_tts" "$staged_compose"
