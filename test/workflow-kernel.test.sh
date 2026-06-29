#!/usr/bin/env bash
# Test suite for the Hikspine composable state machine kernel.
# Covers: runtime locator, feature workflow, simple-fix workflow, custom
# workflows, guard hook, and cross-state rollback.
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
has() {
  case "$2" in
    *"$3"*) ok "$1" ;;
    *) bad "$1 (expected to contain '$3', got '$2')" ;;
  esac
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

# json_get: evaluate a JS expression against piped JSON on stdin.
#   $1 = JS expression (use single-quoted strings, not double-quoted)
json_get() {
  "$NODE_BIN" -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s); console.log($1)})"
}

# json_test: evaluate a JS expression against piped JSON on stdin.
#   $1 = JS expression → exit 0 if truthy, exit 1 if falsy.
json_test() {
  "$NODE_BIN" -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s); process.exit($1?0:1)})"
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

# ─── feature workflow: decision-driven state machine ──────────────────────

echo "# feature workflow: decision-driven state machine"
T="$(sandbox)"

# --- open state ---
FIRST_NEXT="$(run next entrance-monitor --workflow feature --json)"
eq "next starts in open" \
  "$(printf '%s' "$FIRST_NEXT" | json_get 'j.current')" "open"
eq "next syncs project rules" \
  "$(test -f "$T/.claude/rules/hikspine-workflow.md" && echo yes || echo no)" "yes"
eq "next returns synced rules for current session" \
  "$(printf '%s' "$FIRST_NEXT" | json_get "j.projectRules.readNow.includes('.claude/rules/hikspine-workflow.md') ? 'yes' : 'no'")" "yes"
eq "open state forbids write-source" \
  "$(printf '%s' "$FIRST_NEXT" | json_get "j.forbid.includes('write-source') ? 'yes' : 'no'")" "yes"
eq "open state has capabilities" \
  "$(printf '%s' "$FIRST_NEXT" | json_test "Array.isArray(j.capabilities) && j.capabilities.length >= 2 && j.capabilities.some(c=>c.id==='openspec-explore') && j.capabilities.some(c=>c.id==='openspec-propose')" && echo yes || echo no)" "yes"
eq "open state needs" \
  "$(printf '%s' "$FIRST_NEXT" | json_get "j.missing.includes('requirements_clarified') && j.missing.includes('proposal_ready') ? 'yes' : 'no'")" "yes"
eq "open state is not terminal" \
  "$(printf '%s' "$FIRST_NEXT" | json_get "j.terminal ? 'yes' : 'no'")" "no"
eq "open state nextAction is work" \
  "$(printf '%s' "$FIRST_NEXT" | json_get 'j.nextAction')" "work"

# Rule sync: preserve local edits
printf '# Local Hikspine Rule\n' > "$T/.claude/rules/hikspine-workflow.md"
LOCAL_RULE_NEXT="$(run next entrance-monitor --json)"
eq "rules sync preserves local edits" "$(head -n 1 "$T/.claude/rules/hikspine-workflow.md")" "# Local Hikspine Rule"
eq "next reports skipped local rule edits" \
  "$(printf '%s' "$LOCAL_RULE_NEXT" | json_test "j.projectRules.skipped && j.projectRules.skipped.some(r=>r.path==='.claude/rules/hikspine-workflow.md' && r.reason==='unmanaged_existing_file')" && echo yes || echo no)" "yes"

# State file and active change
eq "feature state is colocated with OpenSpec" \
  "$(test -f "$T/openspec/changes/entrance-monitor/.hikspine.yaml" && echo yes || echo no)" "yes"
eq "active change set by next" "$(cat "$T/.hikspine/active")" "entrance-monitor"

# --- advance to design via decisions ---
DECIDE1="$(run decide requirements_clarified --json)"
eq "decide first key stays in open" \
  "$(printf '%s' "$DECIDE1" | json_get 'j.current')" "open"
eq "decide first key has one remaining missing" \
  "$(printf '%s' "$DECIDE1" | json_get 'JSON.stringify(j.missing)')" '["proposal_ready"]'

DECIDE2="$(run decide proposal_ready --json)"
eq "decide second key advances to design" \
  "$(printf '%s' "$DECIDE2" | json_get 'j.current')" "design"
eq "design requires user confirmation" \
  "$(printf '%s' "$DECIDE2" | json_get "j.requiresUser ? 'yes' : 'no'")" "yes"
eq "design nextAction is confirm" \
  "$(printf '%s' "$DECIDE2" | json_get 'j.nextAction')" "confirm"
eq "design surfaces workflow-authored rules" \
  "$(printf '%s' "$DECIDE2" | json_test "Array.isArray(j.rules) && j.rules.some(r=>/brainstorming/.test(r))" && echo yes || echo no)" "yes"
eq "open state has no rules" \
  "$(printf '%s' "$FIRST_NEXT" | json_test "Array.isArray(j.rules) && j.rules.length === 0" && echo yes || echo no)" "yes"
eq "design has brainstorming capability" \
  "$(printf '%s' "$DECIDE2" | json_test "j.capabilities.some(c=>c.id==='brainstorming')" && echo yes || echo no)" "yes"
eq "design forbids write-source" \
  "$(printf '%s' "$DECIDE2" | json_get "j.forbid.includes('write-source') ? 'yes' : 'no'")" "yes"

# --- guard hook: blocks source writes in design ---
if (cd "$T" && printf '{"tool_name":"Write","tool_input":{"file_path":"src/App.ts"}}' | CLAUDE_PLUGIN_ROOT="$REPO" "$NODE_BIN" "$HOOK_RUN" >/dev/null 2>&1); then
  bad "hook blocks source writes in design"
else
  ok "hook blocks source writes in design"
fi
if (cd "$T" && printf '{"tool_name":"Write","tool_input":{"file_path":"docs/readme.md"}}' | CLAUDE_PLUGIN_ROOT="$REPO" "$NODE_BIN" "$HOOK_RUN" >/dev/null 2>&1); then
  ok "hook allows non-source writes in design"
else
  bad "hook allows non-source writes in design"
fi

# Verify the guard bootstrap script locates itself without env vars
GUARD_SH="$REPO/hooks/guard.sh"
if (cd "$T" && printf '{"tool_name":"Write","tool_input":{"file_path":"src/App.ts"}}' | env -u CLAUDE_PLUGIN_ROOT -u HIKSPINE_PLUGIN_ROOT bash "$GUARD_SH" >/dev/null 2>&1); then
  bad "guard.sh locates plugin root without env vars"
else
  ok "guard.sh locates plugin root without env vars"
fi

# --- advance through design → build → review → verify → archive ---
DECIDE3="$(run decide design_documented --json)"
eq "decide design_documented stays in design" \
  "$(printf '%s' "$DECIDE3" | json_get 'j.current')" "design"
eq "design still missing design_confirmed" \
  "$(printf '%s' "$DECIDE3" | json_get "j.missing.includes('design_confirmed') ? 'yes' : 'no'")" "yes"

DECIDE4="$(run decide design_confirmed --json)"
eq "decide design_confirmed advances to build" \
  "$(printf '%s' "$DECIDE4" | json_get 'j.current')" "build"
eq "build has plan capability" \
  "$(printf '%s' "$DECIDE4" | json_test "j.capabilities.some(c=>c.id==='writing-plans')" && echo yes || echo no)" "yes"
eq "build has implement capability" \
  "$(printf '%s' "$DECIDE4" | json_test "j.capabilities.some(c=>c.id==='executing-plans')" && echo yes || echo no)" "yes"
eq "capabilities carry discovered skill descriptions" \
  "$(printf '%s' "$DECIDE4" | json_test "j.capabilities.find(c=>c.id==='writing-plans').description.length > 0" && echo yes || echo no)" "yes"
eq "build does not forbid source writes" \
  "$(printf '%s' "$DECIDE4" | json_get "j.forbid.includes('write-source') ? 'yes' : 'no'")" "no"

DECIDE5="$(run decide implemented --json)"
eq "decide implemented advances to review" \
  "$(printf '%s' "$DECIDE5" | json_get 'j.current')" "review"
eq "review has review capability" \
  "$(printf '%s' "$DECIDE5" | json_test "j.capabilities.some(c=>c.id==='requesting-code-review')" && echo yes || echo no)" "yes"
eq "review needs review_result=pass" \
  "$(printf '%s' "$DECIDE5" | json_get "j.missing.includes('review_result=pass') ? 'yes' : 'no'")" "yes"

DECIDE6="$(run decide review_result pass --json)"
eq "decide review_result=pass advances to verify" \
  "$(printf '%s' "$DECIDE6" | json_get 'j.current')" "verify"
eq "verify needs verify_result=pass" \
  "$(printf '%s' "$DECIDE6" | json_get "j.missing.includes('verify_result=pass') ? 'yes' : 'no'")" "yes"

# --- cross-state rollback: verify failure ---
DECIDE7="$(run decide verify_result fail --json)"
eq "verify_result=fail rolls back to build" \
  "$(printf '%s' "$DECIDE7" | json_get 'j.current')" "build"
eq "rollback has reason set" \
  "$(printf '%s' "$DECIDE7" | json_get "j.rollback ? j.rollback.reason : 'none'")" "Verification did not pass."
eq "rollback to/from fields" \
  "$(printf '%s' "$DECIDE7" | json_test "j.rollback && j.rollback.to==='build' && j.rollback.from==='verify'" && echo yes || echo no)" "yes"
eq "rollback clears implemented decision" \
  "$(printf '%s' "$DECIDE7" | json_get "j.missing.includes('implemented') ? 'yes' : 'no'")" "yes"
# Decisions for downstream states are cleared by rollback; verify by
# re-advancing: after re-deciding implemented, review_result must be needed again.
ROLLBACK_DECISIONS="$(printf '%s' "$DECIDE7" | json_get 'JSON.stringify(j)')"
eq "rollback clears review_result from decisions" \
  "$(printf '%s' "$ROLLBACK_DECISIONS" | "$NODE_BIN" -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s); console.log(j.decisions && j.decisions.review_result ? 'present' : 'cleared')})")" "cleared"
eq "rollback clears verify_result from decisions" \
  "$(printf '%s' "$ROLLBACK_DECISIONS" | "$NODE_BIN" -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s); console.log(j.decisions && j.decisions.verify_result ? 'present' : 'cleared')})")" "cleared"

# --- re-do: implement → review → verify (pass) → archive ---
REDO_IMPL="$(run decide implemented --json)"
eq "re-implement advances to review (review needs redo)" \
  "$(printf '%s' "$REDO_IMPL" | json_get 'j.current')" "review"
eq "review_result=pass needed again after rollback" \
  "$(printf '%s' "$REDO_IMPL" | json_get "j.missing.includes('review_result=pass') ? 'yes' : 'no'")" "yes"
REDO_REVIEW="$(run decide review_result pass --json)"
eq "re-review advances to verify" \
  "$(printf '%s' "$REDO_REVIEW" | json_get 'j.current')" "verify"
eq "rollback cleared after advance" \
  "$(printf '%s' "$REDO_REVIEW" | json_get "j.rollback ? 'present' : 'cleared'")" "cleared"

REDO_VERIFY="$(run decide verify_result pass --json)"
eq "verify pass advances to archive" \
  "$(printf '%s' "$REDO_VERIFY" | json_get 'j.current')" "archive"
eq "archive requires user confirmation" \
  "$(printf '%s' "$REDO_VERIFY" | json_get "j.requiresUser ? 'yes' : 'no'")" "yes"
eq "archive forbids write-source" \
  "$(printf '%s' "$REDO_VERIFY" | json_get "j.forbid.includes('write-source') ? 'yes' : 'no'")" "yes"
eq "archive is terminal" \
  "$(printf '%s' "$REDO_VERIFY" | json_get "j.terminal ? 'yes' : 'no'")" "yes"

ARCHIVED="$(run decide archived --json)"
eq "decide archived completes workflow" \
  "$(printf '%s' "$ARCHIVED" | json_get "j.complete ? 'yes' : 'no'")" "yes"
eq "completed workflow nextAction is done" \
  "$(printf '%s' "$ARCHIVED" | json_get 'j.nextAction')" "done"

rm -rf "$T"

# ─── simple-fix workflow: lightweight standalone ──────────────────────────

echo "# simple-fix workflow: decision-driven (standalone storage)"
T="$(sandbox)"

SF_NEXT="$(run next fix-login-timeout --workflow simple-fix --json)"
eq "simple-fix starts in inspect" \
  "$(printf '%s' "$SF_NEXT" | json_get 'j.current')" "inspect"
eq "simple-fix state is standalone" \
  "$(test -f "$T/.hikspine/changes/fix-login-timeout.yaml" && echo yes || echo no)" "yes"
eq "simple-fix has inspect capability" \
  "$(printf '%s' "$SF_NEXT" | json_test "j.capabilities.some(c=>c.id==='systematic-debugging')" && echo yes || echo no)" "yes"
eq "simple-fix needs issue_understood" \
  "$(printf '%s' "$SF_NEXT" | json_get "j.missing.includes('issue_understood') ? 'yes' : 'no'")" "yes"

SF_FIX="$(run decide issue_understood --json)"
eq "issue_understood advances to fix" \
  "$(printf '%s' "$SF_FIX" | json_get 'j.current')" "fix"
eq "fix has implement capability" \
  "$(printf '%s' "$SF_FIX" | json_test "j.capabilities.some(c=>c.id==='executing-plans')" && echo yes || echo no)" "yes"

SF_VERIFY="$(run decide patched --json)"
eq "patched advances to verify" \
  "$(printf '%s' "$SF_VERIFY" | json_get 'j.current')" "verify"
eq "verify state is terminal" \
  "$(printf '%s' "$SF_VERIFY" | json_get "j.terminal ? 'yes' : 'no'")" "yes"

# --- rollback on verify failure ---
SF_ROLLBACK="$(run decide verify_result fail --json)"
eq "verify fail rolls back to fix" \
  "$(printf '%s' "$SF_ROLLBACK" | json_get 'j.current')" "fix"
eq "rollback clears patched decision" \
  "$(printf '%s' "$SF_ROLLBACK" | json_get "j.missing.includes('patched') ? 'yes' : 'no'")" "yes"

# Re-do: fix → verify (pass) → complete
run decide patched --json > /dev/null
SF_DONE="$(run decide verify_result pass --json)"
eq "verify pass completes simple-fix" \
  "$(printf '%s' "$SF_DONE" | json_get "j.complete ? 'yes' : 'no'")" "yes"

rm -rf "$T"

# ─── hotfix workflow: standalone storage ───────────────────────────────────

echo "# hotfix workflow: standalone storage"
T="$(sandbox)"

HF_NEXT="$(run next urgent-crash --workflow hotfix --json)"
eq "hotfix starts in inspect" \
  "$(printf '%s' "$HF_NEXT" | json_get 'j.current')" "inspect"
eq "hotfix state is standalone" \
  "$(test -f "$T/.hikspine/changes/urgent-crash.yaml" && echo yes || echo no)" "yes"
eq "hotfix needs issue_confirmed" \
  "$(printf '%s' "$HF_NEXT" | json_get "j.missing.includes('issue_confirmed') ? 'yes' : 'no'")" "yes"

run decide issue_confirmed --json > /dev/null
HF_PATCH="$(run decide patched --json)"
eq "patched advances to verify in hotfix" \
  "$(printf '%s' "$HF_PATCH" | json_get 'j.current')" "verify"

HF_ROLLBACK="$(run decide verify_result fail --json)"
eq "verify fail rolls back to patch" \
  "$(printf '%s' "$HF_ROLLBACK" | json_get 'j.current')" "patch"

run decide patched --json > /dev/null
HF_DONE="$(run decide verify_result pass --json)"
eq "verify pass completes hotfix" \
  "$(printf '%s' "$HF_DONE" | json_get "j.complete ? 'yes' : 'no'")" "yes"

rm -rf "$T"

# ─── new-project workflow: extra scaffold state ────────────────────────────

echo "# new-project workflow: scaffold state"
T="$(sandbox)"

NP_NEXT="$(run next my-service --workflow new-project --json)"
eq "new-project starts in open" \
  "$(printf '%s' "$NP_NEXT" | json_get 'j.current')" "open"
eq "new-project open needs proposal_ready" \
  "$(printf '%s' "$NP_NEXT" | json_get "j.missing.includes('proposal_ready') ? 'yes' : 'no'")" "yes"

NP_DESIGN="$(run decide proposal_ready --json)"
eq "advances to design" \
  "$(printf '%s' "$NP_DESIGN" | json_get 'j.current')" "design"

run decide design_documented --json > /dev/null
NP_SCAFFOLD="$(run decide design_confirmed --json)"
eq "advances to scaffold (not build)" \
  "$(printf '%s' "$NP_SCAFFOLD" | json_get 'j.current')" "scaffold"
eq "scaffold has implement capability" \
  "$(printf '%s' "$NP_SCAFFOLD" | json_test "j.capabilities.some(c=>c.id==='executing-plans')" && echo yes || echo no)" "yes"

NP_BUILD="$(run decide scaffolded --json)"
eq "scaffolded advances to build" \
  "$(printf '%s' "$NP_BUILD" | json_get 'j.current')" "build"
eq "build has plan+implement capabilities" \
  "$(printf '%s' "$NP_BUILD" | json_test "j.capabilities.some(c=>c.id==='writing-plans') && j.capabilities.some(c=>c.id==='executing-plans')" && echo yes || echo no)" "yes"

rm -rf "$T"

# ─── custom workflow: states-based YAML ────────────────────────────────────

echo "# custom workflow: project workflow with states format"
T="$(sandbox)"
mkdir -p "$T/.hikspine/workflows"

cat > "$T/.hikspine/workflows/tiny-review.yaml" <<'YAML'
id: tiny-review
version: 1
name: Tiny Review
start: inspect

states:
  - id: inspect
    goal: Create a tiny review note.
    capabilities: [superpowers.inspect]
    needs: [note_written]
    next: review

  - id: review
    goal: Review the note and finish.
    capabilities: [superpowers.review]
    needs: [review_done]
    terminal: true
YAML

CT_NEXT="$(run next custom-note --workflow tiny-review --storage standalone --json)"
eq "custom workflow starts from project file" \
  "$(printf '%s' "$CT_NEXT" | json_get 'j.workflow')" "tiny-review"
eq "custom workflow state is standalone" \
  "$(test -f "$T/.hikspine/changes/custom-note.yaml" && echo yes || echo no)" "yes"
eq "custom workflow starts in inspect" \
  "$(printf '%s' "$CT_NEXT" | json_get 'j.current')" "inspect"
eq "custom workflow has inspect capability" \
  "$(printf '%s' "$CT_NEXT" | json_test "j.capabilities.some(c=>c.id==='superpowers.inspect')" && echo yes || echo no)" "yes"

CT_REVIEW="$(run decide note_written --json)"
eq "note_written advances to review" \
  "$(printf '%s' "$CT_REVIEW" | json_get 'j.current')" "review"

CT_DONE="$(run decide review_done --json)"
eq "review_done completes custom workflow" \
  "$(printf '%s' "$CT_DONE" | json_get "j.complete ? 'yes' : 'no'")" "yes"

rm -rf "$T"

# ─── editor output: block-style YAML the workflow editor writes ────────────
# The editor saves via writeYamlFile (block sequences: "-\n  id: ..."). Verify
# that exact shape parses and runs, so editor-authored workflows work.

echo "# editor output: block-style workflow YAML roundtrips"
T="$(sandbox)"
mkdir -p "$T/.hikspine/workflows"
cat > "$T/.hikspine/workflows/edit-flow.yaml" <<'YAML'
id: edit-flow
version: 1
name: Edited
intent: authored in the editor
start: a
states:
  -
    id: a
    capabilities:
      - systematic-debugging
    needs:
      - done_a
    next: b
  -
    id: b
    needs:
      - done_b
    terminal: true
YAML

EF_NEXT="$(run next ef-change --workflow edit-flow --storage standalone --json)"
eq "editor-style workflow loads and starts" \
  "$(printf '%s' "$EF_NEXT" | json_get 'j.current')" "a"
eq "editor-style workflow resolves capability skill name" \
  "$(printf '%s' "$EF_NEXT" | json_test "j.capabilities.some(c=>c.id==='systematic-debugging')" && echo yes || echo no)" "yes"
eq "editor-style workflow appears in workflows listing with intent" \
  "$(run workflows --json | json_test "j.workflows.some(w=>w.id==='edit-flow' && w.source==='project' && w.intent.length>0)" && echo yes || echo no)" "yes"
EF_DONE="$(run decide done_a --json && run decide done_b --json)"
eq "editor-style workflow advances to terminal" \
  "$(printf '%s' "$(run board --json)" | json_test "j.changes.find(c=>c.change==='ef-change').complete" && echo yes || echo no)" "yes"

rm -rf "$T"

# ─── orchestration: workflows + changes registries ────────────────────────

echo "# orchestration: workflows and changes registries"
T="$(sandbox)"

WF_LIST="$(run workflows --json)"
eq "workflows lists builtins" \
  "$(printf '%s' "$WF_LIST" | json_test "['feature','simple-fix','hotfix','new-project'].every(id=>j.workflows.some(w=>w.id===id))" && echo yes || echo no)" "yes"
eq "workflows carry selection intent" \
  "$(printf '%s' "$WF_LIST" | json_test "j.workflows.find(w=>w.id==='hotfix').intent.length > 0" && echo yes || echo no)" "yes"

SK_LIST="$(run skills --json)"
eq "skills discovers real Claude Code skills by name" \
  "$(printf '%s' "$SK_LIST" | json_test "j.skills.some(s=>s.name==='brainstorming' && s.description.length > 0)" && echo yes || echo no)" "yes"

# Two concurrent changes on different workflows coexist
run next bug-1 --workflow simple-fix --json > /dev/null
run next feat-x --workflow feature --json > /dev/null
CH_LIST="$(run changes --json)"
eq "changes lists all in-flight runs" \
  "$(printf '%s' "$CH_LIST" | json_test "j.changes.length === 2 && j.changes.some(c=>c.change==='bug-1'&&c.workflow==='simple-fix') && j.changes.some(c=>c.change==='feat-x'&&c.workflow==='feature')" && echo yes || echo no)" "yes"
eq "changes report nextAction per run" \
  "$(printf '%s' "$CH_LIST" | json_test "j.changes.every(c=>typeof c.nextAction==='string')" && echo yes || echo no)" "yes"
eq "changes mark the active run" \
  "$(printf '%s' "$CH_LIST" | json_get 'j.active')" "feat-x"

# board aggregates everything the web UI serves at /api/state
BOARD="$(run board --json)"
eq "board aggregates changes, workflows, and skills" \
  "$(printf '%s' "$BOARD" | json_test "Array.isArray(j.changes) && j.workflows.length >= 4 && j.skills.length > 0 && j.changes.length === 2" && echo yes || echo no)" "yes"
eq "board marks the active change" \
  "$(printf '%s' "$BOARD" | json_get 'j.active')" "feat-x"

rm -rf "$T"

# ─── edge cases ────────────────────────────────────────────────────────────

echo "# edge cases"
T="$(sandbox)"

# Multiple changes without active: next requires explicit change name
run next change-a --workflow simple-fix --json > /dev/null
run next change-b --workflow simple-fix --json > /dev/null
# Clear active to force "no active change" scenario
rm -f "$T/.hikspine/active"
NO_ACTIVE="$(run next --json 2>&1 || true)"
has "next without active or change arg reports error" "$NO_ACTIVE" "No active change"

# Invalid change name
run next change-c --workflow simple-fix --json > /dev/null  # create one more so resolveChange doesn't pick single
INVALID="$(run next 'bad/name' --workflow feature --json 2>&1 || true)"
has "invalid change name rejected" "$INVALID" "Invalid change name"

rm -rf "$T"

# ─── summary ───────────────────────────────────────────────────────────────

echo ""
echo "RESULT: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
