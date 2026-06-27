#!/usr/bin/env bash
# Cross-platform Claude Code hook bridge for Hikspine.
#
# Keep this script tiny: locate the plugin root, then hand stdin to guard.mjs.

set -euo pipefail

norm_root() {
  local root="${1:-}"
  root="${root//\\//}"
  while [ "${#root}" -gt 1 ] && [ "${root%/}" != "$root" ]; do
    root="${root%/}"
  done
  printf '%s\n' "$root"
}

try_root() {
  local root
  root="$(norm_root "${1:-}")"
  [ -n "$root" ] || return 1
  [ -f "$root/hooks/guard.mjs" ] || return 1
  printf '%s\n' "$root"
}

PLUGIN_ROOT=""
for candidate in \
  "${HIKSPINE_PLUGIN_ROOT:-}" \
  "${CLAUDE_PLUGIN_ROOT:-}" \
  "$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")/.." 2>/dev/null && pwd -P || true)" \
  "$(pwd)" \
  "$(git rev-parse --show-toplevel 2>/dev/null || true)"
do
  if PLUGIN_ROOT="$(try_root "$candidate")"; then
    break
  fi
done

if [ -z "$PLUGIN_ROOT" ]; then
  for base in "${HOME:-}" "${USERPROFILE:-}" "${APPDATA:-}" "${LOCALAPPDATA:-}" "/mnt/c/Users" "/mnt/d" "/mnt/e"; do
    [ -n "$base" ] || continue
    found="$(find "$base" -maxdepth 10 -path '*/hooks/guard.mjs' -print -quit 2>/dev/null || true)"
    if [ -n "$found" ]; then
      PLUGIN_ROOT="$(cd "$(dirname "$found")/.." && pwd -P)"
      break
    fi
  done
fi

if [ -z "$PLUGIN_ROOT" ] || [ ! -f "$PLUGIN_ROOT/hooks/guard.mjs" ]; then
  echo "[HIKSPINE-HOOK] allowed: cannot locate hikspine plugin root" >&2
  exit 0
fi

exec node "$PLUGIN_ROOT/hooks/guard.mjs"
