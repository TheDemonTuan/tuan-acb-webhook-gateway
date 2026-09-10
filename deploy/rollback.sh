#!/usr/bin/env bash
set -Eeuo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
previous_gateway_file="$script_dir/.previous-image"
previous_browser_file="$script_dir/.previous-browser-image"
[[ -f "$previous_gateway_file" ]] || { printf 'No previous gateway image digest is recorded.\n' >&2; exit 1; }
[[ -f "$previous_browser_file" ]] || { printf 'No previous auth-browser image digest is recorded.\n' >&2; exit 1; }
exec "$script_dir/deploy.sh" "$(<"$previous_gateway_file")" "$(<"$previous_browser_file")"
