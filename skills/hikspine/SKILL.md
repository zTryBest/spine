---
name: hikspine
description: "Use when the user says /hs, hikspine, or asks to run a phased AI coding workflow. Hikspine is a Claude Code workflow kernel: next shows the current state's missing decisions and composable skills, decide records a decision, and the engine advances the decision-driven state machine."
---

# Hikspine

Hikspine keeps AI coding work on rails by making the current state, composable skills, and the decisions needed to leave that state explicit. Drive it with the `next` / `decide` protocol below. Engine design rationale lives in `docs/architecture.md`; this file is only how to drive it.

Treat `/hs ...` as a natural-language trigger for this skill, not a slash-command file.

## Load The Runtime

The Bash tool starts a fresh shell each call. Locate the runtime and run `node "$HIKSPINE_ENGINE" ...` in the **same** Bash invocation; exported variables do not persist across calls.

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

Start or resume a change:

```bash
node "$HIKSPINE_ENGINE" next <change> --workflow <workflow-id> --json   # new change: name the workflow
node "$HIKSPINE_ENGINE" next <change> --json                            # existing change: omit --workflow
```

Use the workflow id the user or project names. If `.hikspine/config.yaml` sets `defaultWorkflow`, omit `--workflow` for new changes.

## Choosing A Workflow

If the user did not name a workflow and the project has no `defaultWorkflow`, pick one yourself:

```bash
node "$HIKSPINE_ENGINE" workflows --json
```

Each workflow declares an `intent` describing when it applies. Match the request and the current project state against those intents — e.g. a bug or small lightweight change (including an urgent production fix) fits `fix`, a new requirement in an existing codebase fits `feature`, an empty repo (0 to 1) fits `new`. Weigh real signals: blast radius, whether a design is needed, whether code already exists (`git` status, file layout). If two workflows fit comparably, ask the user with `AskQuestion` instead of guessing. Then start the change with the chosen `--workflow`.

Several changes can be in flight at once, each on its own workflow. List them with:

```bash
node "$HIKSPINE_ENGINE" changes --json
```

`changes` shows every run with its workflow, current state, and `nextAction`. Use it to resume or switch between concurrent changes; `next <change>` / `decide --change <change>` target a specific one. For a browser status view that shows every run's pipeline progress, start the local board: `node "$HIKSPINE_ENGINE" ui` (default `http://127.0.0.1:4319`).

## The Loop: next → work → decide → next

There are exactly two verbs:

```bash
node "$HIKSPINE_ENGINE" next [change] [--json]
node "$HIKSPINE_ENGINE" decide <key> [value] [--change <change>] [--json]   # value defaults to true; pass pass/fail
```

```text
Call next        → see this state's missing decisions and composable skills
Do the work with those skills and produce artifacts
For each satisfied need, call decide → engine advances or rolls back, returns the next state
Continue until complete: true
```

**The only thing that advances the workflow is `decide`.** `next` reads decisions, not files; calling `next` alone never moves forward. After finishing a state's work, record every decision in its `needs`. **Do not stop and ask the user "should I move to the next phase?" after producing artifacts** — unless the state is `requiresUser: true`. Leaving decisions unrecorded stalls the whole workflow.

## Transitions Are Governed By The Workflow, Not Composed Skills

A composed skill has its own stance and may end by offering a choice or asking whether to proceed or capture an artifact. That is the skill's own boundary, not the workflow's phase boundary. Phase flow is governed only by the workflow: a state is done when its `needs` decisions are recorded. So whenever a composed skill finishes or asks whether to continue, return to the workflow — record the state's `needs` with `decide`, then call `next`. The only real stop for the user is `requiresUser: true`. Composed skills decide *how* to do the work; the workflow decides *when* to transition.

## Acting On The next Output

```text
nextAction            deterministic directive: work | confirm | done (see below)
current/goal/forbid   current state, its goal, forbidden side effects (e.g. write-source)
capabilities          skills you may compose freely ({ id, ref, description })
rules                 workflow-authored requirements for this state — follow them
needs / missing       decision keys to leave this state / those not yet recorded
requiresUser          true = stop and ask the user first
rollback/transitions  rollback marker / events that happened this call
```

`nextAction` is the directive to follow first — it tells you what to do without inferring it:

```text
work     compose the capabilities, record this state's needs with decide, then call next.
         Do not stop to ask whether to proceed.
confirm  do the work, then stop and ask the user before recording the confirming decision.
done     the workflow is complete; nothing more to do.
```

1. Read `goal` and `forbid` to know what to do and what is off-limits here. Read `rules` and treat each as a hard requirement for this state — a workflow may, for example, mandate a specific skill. The engine does not enforce `rules`; honoring them is your responsibility.
2. Pick and load skills from `capabilities`. Each capability is a real Claude Code skill name with its description; load the ones that fit the state's goal and `rules`. Do not hand-write an approximation of a skill that clearly applies (e.g. `brainstorming` in design).
3. Record each satisfied decision with `decide <key> <value>`; pass real results for valued decisions (`review_result pass`, `verify_result fail`). A `fail` triggers a cross-state rollback per `fail_when`, clearing downstream decisions so the work is redone.
4. Act on the next state returned by `decide` and repeat.

If `next --json` returns `projectRules.readNow`, read those rule files immediately so they affect this session.

## User Confirmation Checkpoints (requiresUser)

When `requiresUser: true` (e.g. `design` confirmation, `archive`), **stop and ask the user, and only after an explicit answer record the confirming decision** (`design_confirmed`, `archived`). Never confirm on the user's behalf. Ask with `AskQuestion`, one topic at a time — not a batched questionnaire. Technology stack, architecture/integration, and data/realtime path must be decided by the user.

## Language

Match the language of the user's current workflow request for explanations, clarification questions, summaries, and workflow artifacts; if the user switches later, follow the newest. Keep code identifiers, commands, paths, API names, and quoted source unchanged.

## Builtin Workflows

```text
new       open -> design -> scaffold -> build -> review -> verify   (0 to 1)
feature   open -> design -> build -> review -> verify -> archive    (new requirement)
fix       inspect -> fix -> verify                                  (bug / lightweight change)
```

Put a custom workflow at `.hikspine/workflows/<id>.yaml` and pass `--workflow <id>`; do not edit this skill. The engine maintains the state file — do not hand-edit it.
