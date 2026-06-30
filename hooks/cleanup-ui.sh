#!/usr/bin/env bash
# Cross-platform Claude Code SessionEnd hook bridge for Hikspine UI cleanup.
#
# Locate the plugin root, then hand stdin to cleanup-ui.mjs. The Node script
# verifies the pid file belongs to a Hikspine UI process before terminating it.

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
  [ -f "$root/hooks/cleanup-ui.mjs" ] || return 1
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
    found="$(find "$base" -maxdepth 10 -path '*/hooks/cleanup-ui.mjs' -print -quit 2>/dev/null || true)"
    if [ -n "$found" ]; then
      PLUGIN_ROOT="$(cd "$(dirname "$found")/.." && pwd -P)"
      break
    fi
  done
fi

if [ -z "$PLUGIN_ROOT" ] || [ ! -f "$PLUGIN_ROOT/hooks/cleanup-ui.mjs" ]; then
  echo "[HIKSPINE-HOOK] cleanup skipped: cannot locate hikspine plugin root" >&2
  exit 0
fi

exec node "$PLUGIN_ROOT/hooks/cleanup-ui.mjs"
