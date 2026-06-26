#!/usr/bin/env bash
# Tests for the PreToolUse phase write-guard hook.
# Run: bash test/hook-guard.test.sh
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd -P)"
STATE="$REPO/skills/hikspine/scripts/hikspine-state.sh"
HOOK="$REPO/skills/hikspine/scripts/hikspine-hook-guard.sh"

command -v node >/dev/null 2>&1 || { echo "ERROR: node not found on PATH (required to run hikspine). Install Node.js 20.19.0+." >&2; exit 1; }
command -v git  >/dev/null 2>&1 || { echo "ERROR: git not found on PATH." >&2; exit 1; }
GIT="git -c user.name=hikspine-test -c user.email=test@hikspine.local"

pass=0; fail=0
# expect <want-exit> <desc> <file_path>   (run inside sandbox cwd $T)
expect() {
  local want="$1" desc="$2" fp="$3" got
  set +e
  printf '{"tool_name":"Write","tool_input":{"file_path":"%s"}}' "$fp" \
    | ( cd "$T" && bash "$HOOK" ) >/dev/null 2>&1
  got=$?
  set -e
  if [ "$got" = "$want" ]; then pass=$((pass+1)); printf '  ok   - %s (exit %s)\n' "$desc" "$got"
  else fail=$((fail+1)); printf '  FAIL - %s (want %s, got %s)\n' "$desc" "$want" "$got"; fi
}

T=$(mktemp -d); ( cd "$T"; git init -q; $GIT commit -q --allow-empty -m i ); mkdir -p "$T/openspec/changes"
run(){ ( cd "$T" && bash "$STATE" "$@" ); }
run init c feature >/dev/null

echo "# phase=design (feature first phase, brainstorm-first)"
expect 2 "block src write in design"         "src/foo.ts"
expect 0 "allow proposal.md in design"       "openspec/changes/c/proposal.md"
expect 0 "allow tasks.md in design"          "openspec/changes/c/tasks.md"
expect 0 "allow Design Doc under docs/superpowers" "docs/superpowers/specs/d.md"
expect 0 "allow root README.md"              "README.md"

echo "# feature build without design_doc (illegal jump)"
( cd "$T" && HIKSPINE_FORCE_PHASE=1 bash "$STATE" set c phase build >/dev/null 2>&1 )
expect 2 "block src write: feature build, design_doc null" "src/foo.ts"

echo "# build with design_doc set"
( cd "$T" && mkdir -p docs && printf d>docs/d.md )
run set c design_doc docs/d.md >/dev/null 2>&1
expect 0 "allow src write in build (design_doc set)" "src/foo.ts"
expect 0 "allow tasks.md in build"                   "openspec/changes/c/tasks.md"

echo "# archive"
( cd "$T" && HIKSPINE_FORCE_PHASE=1 bash "$STATE" set c phase archive >/dev/null 2>&1 )
expect 2 "block src write in archive" "src/foo.ts"
expect 0 "allow .hikspine.yaml in archive" "openspec/changes/c/.hikspine.yaml"

echo "# no active change"
T2=$(mktemp -d); ( cd "$T2"; git init -q ); OLD=$T; T=$T2
expect 0 "allow any write when no change" "src/foo.ts"
T=$OLD; rm -rf "$T2"

rm -rf "$T"
echo ""
echo "RESULT: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
