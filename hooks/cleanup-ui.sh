#!/usr/bin/env bash
# Cross-platform Claude Code SessionEnd hook bridge for Hikspine UI cleanup.
#
# Locate the plugin root, then hand stdin to cleanup-ui.mjs. The Node script
# verifies the pid file belongs to a Hikspine UI process before terminating it.

set -euo pipefail

json_escape() {
  local value="${1:-}"
  value="${value//\\/\\\\}"
  value="${value//\"/\\\"}"
  value="${value//$'\r'/ }"
  value="${value//$'\n'/ }"
  printf '%s' "$value"
}

bridge_log_file() {
  local dir="${HIKSPINE_HOOK_LOG_DIR:-}"
  if [ -z "$dir" ]; then
    if [ -d /tmp ]; then
      dir="/tmp"
    else
      dir="${TMPDIR:-${TEMP:-${TMP:-.}}}"
    fi
  fi
  if [ ! -d "$dir" ]; then
    if [ -d /tmp ]; then
      dir="/tmp"
    else
      dir="."
    fi
  fi
  printf '%s\n' "$dir/hikspine-hook-events.log"
}

bridge_log() {
  local event="${1:-bridge}"
  local detail="${2:-}"
  local file
  file="$(bridge_log_file)"
  printf '{"at":"%s","hook":"SessionEnd","event":"%s","cwd":"%s","detail":"%s"}\n' \
    "$(printf '%(%Y-%m-%dT%H:%M:%SZ)T' -1 2>/dev/null || printf '%s' "${EPOCHSECONDS:-0}")" \
    "$(json_escape "$event")" \
    "$(json_escape "$(pwd 2>/dev/null || true)")" \
    "$(json_escape "$detail")" >> "$file" 2>/dev/null || true
}

bridge_log "bridge_start" "cleanup-ui.sh entered"

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
  "$(script="${BASH_SOURCE[0]:-$0}"; dir="${script%/*}"; [ "$dir" = "$script" ] && dir="."; cd "$dir/.." 2>/dev/null && pwd -P || true)" \
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
      found_dir="${found%/*}"
      PLUGIN_ROOT="$(cd "$found_dir/.." && pwd -P)"
      break
    fi
  done
fi

if [ -z "$PLUGIN_ROOT" ] || [ ! -f "$PLUGIN_ROOT/hooks/cleanup-ui.mjs" ]; then
  bridge_log "bridge_missing" "cannot locate hikspine plugin root"
  echo "[HIKSPINE-HOOK] cleanup skipped: cannot locate hikspine plugin root" >&2
  exit 0
fi

bridge_log "bridge_located" "$PLUGIN_ROOT"
exec node "$PLUGIN_ROOT/hooks/cleanup-ui.mjs"
