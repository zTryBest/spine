#!/bin/bash
# hikspine runtime locator; source this file to export paths to bundled scripts.
#
# Usage:
#   If you already know the plugin root:
#     HIKSPINE_PLUGIN_ROOT="/path/to/hikspine"
#     . "$HIKSPINE_PLUGIN_ROOT/skills/hikspine/scripts/hikspine-env.sh"
#   If CLAUDE_PLUGIN_ROOT may be empty, use the locator snippet in
#   skills/hikspine/SKILL.md.
#
# Hikspine's engine is plugin-level runtime code under src/, not skill-level
# code. This file remains as a tiny compatibility locator for skills/hooks.

_hs_env_source="${BASH_SOURCE[0]:-$0}"
_hs_dir="$(cd "$(dirname "$_hs_env_source")" && pwd -P)"
_hs_plugin_root="$(cd "${_hs_dir}/../../.." && pwd -P)"
_hs_env_sourced=0
(return 0 2>/dev/null) && _hs_env_sourced=1

_hs_normalize_root() {
  local root="$1"
  root="${root//\\//}"
  while [ "${#root}" -gt 1 ]; do
    case "$root" in
      */) root="${root%/}" ;;
      *) break ;;
    esac
  done
  printf '%s\n' "$root"
}

_hs_root_input="${HIKSPINE_PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT:-$_hs_plugin_root}}"
_hs_root_norm="$(_hs_normalize_root "$_hs_root_input")"

export HIKSPINE_PLUGIN_ROOT="$_hs_root_norm"
export HIKSPINE_ENGINE="${HIKSPINE_ENGINE:-${HIKSPINE_PLUGIN_ROOT}/src/hikspine.mjs}"
export HIKSPINE_GUARD="${HIKSPINE_GUARD:-${HIKSPINE_PLUGIN_ROOT}/hooks/guard.mjs}"
export HIKSPINE_WORKFLOWS_DIR="${HIKSPINE_WORKFLOWS_DIR:-${HIKSPINE_PLUGIN_ROOT}/src/workflows}"
export HIKSPINE_RULES_DIR="${HIKSPINE_RULES_DIR:-${HIKSPINE_PLUGIN_ROOT}/rules}"

# Resolve a usable bash on Windows, Git Bash, WSL, and Unix-like shells.

_hs_bash_is_usable() {
  local cand="$1"
  [ -n "$cand" ] || return 1
  case "$cand" in
    */Windows/System32/bash.exe|*/windows/system32/bash.exe|*\\Windows\\System32\\bash.exe|*\\windows\\system32\\bash.exe)
      return 1 ;;
  esac
  "$cand" -lc 'printf hikspine-bash-ok' >/dev/null 2>&1
}

_hs_resolve_bash() {
  local cand
  if _hs_bash_is_usable "${HIKSPINE_BASH:-}"; then printf '%s\n' "$HIKSPINE_BASH"; return 0; fi
  if _hs_bash_is_usable "${BASH:-}"; then printf '%s\n' "$BASH"; return 0; fi
  cand="$(command -v sh 2>/dev/null | awk '{ sub(/\/sh(\.exe)?$/, "/bash.exe"); print }')"
  if _hs_bash_is_usable "$cand"; then printf '%s\n' "$cand"; return 0; fi
  cand="$(command -v bash 2>/dev/null || true)"
  if _hs_bash_is_usable "$cand"; then printf '%s\n' "$cand"; return 0; fi
  return 1
}

HIKSPINE_BASH="$(_hs_resolve_bash || true)"
export HIKSPINE_BASH

_hs_env_missing=0
if [ -z "$HIKSPINE_BASH" ]; then
  echo "ERROR: usable bash not found. Install Git Bash or set HIKSPINE_BASH." >&2
  _hs_env_missing=1
fi
for _hs_script in "$HIKSPINE_ENGINE"; do
  if [ ! -f "$_hs_script" ]; then
    echo "ERROR: hikspine script not found: $_hs_script" >&2
    echo "Ensure the hikspine plugin is installed completely." >&2
    _hs_env_missing=1
    break
  fi
done

if [ "$_hs_env_missing" -ne 0 ]; then
  unset _hs_env_source _hs_dir _hs_plugin_root _hs_root_input _hs_root_norm _hs_script _hs_env_missing
  unset -f _hs_bash_is_usable _hs_resolve_bash _hs_normalize_root
  if [ "$_hs_env_sourced" -eq 1 ]; then unset _hs_env_sourced; return 1; fi
  exit 1
else
  unset _hs_env_source _hs_dir _hs_plugin_root _hs_root_input _hs_root_norm _hs_script _hs_env_missing _hs_env_sourced
  unset -f _hs_bash_is_usable _hs_resolve_bash _hs_normalize_root
fi
