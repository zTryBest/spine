#!/bin/bash
# hikspine-hook-guard.sh — PreToolUse hook for hikspine phase enforcement
#
# Blocks file writes (Write/Edit) when the active hikspine change is in a phase
# that does not allow source code modifications (open/design/archive).
#
# Invoked by the harness, not directly:
#   PreToolUse matcher "Write|Edit" → this script
#   Stdin:  JSON {"tool_name":"Write|Edit","tool_input":{"file_path":"..."}}
#   Exit 0  = allow
#   Exit 2  = blocked (stderr message shown to user)
#
# Cross-platform: macOS / Linux / Windows Git Bash
# shellcheck disable=SC2329

set -euo pipefail

# ── Extract target file path ──────────────────────────────────────

TARGET=""
if [ -n "${FILE_PATH:-}" ]; then
  TARGET="$FILE_PATH"
fi
if [ -z "$TARGET" ]; then
  INPUT=""
  if [ ! -t 0 ]; then
    INPUT=$(cat 2>/dev/null || true)
  fi
  if [ -n "$INPUT" ]; then
    TARGET=$(printf '%s' "$INPUT" \
      | grep -oE '"file_path"[[:space:]]*:[[:space:]]*"[^"]*"' 2>/dev/null \
      | head -1 \
      | sed 's/^"file_path"[[:space:]]*:[[:space:]]*"//' \
      | sed 's/"$//' \
      || true)
  fi
fi

if [ -z "$TARGET" ]; then
  echo "[HIKSPINE-HOOK] allowed: no file path in tool input" >&2
  exit 0
fi

# Normalize to forward slashes, collapse doubles from JSON escaping (\\ → //)
TARGET=$(printf '%s' "$TARGET" | sed 's|\\|/|g' | sed 's|///*|/|g')

# ── Resolve to project-relative path ─────────────────────────────

norm() { printf '%s' "$1" | sed 's|\\|/|g'; }
RELPATH=$(norm "$TARGET")

case "$RELPATH" in
  /*|[A-Za-z]:/*)
    CWD_UNIX=$(norm "$(pwd)")
    CWD_PHYS=$(norm "$(pwd -P 2>/dev/null || pwd)")
    if [ "${RELPATH#"$CWD_UNIX"/}" != "$RELPATH" ]; then
      RELPATH="${RELPATH#"$CWD_UNIX"/}"
    elif [ "${RELPATH#"$CWD_PHYS"/}" != "$RELPATH" ]; then
      RELPATH="${RELPATH#"$CWD_PHYS"/}"
    else
      _PDIR=$(cd "$(dirname "$TARGET")" 2>/dev/null && pwd -P 2>/dev/null || true)
      if [ -n "$_PDIR" ]; then
        _TRESOLVED=$(norm "${_PDIR}/$(basename "$TARGET")")
        if [ "${_TRESOLVED#"$CWD_UNIX"/}" != "$_TRESOLVED" ]; then
          RELPATH="${_TRESOLVED#"$CWD_UNIX"/}"
        elif [ "${_TRESOLVED#"$CWD_PHYS"/}" != "$_TRESOLVED" ]; then
          RELPATH="${_TRESOLVED#"$CWD_PHYS"/}"
        fi
      fi
    fi
    ;;
esac

# ── Helpers to read .hikspine.yaml fields ────────────────────────

is_archived() { grep "^archived:" "$1" 2>/dev/null | awk '{print $2}' | tr -d '[:space:][:cntrl:]' || true; }
read_phase()  { grep "^phase:" "$1" 2>/dev/null | awk '{print $2}' | tr -d '[:space:][:cntrl:]' || true; }
read_field()  { grep "^$1:" "$2" 2>/dev/null | head -1 | awk '{print $2}' | tr -d '[:space:][:cntrl:]' || true; }

# ── Determine the governing hikspine change + phase ──────────────

PHASE=""
GOV_YAML=""

case "$RELPATH" in
  openspec/changes/*/*)
    _rest="${RELPATH#openspec/changes/}"
    _own_change="${_rest%%/*}"
    if [ -n "$_own_change" ] && [ "$_own_change" != "archive" ]; then
      _own_yaml="openspec/changes/${_own_change}/.hikspine.yaml"
      if [ -f "$_own_yaml" ]; then
        if [ "$(is_archived "$_own_yaml")" = "true" ]; then
          echo "[HIKSPINE-HOOK] allowed: $RELPATH (own change archived)" >&2
          exit 0
        fi
        PHASE=$(read_phase "$_own_yaml")
        GOV_YAML="$_own_yaml"
      else
        # Change dir exists but state file not yet written (artifacts are
        # created before .hikspine.yaml during open). Treat as `open`.
        PHASE="open"
      fi
    fi
    ;;
esac

if [ -z "$PHASE" ]; then
  YAML_FILE=""
  if [ -d "openspec/changes" ]; then
    for dir in openspec/changes/*/; do
      [ -d "$dir" ] || continue
      case "$dir" in */archive/*) continue ;; esac
      if [ -f "${dir}.hikspine.yaml" ]; then
        if [ "$(is_archived "${dir}.hikspine.yaml")" = "true" ]; then continue; fi
        YAML_FILE="${dir}.hikspine.yaml"
        break
      fi
    done
  fi
  if [ -z "$YAML_FILE" ]; then
    echo "[HIKSPINE-HOOK] allowed: no active hikspine change" >&2
    exit 0
  fi
  PHASE=$(read_phase "$YAML_FILE")
  GOV_YAML="$YAML_FILE"
fi

if [ -z "$PHASE" ]; then
  echo "[HIKSPINE-HOOK] allowed: no phase in .hikspine.yaml" >&2
  exit 0
fi

# ── Whitelist: phase-aware allowed paths ─────────────────────────

case "$RELPATH" in
  openspec/*)
    case "$PHASE" in
      open)
        case "$RELPATH" in
          */proposal.md|*/design.md|*/tasks.md|*/.openspec.yaml|*/.hikspine.yaml|*/.hikspine/*|*/specs/*)
            echo "[HIKSPINE-HOOK] allowed: $RELPATH (phase: open, openspec artifacts)" >&2; exit 0 ;;
        esac ;;
      design)
        case "$RELPATH" in
          */proposal.md|*/design.md|*/tasks.md|*/.hikspine/*|*/specs/*|*/.hikspine.yaml|*/.openspec.yaml)
            echo "[HIKSPINE-HOOK] allowed: $RELPATH (phase: design, handoff/spec)" >&2; exit 0 ;;
        esac ;;
      build)
        case "$RELPATH" in
          */specs/*|*/tasks.md|*/.hikspine.yaml|*/.openspec.yaml)
            echo "[HIKSPINE-HOOK] allowed: $RELPATH (phase: build, spec/tasks)" >&2; exit 0 ;;
        esac ;;
      verify)
        case "$RELPATH" in
          */tasks.md|*/.hikspine.yaml|*/.openspec.yaml)
            echo "[HIKSPINE-HOOK] allowed: $RELPATH (phase: verify, tasks/state)" >&2; exit 0 ;;
        esac ;;
      archive)
        case "$RELPATH" in
          */.hikspine.yaml|*/.openspec.yaml)
            echo "[HIKSPINE-HOOK] allowed: $RELPATH (phase: archive, state)" >&2; exit 0 ;;
        esac ;;
    esac ;;
  docs/superpowers/*)
    case "$PHASE" in
      design) echo "[HIKSPINE-HOOK] allowed: $RELPATH (phase: design, superpowers)" >&2; exit 0 ;;
      build)  echo "[HIKSPINE-HOOK] allowed: $RELPATH (phase: build, superpowers)" >&2; exit 0 ;;
      verify) echo "[HIKSPINE-HOOK] allowed: $RELPATH (phase: verify, superpowers)" >&2; exit 0 ;;
    esac ;;
  .hikspine/*|*/.hikspine/*)
    echo "[HIKSPINE-HOOK] allowed: $RELPATH (whitelist: hikspine config)" >&2; exit 0 ;;
  .claude/*)
    echo "[HIKSPINE-HOOK] allowed: $RELPATH (whitelist: claude config)" >&2; exit 0 ;;
  CLAUDE.md|CHANGELOG.md|README.md|*.md)
    case "$RELPATH" in
      */*) ;; # subdirectory .md — fall through
      *) echo "[HIKSPINE-HOOK] allowed: $RELPATH (whitelist: root markdown)" >&2; exit 0 ;;
    esac ;;
  .hikspine.yaml|hikspine.yaml|.hikspine.yml|hikspine.yml)
    echo "[HIKSPINE-HOOK] allowed: $RELPATH (whitelist: hikspine config)" >&2; exit 0 ;;
esac

# ── Phase-based enforcement ──────────────────────────────────────

case "$PHASE" in
  build|verify)
    # feature preset must have a Design Doc before any source write in build/verify.
    # Catches illegal open→build / design→build jumps that skipped design.
    if [ -n "$GOV_YAML" ]; then
      _wf=$(read_field "workflow" "$GOV_YAML")
      _dd=$(read_field "design_doc" "$GOV_YAML")
      if [ "$_wf" = "feature" ] && { [ -z "$_dd" ] || [ "$_dd" = "null" ]; }; then
        echo "" >&2
        echo "╔══════════════════════════════════════════╗" >&2
        echo "║   HIKSPINE PHASE GUARD — WRITE BLOCKED   ║" >&2
        echo "╚══════════════════════════════════════════╝" >&2
        echo "" >&2
        echo "  当前阶段: $PHASE (workflow: feature)，但 design_doc 为空" >&2
        echo "  目标文件: $RELPATH" >&2
        echo "" >&2
        echo "  ❌ 检测到非法阶段跳转：feature 流程在没有 Design Doc 的情况下进入了 $PHASE" >&2
        echo "  ✅ 正确流程：在 design 阶段创建 Design Doc，再 transition complete 进入 build" >&2
        echo "  💡 运行 /hikspine 继续（会路由到 design 补齐设计）；修复用 hikspine-state.sh set 写入 design_doc" >&2
        echo "" >&2
        exit 2
      fi
    fi
    echo "[HIKSPINE-HOOK] allowed: $RELPATH (phase: $PHASE)" >&2
    exit 0
    ;;
  open|design|archive)
    echo "" >&2
    echo "╔══════════════════════════════════════════╗" >&2
    echo "║   HIKSPINE PHASE GUARD — WRITE BLOCKED   ║" >&2
    echo "╚══════════════════════════════════════════╝" >&2
    echo "" >&2
    echo "  当前阶段: $PHASE" >&2
    echo "  目标文件: $RELPATH" >&2
    echo "" >&2
    case "$PHASE" in
      open)
        echo "  ❌ open 阶段不允许写源码" >&2
        echo "  ✅ 允许：创建 proposal/design/tasks 并推进阶段" >&2 ;;
      design)
        echo "  ❌ design 阶段不允许写源码" >&2
        echo "  ✅ 允许：brainstorming、创建 Design Doc 并推进阶段" >&2 ;;
      archive)
        echo "  ❌ archive 阶段不允许写源码" >&2
        echo "  ✅ 允许：确认归档意图并执行归档" >&2 ;;
    esac
    echo "" >&2
    exit 2
    ;;
esac

echo "[HIKSPINE-HOOK] allowed: $RELPATH (phase: $PHASE)" >&2
exit 0
