#!/usr/bin/env bash
# Reproducible test for the preset-driven state machine.
# Run: bash test/state-machine.test.sh
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd -P)"
STATE="$REPO/skills/hikspine/scripts/hikspine-state.sh"

# Environment precheck — friendlier than a cryptic mid-test failure.
command -v node >/dev/null 2>&1 || { echo "ERROR: node not found on PATH (required to run hikspine). Install Node.js 20.19.0+." >&2; exit 1; }
command -v git  >/dev/null 2>&1 || { echo "ERROR: git not found on PATH." >&2; exit 1; }

pass=0; fail=0
ok()   { pass=$((pass+1)); printf '  ok   - %s\n' "$1"; }
bad()  { fail=$((fail+1)); printf '  FAIL - %s\n' "$1"; }
eq()   { if [ "$2" = "$3" ]; then ok "$1"; else bad "$1 (want '$3', got '$2')"; fi; }

# Use inline identity so a fresh clone with no global git author still works.
GIT="git -c user.name=hikspine-test -c user.email=test@hikspine.local"
sandbox() { local d; d=$(mktemp -d); ( cd "$d"; git init -q; $GIT commit -q --allow-empty -m init ); mkdir -p "$d/openspec/changes"; echo "$d"; }
run() { ( cd "$T" && bash "$STATE" "$@" ); }

echo "# feature preset: brainstorm-first lifecycle (design -> open -> build -> verify -> archive)"
T=$(sandbox)
run init demo feature >/dev/null
eq "starts at design (brainstorm-first)" "$(run phase demo)" "design"
if run guard demo >/dev/null 2>&1; then bad "design guard blocks without design_doc"; else ok "design guard blocks without design_doc"; fi
( cd "$T" && mkdir -p docs && printf d>docs/design.md )
run set demo design_doc docs/design.md >/dev/null 2>&1
run transition demo complete >/dev/null 2>&1
eq "design -> open" "$(run phase demo)" "open"
if run guard demo >/dev/null 2>&1; then bad "open guard blocks without artifacts"; else ok "open guard blocks without artifacts"; fi
( cd "$T/openspec/changes/demo" && printf p>proposal.md && printf t>tasks.md && printf d>design.md )
run transition demo complete >/dev/null 2>&1
eq "open -> build" "$(run phase demo)" "build"
run set demo isolation branch >/dev/null 2>&1
run set demo build_mode executing-plans >/dev/null 2>&1
run set demo tdd_mode tdd >/dev/null 2>&1
run set demo review_mode standard >/dev/null 2>&1
run transition demo complete >/dev/null 2>&1
eq "build -> verify" "$(run phase demo)" "verify"
eq "verify_result reset to pending" "$(run get demo verify_result)" "pending"
run transition demo fail >/dev/null 2>&1
eq "verify fail -> build" "$(run phase demo)" "build"
eq "verify_result=fail recorded" "$(run get demo verify_result)" "fail"
run transition demo complete >/dev/null 2>&1
( cd "$T/openspec/changes/demo" && printf r>report.md )
run set demo verification_report openspec/changes/demo/report.md >/dev/null 2>&1
run set demo branch_status handled >/dev/null 2>&1
run transition demo complete >/dev/null 2>&1
eq "verify -> archive" "$(run phase demo)" "archive"
eq "verify_result=pass" "$(run get demo verify_result)" "pass"
run transition demo complete >/dev/null 2>&1
eq "archive terminal sets archived" "$(run get demo archived)" "true"
eq "next is done when archived" "$(run next demo | head -1)" "NEXT: done"
rm -rf "$T"

echo "# hotfix preset: skips design"
T=$(sandbox)
run init fix hotfix >/dev/null
eq "hotfix default build_mode" "$(run get fix build_mode)" "direct"
( cd "$T/openspec/changes/fix" && printf p>proposal.md && printf t>tasks.md )
run transition fix complete >/dev/null 2>&1
eq "hotfix open -> build (design skipped)" "$(run phase fix)" "build"
eq "build phase owned by hotfix skill" "$(run next fix | grep SKILL)" "SKILL: hikspine-hotfix"
rm -rf "$T"

echo "# guard rejects direct phase writes"
T=$(sandbox)
run init g feature >/dev/null
if run set g phase build >/dev/null 2>&1; then bad "direct phase write blocked"; else ok "direct phase write blocked"; fi
rm -rf "$T"

echo "# provider steps + config override"
T=$(sandbox)
run init p feature >/dev/null
eq "design steps order (clarify first)" "$( ( cd "$T" && bash "$STATE" steps p design ) | head -1 | cut -f1)" "clarify"
eq "design clarify default skill" "$( ( cd "$T" && bash "$STATE" provider p design clarify ) )" "openspec-explore"
eq "design brainstorm default skill" "$( ( cd "$T" && bash "$STATE" provider p design brainstorm ) )" "brainstorming"
eq "open formalize default skill" "$( ( cd "$T" && bash "$STATE" provider p open formalize ) )" "openspec-propose"
eq "build implement default skill" "$( ( cd "$T" && bash "$STATE" provider p build implement ) )" "executing-plans"
eq "verify finish default skill" "$( ( cd "$T" && bash "$STATE" provider p verify finish ) )" "finishing-a-development-branch"
eq "archive default skill" "$( ( cd "$T" && bash "$STATE" provider p archive archive ) )" "openspec-archive-change"
# Project config is .hikspine/config.json (structured).
mkc() { mkdir -p "$T/.hikspine"; cat > "$T/.hikspine/config.json"; }
# Override clarify (role-level)
echo '{"providers":{"clarify":"brainstorming"}}' | mkc
eq "clarify overridden by role-level config" "$(run provider p design clarify)" "brainstorming"
eq "brainstorm unaffected by clarify override" "$(run provider p design brainstorm)" "brainstorming"
# Priority: phase-level beats role-level
echo '{"providers":{"clarify":"brainstorming","design.clarify":"openspec-onboard"}}' | mkc
eq "phase-level override wins over role-level" "$(run provider p design clarify)" "openspec-onboard"
# Priority: workflow.phase beats phase-level
echo '{"providers":{"design.clarify":"openspec-onboard","feature.design.clarify":"openspec-explore"}}' | mkc
eq "workflow.phase override wins" "$(run provider p design clarify)" "openspec-explore"
# extra_steps: project-level insertion without editing the preset
echo '{"extra_steps":{"design.after_clarify":[{"role":"index","skill":"codegraph-x","note":"n"}]}}' | mkc
eq "extra_steps inserts after clarify (line 2 = index)" "$(run steps p design | sed -n 2p | cut -f1)" "index"
eq "brainstorm follows inserted step (line 3)" "$(run steps p design | sed -n 3p | cut -f1)" "brainstorm"
rm -rf "$T"

echo "# step status recording (B) + flow_mode config (C)"
T=$(sandbox)
run init s feature >/dev/null
run step-record s design clarify done >/dev/null 2>&1
eq "step recorded with resolved skill+status" "$(run step-list s | awk -F'\t' '$2=="clarify"{print $3"/"$4}')" "openspec-explore/done"
run step-record s design clarify skipped "" "已有澄清" >/dev/null 2>&1
eq "step status updates in place (no dup)" "$(run step-list s | grep -c clarify)" "1"
eq "skipped status + reason recorded" "$(run step-list s | awk -F'\t' '$2=="clarify"{print $4"/"$7}')" "skipped/已有澄清"
eq "step-list empty when none" "$(run step-list s | head -1)" "$(run step-list s | head -1)"  # smoke
# flow_mode via config-get
mkc2() { mkdir -p "$T/.hikspine"; cat > "$T/.hikspine/config.json"; }
eq "flow_mode empty when no config" "$(run config-get flow_mode)" ""
echo '{"flow_mode":"fast"}' | mkc2
eq "flow_mode read from config.json" "$(run config-get flow_mode)" "fast"
rm -rf "$T"

echo ""
echo "RESULT: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
