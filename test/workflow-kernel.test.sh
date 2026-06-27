#!/usr/bin/env bash
# Reproducible tests for the plugin-level Hikspine workflow kernel.
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd -P)"
ENGINE="$REPO/bin/hikspine.mjs"
HOOK="$REPO/hooks/guard.mjs"
HOOKS_JSON="$REPO/hooks/hooks.json"

NODE_BIN="${NODE:-}"
if [ -z "$NODE_BIN" ]; then
  NODE_BIN="$(command -v node 2>/dev/null || command -v node.exe 2>/dev/null || true)"
fi
[ -n "$NODE_BIN" ] || { echo "ERROR: node not found on PATH. Set NODE=/path/to/node." >&2; exit 1; }

ENGINE_RUN="$ENGINE"
HOOK_RUN="$HOOK"
HOOKS_JSON_RUN="$HOOKS_JSON"
SANDBOX_ROOT=""
case "$NODE_BIN" in
  *.exe|*.EXE)
    if command -v wslpath >/dev/null 2>&1; then
      ENGINE_RUN="$(wslpath -w "$ENGINE")"
      HOOK_RUN="$(wslpath -w "$HOOK")"
      HOOKS_JSON_RUN="$(wslpath -w "$HOOKS_JSON")"
      SANDBOX_ROOT="$REPO/.tmp"
      mkdir -p "$SANDBOX_ROOT"
    fi
    ;;
esac

pass=0
fail=0
ok() { pass=$((pass+1)); printf '  ok   - %s\n' "$1"; }
bad() { fail=$((fail+1)); printf '  FAIL - %s\n' "$1"; }
eq() {
  if [ "$2" = "$3" ]; then ok "$1"; else bad "$1 (want '$3', got '$2')"; fi
}

sandbox() {
  local d
  if [ -n "$SANDBOX_ROOT" ]; then
    d="$(mktemp -d "$SANDBOX_ROOT/kernel.XXXXXX")"
  else
    d="$(mktemp -d)"
  fi
  echo "$d"
}

json_get() {
  "$NODE_BIN" -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s); console.log($1)})"
}

run() {
  ( cd "$T" && "$NODE_BIN" "$ENGINE_RUN" "$@" )
}

echo "# runtime locator"
LOCATOR_OUTPUT="$(CLAUDE_PLUGIN_ROOT="$REPO/" bash -lc ". \"$REPO//skills/hikspine/scripts/hikspine-env.sh\" && printf '%s' \"\$HIKSPINE_ENGINE\"")"
case "$LOCATOR_OUTPUT" in
  *"//bin/"*) bad "env locator normalizes trailing slash" ;;
  */bin/hikspine.mjs) ok "env locator normalizes trailing slash" ;;
  *) bad "env locator exports engine path (got '$LOCATOR_OUTPUT')" ;;
esac
LOCATOR_EMPTY_OUTPUT="$(cd "$REPO" && env -u CLAUDE_PLUGIN_ROOT -u HIKSPINE_PLUGIN_ROOT bash -lc '
_hs_norm_root() { local r="${1:-}"; r="${r//\\\\//}"; while [ "${#r}" -gt 1 ] && [ "${r%/}" != "$r" ]; do r="${r%/}"; done; printf "%s\n" "$r"; }
_hs_env_file=""
for r in "${HIKSPINE_PLUGIN_ROOT:-}" "${CLAUDE_PLUGIN_ROOT:-}" "$(pwd)" "$(git rev-parse --show-toplevel 2>/dev/null || true)"; do
  r="$(_hs_norm_root "$r")"
  if [ -n "$r" ] && [ -f "$r/skills/hikspine/scripts/hikspine-env.sh" ]; then
    _hs_env_file="$r/skills/hikspine/scripts/hikspine-env.sh"
    break
  fi
done
[ -n "$_hs_env_file" ] || { echo "ERROR: cannot locate hikspine-env.sh" >&2; exit 1; }
. "$_hs_env_file" || exit 1
printf "%s" "$HIKSPINE_ENGINE"
' 2>&1)"
case "$LOCATOR_EMPTY_OUTPUT" in
  *ERROR*) bad "runtime locator works without CLAUDE_PLUGIN_ROOT (printed '$LOCATOR_EMPTY_OUTPUT')" ;;
  */bin/hikspine.mjs) ok "runtime locator works without CLAUDE_PLUGIN_ROOT" ;;
  *) bad "runtime locator works without CLAUDE_PLUGIN_ROOT (got '$LOCATOR_EMPTY_OUTPUT')" ;;
esac

echo "# feature workflow: next lazily creates and advances"
T="$(sandbox)"
FIRST_NEXT="$(run next entrance-monitor --workflow feature --json)"
eq "next starts in open" "$(printf '%s' "$FIRST_NEXT" | json_get 'j.phase')" "open"
eq "next syncs project rules" \
  "$(test -f "$T/.claude/rules/hikspine-workflow.md" && echo yes || echo no)" "yes"
eq "next returns synced rules for current session" \
  "$(printf '%s' "$FIRST_NEXT" | json_get 'j.projectRules.readNow.includes(".claude/rules/hikspine-workflow.md") ? "yes" : "no"')" "yes"
printf '# Local Hikspine Rule\n' > "$T/.claude/rules/hikspine-workflow.md"
LOCAL_RULE_NEXT="$(run next entrance-monitor --json)"
eq "rules sync preserves local edits" "$(head -n 1 "$T/.claude/rules/hikspine-workflow.md")" "# Local Hikspine Rule"
eq "next reports skipped local rule edits" \
  "$(printf '%s' "$LOCAL_RULE_NEXT" | json_get 'j.projectRules.skipped.some(r=>r.path===".claude/rules/hikspine-workflow.md" && r.reason==="unmanaged_existing_file") ? "yes" : "no"')" "yes"
eq "feature state is colocated with OpenSpec" \
  "$(test -f "$T/openspec/changes/entrance-monitor/.hikspine.yaml" && echo yes || echo no)" "yes"
eq "active change set by next" "$(cat "$T/.hikspine/active")" "entrance-monitor"
eq "next node is open.openspec" "$(run next entrance-monitor --json | json_get 'j.node')" "open.openspec"

mkdir -p "$T/openspec/changes/entrance-monitor/specs"
printf 'proposal\n' > "$T/openspec/changes/entrance-monitor/proposal.md"
printf -- '- [ ] initial task\n' > "$T/openspec/changes/entrance-monitor/tasks.md"
eq "open artifacts advance to design" "$(run next entrance-monitor --json | json_get 'j.phase')" "design"
eq "design starts with brainstorming node" "$(run next entrance-monitor --json | json_get 'j.node')" "design.brainstorm"
eq "design next skill is brainstorming" "$(run next entrance-monitor --json | json_get 'j.nextSkill.id')" "brainstorming"
eq "feature design requires brainstorming" "$(run next entrance-monitor --json | json_get 'j.requiredSkills.some(s=>s.id==="brainstorming") ? "yes" : "no"')" "yes"
eq "design passes OpenSpec inputs to brainstorming" "$(run next entrance-monitor --json | json_get 'j.requiredInputs.some(i=>i.key==="proposal" && i.path==="openspec/changes/entrance-monitor/proposal.md" && i.useBefore.includes("brainstorming")) ? "yes" : "no"')" "yes"

if (cd "$T" && printf '{"tool_name":"Write","tool_input":{"file_path":"src/App.ts"}}' | CLAUDE_PLUGIN_ROOT="$REPO" "$NODE_BIN" "$HOOK_RUN" >/dev/null 2>&1); then
  bad "hook bridge blocks source writes in design"
else
  ok "hook bridge blocks source writes in design"
fi
HOOK_CMD="$("$NODE_BIN" -e "const fs=require('fs'); const j=JSON.parse(fs.readFileSync(process.argv[1],'utf8')); console.log(j.hooks.PreToolUse[0].hooks[0].command)" "$HOOKS_JSON_RUN")"
if (cd "$T" && printf '{"tool_name":"Write","tool_input":{"file_path":"src/App.ts"}}' | env -u CLAUDE_PLUGIN_ROOT -u HIKSPINE_PLUGIN_ROOT bash -lc "$HOOK_CMD" >/dev/null 2>&1); then
  bad "hook command locates guard without CLAUDE_PLUGIN_ROOT"
else
  ok "hook command locates guard without CLAUDE_PLUGIN_ROOT"
fi

printf '# Design\n\n## Selected Direction\nOne path.\n' > "$T/openspec/changes/entrance-monitor/design.md"
eq "design blocks without required sections" "$(run next entrance-monitor --json | json_get 'j.phase')" "design"
eq "design reports missing Brainstorming heading" "$(run next entrance-monitor --json | json_get 'j.missing.some(m=>m.missingHeadings && m.missingHeadings.includes("Brainstorming")) ? "yes" : "no"')" "yes"
cat > "$T/openspec/changes/entrance-monitor/design.md" <<'MD'
# Design

## Brainstorming
Compared alternatives and risks.

## Alternatives
Option A and option B.

## Selected Direction
Choose option A.

## Company Constraints
No special platform blocker found.

## Open Questions
None.
MD
eq "design blocks without input provenance" "$(run next entrance-monitor --json | json_get 'j.phase')" "design"
eq "design reports missing Inputs Reviewed heading" "$(run next entrance-monitor --json | json_get 'j.missing.some(m=>m.missingHeadings && m.missingHeadings.includes("Inputs Reviewed")) ? "yes" : "no"')" "yes"
cat > "$T/openspec/changes/entrance-monitor/design.md" <<'MD'
# Design

## Inputs Reviewed
- openspec/changes/entrance-monitor/proposal.md
- openspec/changes/entrance-monitor/tasks.md
- openspec/changes/entrance-monitor/specs

## Brainstorming
Compared alternatives and risks.

## Questions From OpenSpec
No unresolved product questions remain.

## Options Considered
Option A and option B.

## Tradeoffs
Option A is simpler, option B has more flexibility.

## Selected Direction
Choose option A.

## Company Constraints
No special platform blocker found.

## Open Questions
None.
MD
eq "brainstorming artifact advances to user confirmation" "$(run next entrance-monitor --json | json_get 'j.node')" "design.confirm"
eq "user confirmation node requires user" "$(run next entrance-monitor --json | json_get 'j.agent.requiresUser ? "yes" : "no"')" "yes"
eq "user confirmation asks technology stack" "$(run next entrance-monitor --json | json_get 'j.agent.requiredQuestions.includes("technology_stack") ? "yes" : "no"')" "yes"
eq "design blocks without user confirmation" "$(run next entrance-monitor --json | json_get 'j.missing.some(m=>m.missingHeadings && m.missingHeadings.includes("User Confirmation")) ? "yes" : "no"')" "yes"
cat >> "$T/openspec/changes/entrance-monitor/design.md" <<'MD'

## User Decisions
Technology stack: User confirmed Vue 3 frontend and Spring Boot backend.
Architecture/integration: User confirmed a dashboard UI backed by realtime API integration.
Data/realtime path: User confirmed WebSocket push for realtime records.
Company constraints: User confirmed no additional company platform blocker.

## User Confirmation
Confirmed by user: Approved option A and confirmed no open design questions.
MD
eq "confirmed design advances to build" "$(run next entrance-monitor --json | json_get 'j.phase')" "build"
eq "build reads design before planning" "$(run next entrance-monitor --json | json_get 'j.requiredInputs.some(i=>i.key==="design_doc" && i.path==="openspec/changes/entrance-monitor/design.md" && i.useBefore.includes("superpowers.plan")) ? "yes" : "no"')" "yes"
eq "build starts with planning step" "$(run next entrance-monitor --json | json_get 'j.nextSkill.id')" "superpowers.plan"
cat > "$T/openspec/changes/entrance-monitor/implementation.md" <<'MD'
# Implementation

## Inputs Reviewed
- openspec/changes/entrance-monitor/design.md
- openspec/changes/entrance-monitor/tasks.md

## Implementation Plan
Implement the selected direction.

## Source Change Plan
Update the relevant source files.

## Verification Plan
Run focused verification.
MD
eq "build plan advances to implementation step" "$(run next entrance-monitor --json | json_get 'j.nextSkill.id')" "superpowers.implement"
rm -rf "$T"

echo "# simple-fix workflow: lightweight observable artifacts"
T="$(sandbox)"
eq "simple-fix starts in inspect" "$(run next fix-login-timeout --workflow simple-fix --json | json_get 'j.phase')" "inspect"
eq "simple-fix state is standalone" \
  "$(test -f "$T/.hikspine/changes/fix-login-timeout.yaml" && echo yes || echo no)" "yes"
mkdir -p "$T/.hikspine/changes"
printf '# Inspect\nRelevant path identified.\n' > "$T/.hikspine/changes/fix-login-timeout.inspect.md"
eq "inspect artifact advances to fix" "$(run next fix-login-timeout --json | json_get 'j.phase')" "fix"
printf '# Patch\nMinimal patch applied.\n' > "$T/.hikspine/changes/fix-login-timeout.patch.md"
eq "patch artifact advances to verify" "$(run next fix-login-timeout --json | json_get 'j.phase')" "verify"
printf '# Verify\nresult: fail\n' > "$T/.hikspine/changes/fix-login-timeout.verify.md"
eq "verify failure rolls back to fix" "$(run next fix-login-timeout --json | json_get 'j.phase')" "fix"
rm -rf "$T"

echo "# custom workflow: project workflow without skill changes"
T="$(sandbox)"
mkdir -p "$T/.hikspine/workflows"
cat > "$T/.hikspine/workflows/tiny-review.yaml" <<'YAML'
id: tiny-review
version: 1
name: Tiny Review

phases:
  - id: inspect
    goal: Create a tiny review note.
    nodes:
      - id: inspect.note
        type: agent-loop
        required: true
        objective: Write a small note artifact.
        outputs:
          - key: note
            path: .hikspine/changes/{change}.note.md
        exit:
          checks:
            - file.exists: .hikspine/changes/{change}.note.md
YAML
eq "custom workflow starts from project file" "$(run next custom-note --workflow tiny-review --storage standalone --json | json_get 'j.workflow')" "tiny-review"
eq "custom workflow state is standalone when requested" \
  "$(test -f "$T/.hikspine/changes/custom-note.yaml" && echo yes || echo no)" "yes"
printf '# Note\nCustom workflow artifact.\n' > "$T/.hikspine/changes/custom-note.note.md"
eq "custom workflow completes by observable artifact" "$(run next custom-note --json | json_get 'j.complete ? "yes" : "no"')" "yes"
rm -rf "$T"

echo ""
echo "RESULT: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
