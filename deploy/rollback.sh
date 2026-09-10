#!/usr/bin/env bash
set -Eeuo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
previous_file="$script_dir/.previous-image"
[[ -f "$previous_file" ]] || { printf 'No previous v2 image digest is recorded.\n' >&2; exit 1; }
exec "$script_dir/deploy.sh" "$(<"$previous_file")"
