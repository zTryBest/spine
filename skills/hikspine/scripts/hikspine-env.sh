#!/bin/bash
# hikspine script locator — source this file to export paths to bundled scripts.
#
# Usage:
#   . "${CLAUDE_PLUGIN_ROOT}/skills/hikspine/scripts/hikspine-env.sh"
#
# Unlike comet (which scanned the filesystem with `find`), hikspine is a Claude
# Code plugin: scripts self-locate from this file's own directory, and callers
# can use ${CLAUDE_PLUGIN_ROOT} to reach this file. Do not set global shell
# options here (this file is sourced).

_hs_env_source="${BASH_SOURCE[0]:-$0}"
_hs_dir="$(cd "$(dirname "$_hs_env_source")" && pwd -P)"
_hs_env_sourced=0
(return 0 2>/dev/null) && _hs_env_sourced=1

export HIKSPINE_STATE="${HIKSPINE_STATE:-${_hs_dir}/hikspine-state.sh}"
export HIKSPINE_GUARD="${HIKSPINE_GUARD:-${_hs_dir}/hikspine-guard.sh}"
export HIKSPINE_PRESET_JS="${HIKSPINE_PRESET_JS:-${_hs_dir}/hikspine-preset.mjs}"
export HIKSPINE_CONFIG_JS="${HIKSPINE_CONFIG_JS:-${_hs_dir}/hikspine-config.mjs}"
export HIKSPINE_PRESETS_DIR="${HIKSPINE_PRESETS_DIR:-$(cd "${_hs_dir}/.." && pwd -P)/presets}"

# --- Resolve a usable bash (Windows Git Bash quirks mirror comet's logic) ---

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
for _hs_script in "$HIKSPINE_STATE" "$HIKSPINE_PRESET_JS" "$HIKSPINE_CONFIG_JS"; do
  if [ ! -f "$_hs_script" ]; then
    echo "ERROR: hikspine script not found: $_hs_script" >&2
    echo "Ensure the hikspine plugin is installed completely." >&2
    _hs_env_missing=1
    break
  fi
done

if [ "$_hs_env_missing" -ne 0 ]; then
  unset _hs_env_source _hs_dir _hs_script _hs_env_missing
  unset -f _hs_bash_is_usable _hs_resolve_bash
  if [ "$_hs_env_sourced" -eq 1 ]; then unset _hs_env_sourced; return 1; fi
  exit 1
else
  unset _hs_env_source _hs_dir _hs_script _hs_env_missing _hs_env_sourced
  unset -f _hs_bash_is_usable _hs_resolve_bash
fi
