# hikspine

Skill-first workflow kernel for Claude Code.

Chinese docs: [README.zh-CN.md](README.zh-CN.md)

Hikspine keeps AI coding work on rails by making the current phase, workflow node, expected skills, and machine-checkable exit checks explicit. It is packaged as a Claude Code plugin, but the user-facing entry is a **skill**, not a slash-command file.

## Current Shape

```text
skills/hikspine/SKILL.md
  User-facing entry. Trigger it with text such as "/hs ..." or "use hikspine ...".

bin/hikspine.mjs
  Thin public CLI. Agent loop is `next` + `decide`; `skills`, `workflows`, and
  `changes` are read-only listings for routing and tooling.

lib/store.mjs
  Config, workflow loading, state file placement, and active change handling.

lib/checks.mjs
  Machine-checkable exit checks and guard decisions.

lib/transitions.mjs
  Automatic node/phase advancement.

lib/skills.mjs
  Skill discovery. Resolves a workflow's `capabilities` (real Claude Code skill
  names) by scanning the same filesystem locations Claude Code reads. No registry.

lib/rules.mjs
  Idempotent distribution of plugin-authored Markdown rules into project `.claude/rules`.

builtin/workflows/
  Builtin workflow recipes: feature, simple-fix, hotfix, new-project.

rules/
  Plugin-authored project rules that are copied into `.claude/rules`.

hooks/guard.mjs
  Claude Code PreToolUse bridge. Calls the guard logic directly.
```

There are no Claude command files. Treat `/hs` as a natural-language convention that triggers the `hikspine` skill.

## Install

Install this repository as a Claude Code plugin through your team's plugin marketplace or local plugin source.

OpenSpec still needs its CLI on PATH if your workflow uses OpenSpec-backed artifacts.

There is no project init step. On the first `hikspine next` call in a project, Hikspine creates `.claude/rules` and copies Markdown rules from the plugin `rules/` directory. Managed files are updated when the plugin copy changes, but locally edited project rules are not overwritten.

Claude Code loads unscoped `.claude/rules` at session startup, so rules created after the current session has started should be read explicitly. `next --json` returns `projectRules.readNow` when it copies or updates rule files; the `hikspine` skill instructs the Agent to read those paths immediately.

## How Users Work With It

A user can start directly in Claude Code:

```text
/hs start entrance-monitor with workflow <workflow-id>
```

Claude should load the `hikspine` skill, source the runtime locator, then run:

```bash
_hs_norm_root() { local r="${1:-}"; r="${r//\\//}"; while [ "${#r}" -gt 1 ] && [ "${r%/}" != "$r" ]; do r="${r%/}"; done; printf '%s\n' "$r"; }
_hs_env_file=""
for r in "${HIKSPINE_PLUGIN_ROOT:-}" "${CLAUDE_PLUGIN_ROOT:-}" "$(pwd)" "$(git rev-parse --show-toplevel 2>/dev/null || true)"; do
  r="$(_hs_norm_root "$r")"
  if [ -n "$r" ] && [ -f "$r/skills/hikspine/scripts/hikspine-env.sh" ]; then
    _hs_env_file="$r/skills/hikspine/scripts/hikspine-env.sh"
    break
  fi
done
if [ -z "$_hs_env_file" ]; then
  for b in "${HOME:-}" "${USERPROFILE:-}" "${APPDATA:-}" "${LOCALAPPDATA:-}" "/mnt/c/Users" "/mnt/d" "/mnt/e"; do
    [ -n "$b" ] || continue
    f="$(find "$b" -maxdepth 10 -path '*/skills/hikspine/scripts/hikspine-env.sh' -print -quit 2>/dev/null || true)"
    if [ -n "$f" ]; then _hs_env_file="$f"; break; fi
  done
fi
[ -n "$_hs_env_file" ] || { echo "ERROR: cannot locate hikspine-env.sh; set HIKSPINE_PLUGIN_ROOT to the hikspine plugin root." >&2; exit 1; }
. "$_hs_env_file" || exit 1
unset _hs_env_file f r b
unset -f _hs_norm_root
node "$HIKSPINE_ENGINE" next entrance-monitor --workflow <workflow-id> --json
```

No project init is required. If the state does not exist, `next <change> --workflow <id>` creates it lazily.
Run the locator and `next` in the same Bash invocation; exported variables do not persist across separate tool calls.

The same `next` call also ensures project rules exist at `.claude/rules`.
If rule files were copied or updated during this call, the JSON response includes `projectRules.readNow`.

## The `next` Protocol

`next` is the main loop:

```text
Agent calls next
Engine observes files/directories/checks
Engine auto-advances completed nodes
Engine returns the next blocked node
Agent uses the relevant skills and produces artifacts
Agent calls next again
```

The engine no longer asks Agent to write facts such as `no_open_questions=true` or to call `complete/advance`. Flow only advances when machine-checkable `exit.checks` pass.

## Builtin Workflows

- `feature`: `open -> design -> build -> review -> verify -> archive`
- `simple-fix`: `inspect -> fix -> verify`
- `hotfix`: `inspect -> patch -> verify`
- `new-project`: `open -> design -> scaffold -> build -> review -> verify`

Each workflow declares an `intent` (a one-line "when to use this flow") so the
agent can route a request; see `hikspine workflows --json`.

Custom workflows are first-class. Put a workflow at:

```text
.hikspine/workflows/<workflow-id>.yaml
```

Then run:

```bash
node "$HIKSPINE_ENGINE" next <change> --workflow <workflow-id> --json
```

Or set a project default:

```yaml
# .hikspine/config.yaml
version: 1
defaultWorkflow: <workflow-id>
```

`feature` and `new-project` are OpenSpec-backed by default and store state at:

```text
openspec/changes/<change>/.hikspine.yaml
```

`simple-fix` and `hotfix` are lightweight by default and store state at:

```text
.hikspine/changes/<change>.yaml
```

## Workflow v2

Workflow recipes separate Agent guidance from engine gates:

```yaml
inputs:
  required:
    - key: proposal
      path: openspec/changes/{change}/proposal.md
      useBefore: [brainstorming]
    - key: tasks
      path: openspec/changes/{change}/tasks.md
      useBefore: [brainstorming]
    - key: specs
      path: openspec/changes/{change}/specs
      useBefore: [brainstorming]
skills:
  required: [brainstorming]
  recommended: []
  output: [openspec-verify-change]
agent:
  rules:
    - Read proposal.md, tasks.md, and specs/ before running brainstorming.
    - Run brainstorming before selecting a design direction; derive questions, options, and tradeoffs from the required inputs.
    - Stop for user confirmation after brainstorming before moving to build.
outputs:
  - key: design_doc
    path: openspec/changes/{change}/design.md
exit:
  checks:
    - file.exists: openspec/changes/{change}/design.md
    - file.contains_headings: { path: openspec/changes/{change}/design.md, headings: [Inputs Reviewed, Brainstorming, Questions From OpenSpec, Options Considered, Tradeoffs, Selected Direction, Company Constraints, Open Questions, User Confirmation] }
    - file.contains_regex: { path: openspec/changes/{change}/design.md, pattern: "^Confirmed by user:\\s*.+" }
    - file.contains: { path: openspec/changes/{change}/design.md, text: openspec/changes/{change}/proposal.md }
    - file.contains: { path: openspec/changes/{change}/design.md, text: openspec/changes/{change}/tasks.md }
    - file.contains: { path: openspec/changes/{change}/design.md, text: openspec/changes/{change}/specs }
```

`inputs.required` tells Agent what context must be read before a skill runs. `skills.required` tells Agent what must be used. If Claude Code does not expose a skill invocation trace, the engine does not pretend it can verify that call. The hard gate is the observable artifact contract in `exit.checks`.

For builtin `feature` and `new-project`, design is split into `design.brainstorm` and `design.confirm`. The first node returns `nextSkill: brainstorming`; the second node requires Agent to stop and ask the user to confirm or change the selected direction. The confirmation node includes `agent.requiredQuestions` for topics such as technology stack and integration choices. Build remains blocked until `design.md` contains `User Decisions`, `User Confirmation`, and concrete records such as `Technology stack:` and `Confirmed by user:`.

Use the same convention for later phases instead of adding engine-specific fallbacks. For example, a build node should declare `design.md` as an input for planning, then put step-level checks on the planning step so implementation cannot start before the plan artifact exists. If a later phase depends on an earlier phase's contract, repeat the relevant artifact checks in the later phase's YAML; this keeps resume/upgrade behavior explicit without hardcoding phase-specific logic in the engine.

## Supported Checks

Current checks include:

- `file.exists`
- `dir.exists`
- `artifact.exists`
- `file.contains`
- `file.contains_regex`
- `file.contains_heading`
- `file.contains_headings`
- `git.has_changes`
- `git.has_source_changes`
- `always.false`

## Project Customization

Optional project config:

```yaml
# .hikspine/config.yaml
version: 1
defaultWorkflow: <workflow-id>
guard:
  sourceRoots:
    - src/
    - app/
```

A workflow's `capabilities` are real Claude Code skill names, resolved by
filesystem discovery — there is no registry to configure. To make a skill usable
in a state, install it where Claude Code looks (project `.claude/skills`, personal
`~/.claude/skills`, or a plugin marketplace) and add its `name` to that state's
`capabilities`. Run `hikspine skills --json` to see what is discoverable here.

## CLI Commands

Beyond the `next` + `decide` agent loop, three read-only listings support routing
and tooling:

```bash
hikspine skills [--json]     # every Claude Code skill discoverable here (valid capability names)
hikspine workflows [--json]  # available workflows (builtin + project) with their selection intent
hikspine changes [--json]    # every in-flight change with its workflow, current state, and next step
```

- `skills` scans the same sources Claude Code reads (project `.claude/skills`,
  personal `~/.claude/skills`, plugin marketplaces under
  `~/.claude/plugins/marketplaces/**/skills`, and the plugin's own `skills/`),
  deduping by skill `name` so project skills win. This is both the data source
  for picking capabilities and the set of valid capability names.
- `workflows` lists each workflow's `intent` ("when to use this flow"), so the
  agent can route a request to the right workflow. Project workflows override
  builtins by id.
- `changes` is a read-only registry of concurrent runs; it never auto-advances or
  mutates any change.

## Verification

```bash
npm test
```
