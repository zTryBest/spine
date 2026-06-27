---
name: hikspine
description: "Use when the user says /hs, hikspine, or asks to run a phased AI coding workflow. Hikspine is a Claude Code skill workflow kernel: it decides the current phase/node, tells Claude which skills to use, checks observable artifacts, and advances the workflow through a plugin-level runtime."
---

# Hikspine

Hikspine is a workflow kernel for Claude Code. It keeps AI coding work from drifting by making the current phase, node, expected skills, and machine-checkable exit checks explicit.

Hikspine is not a slash command package. Treat `/hs ...` in user text as a natural-language trigger for this skill.

## Runtime

Source the runtime locator before calling the engine:

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
```

Do not assemble paths from `CLAUDE_PLUGIN_ROOT` by hand. It may be empty, may have a trailing slash, and may be a Windows path inside Git Bash or WSL.
Source the runtime and call `node "$HIKSPINE_ENGINE" ...` in the same Bash tool invocation; environment variables do not persist across separate Bash calls.

## Main Protocol

Use `next` as the only workflow loop command:

```bash
node "$HIKSPINE_ENGINE" next <change-name> --workflow <workflow-id> --json
node "$HIKSPINE_ENGINE" next <change-name> --json
```

`next` observes current artifacts, advances any completed nodes automatically, and returns the next blocked node. There is no project init step and no manual `fact`, `artifact`, `complete`, or `advance` protocol.

The first `next` call in a project also ensures `.claude/rules` exists and copies Markdown rules from the plugin `rules/` directory. Managed rules update when the plugin copy changes; locally edited project rules are not overwritten.

Claude Code loads unscoped `.claude/rules` at session startup, so rules created after the session has already started may not be in context automatically. If `next --json` returns `projectRules.readNow`, immediately read those files before acting on the returned workflow node.

Workflow selection:

- If the user names a workflow, pass that id to `--workflow`.
- If the project has `.hikspine/config.yaml` with `defaultWorkflow`, omit `--workflow` and let the engine use it.
- If the project defines `.hikspine/workflows/<id>.yaml`, use `<id>` exactly; do not edit this skill for new workflows.
- Builtin examples include `feature`, `simple-fix`, `hotfix`, and `new-project`.

Only infer a builtin workflow when the user does not name one and the project has no default.

## How To Act On `next`

Read the JSON fields:

- `phase`, `node`, `objective`: where the workflow is blocked.
- `nextSkill`: the next direct skill for `skill` or `skill-sequence` nodes.
- `requiredInputs`: files or directories that must be read before running listed skills.
- `requiredSkills`: skills the workflow expects before this node is considered properly executed.
- `recommendedSkills`: skills to consult when relevant; these are guidance, not hard gates.
- `outputSkills`: skills expected to write or update workflow artifacts.
- `outputs`: files or directories the node expects.
- `missing`: machine-checkable exit checks that are still failing.
- `projectRules.readNow`: project rule files synced during this `next` call; read them immediately so they affect this session.
- `agent.rules`: natural-language execution rules for the current node.

First read every `requiredInputs` item, especially entries whose `useBefore` names the skill you are about to run. Then do the work with the relevant skills and produce the expected artifacts. Call `next` again; the engine will inspect the artifacts and move forward if the checks pass.

## Language Rule

Detect the language of the user's current workflow request. Use that language for user-facing explanations, clarification questions, summaries, and generated workflow artifacts unless the user explicitly asks for another language or an existing project artifact clearly establishes a different language. If the user switches language later, follow the newest explicit user language. Keep code identifiers, commands, file paths, API names, and quoted source text unchanged.

## Feature Design Rule

For `feature` design, read the OpenSpec open-phase artifacts before running brainstorming:

```text
openspec/changes/<change>/proposal.md
openspec/changes/<change>/tasks.md
openspec/changes/<change>/specs
```

Then run brainstorming from those inputs before selecting the design direction, and write the questions, options, tradeoffs, and conclusions back into OpenSpec design.md through the OpenSpec design/propose skill.

The engine does not judge whether the design is "good" and does not trust self-reported semantic done flags. It checks that this file exists:

```text
openspec/changes/<change>/design.md
```

and that it contains these headings:

```text
## Inputs Reviewed
## Brainstorming
## Questions From OpenSpec
## Options Considered
## Tradeoffs
## Selected Direction
## Company Constraints
## Open Questions
```

`Inputs Reviewed` must reference the proposal, tasks, and specs paths so the engine can verify that brainstorming was grounded in the open-phase artifacts.

Use `company.knowledge` before making claims about company frameworks, components, platforms, middleware, permissions, monitoring, release, or historical systems. Use `company.platform-design` when platform or scaffold decisions are material.

## State Files

OpenSpec-backed workflows store state at:

```text
openspec/changes/<change>/.hikspine.yaml
```

Lightweight workflows store state at:

```text
.hikspine/changes/<change>.yaml
```

Do not manually edit `current.phase`, `current.node`, or node status.

## Guardrails

- Do not write source files while the current phase forbids `write-source`.
- OpenSpec artifacts and `.hikspine` state files are allowed during open/design phases.
- If `next` remains on the same node, read `missing` and produce the missing artifacts or sections.
- Company skills do not need Hikspine-specific metadata; workflow recipes decide when to recommend them.

## Debugging

Prefer `next`. For debugging, inspect the state file directly instead of asking Agent to mutate workflow state.
