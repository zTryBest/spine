#!/usr/bin/env bash
# Test suite for the Hikspine composable state machine kernel.
# Covers: runtime locator, feature workflow, fix workflow, custom
# workflows, guard hook, and cross-state rollback.
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd -P)"
ENGINE="$REPO/src/hikspine.mjs"
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
export HIKSPINE_HOME="$REPO/.tmp/hikspine-home"
mkdir -p "$HIKSPINE_HOME"

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

node_path() {
  local p="$1"
  case "$NODE_BIN" in
    *.exe|*.EXE)
      if command -v wslpath >/dev/null 2>&1; then wslpath -w "$p"; return; fi
      ;;
  esac
  printf '%s\n' "$p"
}

echo "# runtime locator"
LOCATOR_OUTPUT="$(CLAUDE_PLUGIN_ROOT="$REPO/" bash -lc ". \"$REPO//skills/hikspine/scripts/hikspine-env.sh\" && printf '%s' \"\$HIKSPINE_ENGINE\"")"
case "$LOCATOR_OUTPUT" in
  *"//src/"*) bad "env locator normalizes trailing slash" ;;
  */src/hikspine.mjs) ok "env locator normalizes trailing slash" ;;
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
  */src/hikspine.mjs) ok "runtime locator works without CLAUDE_PLUGIN_ROOT" ;;
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
eq "open state carries a capabilityPolicy" \
  "$(printf '%s' "$FIRST_NEXT" | json_test "typeof j.capabilityPolicy === 'string' && j.capabilityPolicy.length > 0" && echo yes || echo no)" "yes"
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
PROJECT_ROOT_ARG="$(node_path "$T")"
BOARD_FROM_REPO="$(cd "$REPO" && "$NODE_BIN" "$ENGINE_RUN" board --project-root "$PROJECT_ROOT_ARG" --json)"
eq "board can read another project with --project-root" \
  "$(printf '%s' "$BOARD_FROM_REPO" | json_get "j.changes.some(c=>c.change==='entrance-monitor') ? 'yes' : 'no'")" "yes"
ENV_ACTIVE="$(cd "$REPO" && "$NODE_BIN" --input-type=module -e 'process.env.HIKSPINE_PROJECT_ROOT = process.argv[1]; const { resolveProjectRoot } = await import("./src/utils.mjs"); const { boardState } = await import("./src/board.mjs"); console.log(boardState(resolveProjectRoot({})).active);' "$PROJECT_ROOT_ARG")"
eq "board can read another project from HIKSPINE_PROJECT_ROOT" "$ENV_ACTIVE" "entrance-monitor"
if "$NODE_BIN" -e "process.exit(process.platform === 'win32' ? 0 : 1)" >/dev/null 2>&1; then
  REPO_NATIVE="$(node_path "$REPO")"
  REPO_SLASHLESS="$(printf '%s' "$REPO_NATIVE" | sed -E 's#^([A-Za-z]):#\L\1#; s#\\#/#g')"
  ROOT_NORMALIZED="$(cd "$REPO" && "$NODE_BIN" --input-type=module -e 'const expected = process.argv[1].toLowerCase().replace(/\\/g, "/"); const input = process.argv[2]; const { resolveProjectRoot } = await import("./src/utils.mjs"); console.log(resolveProjectRoot({"project-root": input}).toLowerCase().replace(/\\/g, "/") === expected ? "yes" : "no");' "$REPO_NATIVE" "$REPO_SLASHLESS")"
  eq "project-root normalizes Git Bash drive paths without leading slash" "$ROOT_NORMALIZED" "yes"
fi

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
eq "design uses file handoff for writing-plans" \
  "$(printf '%s' "$DECIDE2" | json_test "Array.isArray(j.rules) && j.rules.some(r=>/file handoff only/.test(r)) && j.rules.some(r=>/docs\\/superpowers\\/plans\\/\\{change\\}\\.md/.test(r))" && echo yes || echo no)" "yes"
eq "design sharding keeps writing-plans small" \
  "$(printf '%s' "$DECIDE2" | json_test "Array.isArray(j.rules) && j.rules.some(r=>/do not Read proposal\\.md/.test(r)) && j.rules.some(r=>/shard the plan/.test(r)) && j.rules.some(r=>/\\{change\\}-\\{spec-id\\}\\.md/.test(r)) && j.rules.some(r=>/concise manifest/.test(r))" && echo yes || echo no)" "yes"
eq "open surfaces codegraph exploration rule" \
  "$(printf '%s' "$FIRST_NEXT" | json_test "Array.isArray(j.rules) && j.rules.some(r=>/codegraph/.test(r))" && echo yes || echo no)" "yes"
eq "design has brainstorming capability" \
  "$(printf '%s' "$DECIDE2" | json_test "j.capabilities.some(c=>c.id==='brainstorming')" && echo yes || echo no)" "yes"
eq "design has planning capability" \
  "$(printf '%s' "$DECIDE2" | json_test "j.capabilities.some(c=>c.id==='writing-plans')" && echo yes || echo no)" "yes"
eq "design planning capability carries discovered description" \
  "$(printf '%s' "$DECIDE2" | json_test "j.capabilities.find(c=>c.id==='writing-plans').description.length > 0" && echo yes || echo no)" "yes"
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
eq "design asks for tdd_mode before build" \
  "$(printf '%s' "$DECIDE3" | json_get "j.missing.includes('tdd_mode') ? 'yes' : 'no'")" "yes"

run decide tdd_mode true --json > /dev/null
DECIDE4="$(run decide design_confirmed --json)"
eq "decide design_confirmed advances to build" \
  "$(printf '%s' "$DECIDE4" | json_get 'j.current')" "build"
eq "next exposes recorded decisions (tdd_mode)" \
  "$(printf '%s' "$DECIDE4" | json_get "j.decisions && j.decisions.tdd_mode===true ? 'yes' : 'no'")" "yes"
eq "build offers test-driven-development when tdd enabled (when tag)" \
  "$(printf '%s' "$DECIDE4" | json_test "typeof (j.capabilities.find(c=>c.id==='test-driven-development')||{}).when==='string'" && echo yes || echo no)" "yes"
eq "build caps subagents at 3 (company concurrency limit)" \
  "$(printf '%s' "$DECIDE4" | json_test "Array.isArray(j.rules) && j.rules.some(r=>/at most 3/.test(r) && /subagent/i.test(r))" && echo yes || echo no)" "yes"
eq "build warns subagent helper scripts are not .mjs node scripts" \
  "$(printf '%s' "$DECIDE4" | json_test "Array.isArray(j.rules) && j.rules.some(r=>/scripts\\/task-brief/.test(r) && /scripts\\/review-package/.test(r) && /\\.mjs/.test(r) && /node/.test(r))" && echo yes || echo no)" "yes"
eq "build surfaces implementation skill selection rule" \
  "$(printf '%s' "$DECIDE4" | json_test "Array.isArray(j.rules) && j.rules.some(r=>/subagent/i.test(r))" && echo yes || echo no)" "yes"
eq "build has implement capability" \
  "$(printf '%s' "$DECIDE4" | json_test "j.capabilities.some(c=>c.id==='executing-plans')" && echo yes || echo no)" "yes"
eq "build has subagent implementation capability" \
  "$(printf '%s' "$DECIDE4" | json_test "j.capabilities.some(c=>c.id==='subagent-driven-development') && !j.capabilities.some(c=>c.id==='writing-plans')" && echo yes || echo no)" "yes"
eq "capabilities carry discovered skill descriptions" \
  "$(printf '%s' "$DECIDE4" | json_test "j.capabilities.find(c=>c.id==='executing-plans').description.length > 0" && echo yes || echo no)" "yes"
eq "build does not forbid source writes" \
  "$(printf '%s' "$DECIDE4" | json_get "j.forbid.includes('write-source') ? 'yes' : 'no'")" "no"

DECIDE5="$(run decide implemented --json)"
eq "decide implemented advances to review" \
  "$(printf '%s' "$DECIDE5" | json_get 'j.current')" "review"
eq "review has review capability" \
  "$(printf '%s' "$DECIDE5" | json_test "j.capabilities.some(c=>c.id==='requesting-code-review')" && echo yes || echo no)" "yes"
eq "a state without rules returns empty rules" \
  "$(printf '%s' "$DECIDE5" | json_test "Array.isArray(j.rules) && j.rules.length === 0" && echo yes || echo no)" "yes"
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

# ─── fix workflow: OpenSpec-backed (lean spec) ─────────────────────

echo "# fix workflow: decision-driven (OpenSpec-backed, lean spec)"
T="$(sandbox)"

SF_NEXT="$(run next fix-login-timeout --workflow fix --json)"
eq "fix starts in inspect" \
  "$(printf '%s' "$SF_NEXT" | json_get 'j.current')" "inspect"
eq "fix state is OpenSpec-backed" \
  "$(test -f "$T/openspec/changes/fix-login-timeout/.hikspine.yaml" && echo yes || echo no)" "yes"
eq "fix inspect has debugging + lean openspec capabilities" \
  "$(printf '%s' "$SF_NEXT" | json_test "j.capabilities.some(c=>c.id==='systematic-debugging') && j.capabilities.some(c=>c.id==='openspec-propose')" && echo yes || echo no)" "yes"
eq "fix inspect capabilities carry required tag" \
  "$(printf '%s' "$SF_NEXT" | json_test "j.capabilities.every(c=>c.required===true)" && echo yes || echo no)" "yes"
eq "next carries a capabilityPolicy describing tags" \
  "$(printf '%s' "$SF_NEXT" | json_test "typeof j.capabilityPolicy==='string' && /one-of/.test(j.capabilityPolicy) && /when/.test(j.capabilityPolicy)" && echo yes || echo no)" "yes"
eq "fix inspect needs issue_understood and proposal_ready" \
  "$(printf '%s' "$SF_NEXT" | json_test "j.missing.includes('issue_understood') && j.missing.includes('proposal_ready')" && echo yes || echo no)" "yes"

run decide issue_understood --json > /dev/null
SF_FIX="$(run decide proposal_ready --json)"
eq "inspect decisions advance to fix" \
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
eq "verify pass completes fix" \
  "$(printf '%s' "$SF_DONE" | json_get "j.complete ? 'yes' : 'no'")" "yes"

rm -rf "$T"

# ─── new workflow: brainstorm → openspec → design → build ────────────────

echo "# new workflow: brainstorm -> openspec -> scaffold -> design -> build"
T="$(sandbox)"

NP_NEXT="$(run next my-service --workflow new --json)"
eq "new starts with brainstorming" \
  "$(printf '%s' "$NP_NEXT" | json_get 'j.current')" "brainstorm"
eq "new brainstorm has brainstorming capability" \
  "$(printf '%s' "$NP_NEXT" | json_test "j.capabilities.some(c=>c.id==='brainstorming')" && echo yes || echo no)" "yes"
eq "new brainstorm needs brainstorming_done" \
  "$(printf '%s' "$NP_NEXT" | json_get "j.missing.includes('brainstorming_done') ? 'yes' : 'no'")" "yes"

NP_OPENSPEC="$(run decide brainstorming_done --json)"
eq "brainstorm advances to openspec" \
  "$(printf '%s' "$NP_OPENSPEC" | json_get 'j.current')" "openspec"
eq "openspec has openspec-propose capability" \
  "$(printf '%s' "$NP_OPENSPEC" | json_test "j.capabilities.some(c=>c.id==='openspec-propose')" && echo yes || echo no)" "yes"
eq "openspec needs proposal_ready" \
  "$(printf '%s' "$NP_OPENSPEC" | json_get "j.missing.includes('proposal_ready') ? 'yes' : 'no'")" "yes"

NP_SCAFFOLD="$(run decide proposal_ready --json)"
eq "proposal advances to scaffold (before design)" \
  "$(printf '%s' "$NP_SCAFFOLD" | json_get 'j.current')" "scaffold"
eq "scaffold pulls backend conditionally (when tag)" \
  "$(printf '%s' "$NP_SCAFFOLD" | json_test "j.capabilities.some(c=>c.id==='scaffold-aries-cli'&&typeof c.when==='string')" && echo yes || echo no)" "yes"
eq "scaffold initializes codegraph before design" \
  "$(printf '%s' "$NP_SCAFFOLD" | json_test "Array.isArray(j.rules) && j.rules.some(r=>/codegraph init/.test(r))" && echo yes || echo no)" "yes"
eq "scaffold records build manifest (component id + svn)" \
  "$(printf '%s' "$NP_SCAFFOLD" | json_test "Array.isArray(j.rules) && j.rules.some(r=>/project-build\\.json/.test(r) && /components/.test(r) && /svn/.test(r))" && echo yes || echo no)" "yes"
eq "scaffold needs scaffolded" \
  "$(printf '%s' "$NP_SCAFFOLD" | json_get "j.missing.includes('scaffolded') ? 'yes' : 'no'")" "yes"

NP_DESIGN="$(run decide scaffolded --json)"
eq "scaffolded advances to design" \
  "$(printf '%s' "$NP_DESIGN" | json_get 'j.current')" "design"
eq "design has writing-plans capability" \
  "$(printf '%s' "$NP_DESIGN" | json_test "j.capabilities.some(c=>c.id==='writing-plans')" && echo yes || echo no)" "yes"
eq "new design grounds in scaffolded code via codegraph" \
  "$(printf '%s' "$NP_DESIGN" | json_test "Array.isArray(j.rules) && j.rules.some(r=>/codegraph_explore/.test(r))" && echo yes || echo no)" "yes"
eq "new design uses Superpowers-compatible file handoff" \
  "$(printf '%s' "$NP_DESIGN" | json_test "Array.isArray(j.rules) && j.rules.some(r=>/file handoff only/.test(r)) && j.rules.some(r=>/docs\\/superpowers\\/plans\\/\\{change\\}\\.md/.test(r))" && echo yes || echo no)" "yes"
eq "new design shards multi-spec writing plans" \
  "$(printf '%s' "$NP_DESIGN" | json_test "Array.isArray(j.rules) && j.rules.some(r=>/do not Read proposal\\.md/.test(r)) && j.rules.some(r=>/shard the plan/.test(r)) && j.rules.some(r=>/\\{change\\}-\\{spec-id\\}\\.md/.test(r)) && j.rules.some(r=>/concise manifest/.test(r))" && echo yes || echo no)" "yes"
eq "new design caps planning subagents at 3" \
  "$(printf '%s' "$NP_DESIGN" | json_test "Array.isArray(j.rules) && j.rules.some(r=>/at most 3/.test(r))" && echo yes || echo no)" "yes"
eq "new design asks for tdd_mode" \
  "$(printf '%s' "$NP_DESIGN" | json_get "j.missing.includes('tdd_mode') ? 'yes' : 'no'")" "yes"

run decide design_documented --json > /dev/null
run decide tdd_mode false --json > /dev/null
NP_BUILD="$(run decide design_confirmed --json)"
eq "design confirmation advances directly to build" \
  "$(printf '%s' "$NP_BUILD" | json_get 'j.current')" "build"
eq "build test-driven-development is conditional on tdd_mode (when tag)" \
  "$(printf '%s' "$NP_BUILD" | json_test "typeof (j.capabilities.find(c=>c.id==='test-driven-development')||{}).when==='string'" && echo yes || echo no)" "yes"
eq "build has implement capability" \
  "$(printf '%s' "$NP_BUILD" | json_test "j.capabilities.some(c=>c.id==='executing-plans') && j.capabilities.some(c=>c.id==='subagent-driven-development') && !j.capabilities.some(c=>c.id==='writing-plans')" && echo yes || echo no)" "yes"
eq "build drivers share a one-of group" \
  "$(printf '%s' "$NP_BUILD" | json_test "j.capabilities.filter(c=>c.group==='driver').map(c=>c.id).sort().join(',')==='executing-plans,subagent-driven-development'" && echo yes || echo no)" "yes"
eq "build hui-pro is conditional (when tag)" \
  "$(printf '%s' "$NP_BUILD" | json_test "typeof (j.capabilities.find(c=>c.id==='hui-pro')||{}).when==='string'" && echo yes || echo no)" "yes"
eq "build no longer scaffolds (moved to scaffold stage)" \
  "$(printf '%s' "$NP_BUILD" | json_test "!j.capabilities.some(c=>/^scaffold-/.test(c.id))" && echo yes || echo no)" "yes"
eq "build reads code via codegraph" \
  "$(printf '%s' "$NP_BUILD" | json_test "Array.isArray(j.rules) && j.rules.some(r=>/codegraph_explore/.test(r))" && echo yes || echo no)" "yes"
eq "new build warns subagent helper scripts are not .mjs node scripts" \
  "$(printf '%s' "$NP_BUILD" | json_test "Array.isArray(j.rules) && j.rules.some(r=>/scripts\\/task-brief/.test(r) && /scripts\\/review-package/.test(r) && /\\.mjs/.test(r) && /node/.test(r))" && echo yes || echo no)" "yes"

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

# ─── block-style YAML roundtrip (writeYamlFile output) ─────────────────────
# writeYamlFile emits block sequences ("-\n  id: ..."). Verify that exact shape
# parses and runs, so programmatically-authored workflows work.

echo "# block-style workflow YAML roundtrips"
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
  "$(printf '%s' "$WF_LIST" | json_test "['new','feature','fix'].every(id=>j.workflows.some(w=>w.id===id)) && j.workflows.length === 3" && echo yes || echo no)" "yes"
eq "workflows carry selection intent" \
  "$(printf '%s' "$WF_LIST" | json_test "j.workflows.find(w=>w.id==='fix').intent.length > 0" && echo yes || echo no)" "yes"

mkdir -p "$T/.claude/skills/project-only"
printf '%s\n' '---' 'name: project-only' 'description: Project scoped skill for discovery tests.' '---' > "$T/.claude/skills/project-only/SKILL.md"
SK_LIST="$(run skills --json)"
eq "skills discovers real Claude Code skills by name" \
  "$(printf '%s' "$SK_LIST" | json_test "j.skills.some(s=>s.name==='brainstorming' && s.description.length > 0)" && echo yes || echo no)" "yes"
eq "skills discovers the Hikspine UI launcher skill" \
  "$(printf '%s' "$SK_LIST" | json_test "j.skills.some(s=>s.name==='hikspine-ui' && s.scope==='local')" && echo yes || echo no)" "yes"
eq "skills discovers the Hikspine global UI launcher skill" \
  "$(printf '%s' "$SK_LIST" | json_test "j.skills.some(s=>s.name==='hikspine-global-ui' && s.scope==='local')" && echo yes || echo no)" "yes"
eq "skills discovers project scope skills" \
  "$(printf '%s' "$SK_LIST" | json_test "j.skills.some(s=>s.name==='project-only' && s.scope==='project')" && echo yes || echo no)" "yes"

# Two concurrent changes on different workflows coexist
run next bug-1 --workflow fix --json > /dev/null
run next feat-x --workflow feature --json > /dev/null
mkdir -p "$T/.hikspine/artifacts/bug-1"
printf '%s\n' '# Verify' '' 'Focused verification artifact.' > "$T/.hikspine/artifacts/bug-1/verify.md"
mkdir -p "$T/openspec/changes/feat-x/specs/auth"
printf '%s\n' '# Proposal' '' 'Feature proposal artifact.' > "$T/openspec/changes/feat-x/proposal.md"
printf '%s\n' '# Auth spec' '' 'Spec artifact.' > "$T/openspec/changes/feat-x/specs/auth/spec.md"
mkdir -p "$T/openspec/changes/archive/2026-06-30-archived-x/specs/payments"
cat > "$T/openspec/changes/archive/2026-06-30-archived-x/.hikspine.yaml" <<'YAML'
version: 1
change: archived-x
workflow: feature
current: archive
decisions:
  requirements_clarified: true
  proposal_ready: true
  design_documented: true
  design_confirmed: true
  implemented: true
  review_result: pass
  verify_result: pass
  archived: true
history:
  -
    at: 2026-06-30T00:00:00.000Z
    type: started
    workflow: feature
    state: open
  -
    at: 2026-06-30T00:10:00.000Z
    type: complete
    state: archive
YAML
printf '%s\n' '# Archived Proposal' '' 'Archived feature proposal.' > "$T/openspec/changes/archive/2026-06-30-archived-x/proposal.md"
printf '%s\n' '# Archived Spec' '' 'Archived spec artifact.' > "$T/openspec/changes/archive/2026-06-30-archived-x/specs/payments/spec.md"
CH_LIST="$(run changes --json)"
eq "changes lists all in-flight runs" \
  "$(printf '%s' "$CH_LIST" | json_test "j.changes.length === 3 && j.changes.some(c=>c.change==='bug-1'&&c.workflow==='fix') && j.changes.some(c=>c.change==='feat-x'&&c.workflow==='feature') && j.changes.some(c=>c.change==='archived-x'&&c.workflow==='feature'&&c.archived)" && echo yes || echo no)" "yes"
eq "changes report nextAction per run" \
  "$(printf '%s' "$CH_LIST" | json_test "j.changes.every(c=>typeof c.nextAction==='string')" && echo yes || echo no)" "yes"
eq "changes mark the active run" \
  "$(printf '%s' "$CH_LIST" | json_get 'j.active')" "feat-x"

mkdir -p "$T/.hikspine"
cat > "$T/.hikspine/notifications.json" <<'JSON'
[
  {"at":"2026-06-30T00:20:00.000Z","type":"idle_prompt","message":"Need your confirmation","session":"s1"},
  {"id":"done-1","at":"2026-06-30T00:05:00.000Z","type":"permission_prompt","message":"Allow edit?","session":"s1","handledAt":"2026-06-30T00:06:00.000Z"}
]
JSON

# board aggregates everything the web UI serves at /api/state
BOARD="$(run board --json)"
eq "board aggregates changes, workflows, and skills" \
  "$(printf '%s' "$BOARD" | json_test "Array.isArray(j.changes) && j.workflows.length === 3 && j.skills.length > 0 && j.changes.length === 3" && echo yes || echo no)" "yes"
eq "board marks the active change" \
  "$(printf '%s' "$BOARD" | json_get 'j.active')" "feat-x"
eq "board changes carry history and decisions" \
  "$(printf '%s' "$BOARD" | json_test "j.changes.every(c=>Array.isArray(c.history) && c.history.length>=1 && c.history[0].type==='started' && typeof c.decisions==='object' && c.startedAt)" && echo yes || echo no)" "yes"
eq "board exposes normalized notifications" \
  "$(printf '%s' "$BOARD" | json_test "Array.isArray(j.notifications) && j.notifications.length === 2 && j.notifications.every(n=>n.id && typeof n.handled==='boolean') && j.notifications.some(n=>n.type==='idle_prompt' && !n.handled) && j.notifications.some(n=>n.id==='done-1' && n.handled)" && echo yes || echo no)" "yes"
eq "board exposes workflow stage details" \
  "$(printf '%s' "$BOARD" | json_test "j.workflows.every(w=>Array.isArray(w.stages) && w.stages.length>0 && w.stages.every(s=>Array.isArray(s.capabilities)))" && echo yes || echo no)" "yes"
eq "board exposes stage durations and markdown artifacts" \
  "$(printf '%s' "$BOARD" | json_test "j.changes.every(c=>typeof c.stageDurations==='object' && Array.isArray(c.artifacts)) && j.changes.find(c=>c.change==='feat-x').artifacts.some(a=>a.path.endsWith('proposal.md') && a.stage==='open')" && echo yes || echo no)" "yes"
eq "board annotates artifact types" \
  "$(printf '%s' "$BOARD" | json_test "j.changes.find(c=>c.change==='feat-x').artifacts.some(a=>a.path.endsWith('proposal.md') && a.type==='proposal') && j.changes.find(c=>c.change==='feat-x').artifacts.some(a=>a.path.endsWith('/specs/auth/spec.md') && a.type==='spec') && j.changes.find(c=>c.change==='bug-1').artifacts.some(a=>a.path.endsWith('verify.md') && a.type==='verification')" && echo yes || echo no)" "yes"
eq "board discovers standalone Hikspine markdown artifacts" \
  "$(printf '%s' "$BOARD" | json_test "j.changes.find(c=>c.change==='bug-1').artifacts.some(a=>a.path.endsWith('.hikspine/artifacts/bug-1/verify.md') && a.stage==='verify')" && echo yes || echo no)" "yes"
eq "board keeps archived OpenSpec changes visible" \
  "$(printf '%s' "$BOARD" | json_test "j.changes.some(c=>c.change==='archived-x' && c.archived && c.complete && /openspec\\/changes\\/archive\\/2026-06-30-archived-x/.test(c.archivePath) && c.artifacts.some(a=>a.path.endsWith('archive/2026-06-30-archived-x/proposal.md') && a.type==='proposal'))" && echo yes || echo no)" "yes"
ALL_BOARD="$(cd "$REPO" && "$NODE_BIN" "$ENGINE_RUN" board --all --json)"
eq "all-project board lists registered projects" \
  "$(printf '%s' "$ALL_BOARD" | json_test "j.mode==='all' && Array.isArray(j.projects) && j.projects.some(p=>p.counts && p.counts.total>=3)" && echo yes || echo no)" "yes"
eq "all-project board carries project metadata on changes" \
  "$(printf '%s' "$ALL_BOARD" | json_test "j.changes.some(c=>c.change==='bug-1' && c.projectId && c.projectRoot && c.artifacts.every(a=>a.projectId===c.projectId))" && echo yes || echo no)" "yes"

rm -rf "$T"

# ─── edge cases ────────────────────────────────────────────────────────────

echo "# edge cases"
T="$(sandbox)"

# Multiple changes without active: next requires explicit change name
run next change-a --workflow fix --json > /dev/null
run next change-b --workflow fix --json > /dev/null
# Clear active to force "no active change" scenario
rm -f "$T/.hikspine/active"
NO_ACTIVE="$(run next --json 2>&1 || true)"
has "next without active or change arg reports error" "$NO_ACTIVE" "No active change"

# Invalid change name
run next change-c --workflow fix --json > /dev/null  # create one more so resolveChange doesn't pick single
INVALID="$(run next 'bad/name' --workflow feature --json 2>&1 || true)"
has "invalid change name rejected" "$INVALID" "Invalid change name"

run next same-name --workflow feature --json > /dev/null
SAME_AS_FIX="$(run next same-name --workflow fix --json 2>&1 || true)"
has "same change cannot be reused with another workflow" "$SAME_AS_FIX" "already uses workflow 'feature'"

rm -rf "$T"
T="$(sandbox)"
mkdir -p "$T/openspec/changes/collision" "$T/.hikspine/changes"
printf 'change: collision\nworkflow: feature\ncurrent: open\n' > "$T/openspec/changes/collision/.hikspine.yaml"
printf 'change: collision\nworkflow: fix\ncurrent: inspect\n' > "$T/.hikspine/changes/collision.yaml"
COLLISION="$(run next collision --json 2>&1 || true)"
has "same change in both storage locations is rejected" "$COLLISION" "exists in multiple Hikspine storage locations"

rm -rf "$T"

# ─── summary ───────────────────────────────────────────────────────────────

echo ""
echo "RESULT: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
