# Hikspine

Chinese docs: [README.zh-CN.md](README.zh-CN.md)

## Project Introduction

Hikspine is a skill-first workflow kernel for Claude Code. It turns AI coding work into explicit, resumable workflows: the current stage, required decisions, capability skills, user checkpoints, artifacts, and board state are all represented as data instead of being left to the agent's memory.

It is distributed as a Claude Code plugin. Users normally start it through skills such as `hikspine`, `hikspine-zh`, `hikspine-ui`, and `hikspine-global-ui`, while the engine stores state in the target project and exposes a small `next` / `decide` protocol.

## Use Cases

- Build a new project from scratch with a scaffold-first workflow.
- Develop a non-trivial feature in an existing codebase with OpenSpec, design, implementation, review, verification, and archive stages.
- Run a lightweight bug fix flow that still leaves a minimal OpenSpec record.
- Coordinate multiple concurrent changes in the same project without losing the active task.
- Show project and multi-project progress on a local web board.
- Let teams customize workflows and capability skill combinations without changing the engine.

## Highlights

- **Skill-first execution**: workflow `capabilities` are real Claude Code skills. The agent must load the returned skills instead of hand-rolling their work.
- **Decision-driven flow**: `next` reads state, `decide` records outcomes, and the workflow advances or rolls back deterministically.
- **OpenSpec-backed state**: changes default to `openspec/changes/<change>/.hikspine.yaml`, so specs, artifacts, and board data stay in one place.
- **Localized workflows**: built-in workflow YAML exists in default and Chinese variants. `hikspine-zh` sets `HIKSPINE_WORKFLOW_LOCALE=zh`, and legacy state files without `workflowLocale` default to Chinese for compatibility.
- **Local and global boards**: `hikspine-ui` opens the current project board; `hikspine-global-ui` opens a board across all locally registered projects.
- **Workflow studio**: the board previews read-only built-in workflow templates and lets users copy them into user scope or project scope before editing.
- **Safety hooks**: Claude Code hooks can block source writes in forbidden stages, record attention-needed notifications, and clean up UI processes on session end.
- **Project rules sync**: the engine syncs plugin rules into `.claude/rules` and tells the agent which newly synced files to read in the current session.

## How To Use

Install this repository as a Claude Code plugin through your team's plugin marketplace or local plugin source. If a workflow uses OpenSpec artifacts, keep the OpenSpec CLI available on `PATH`.

Use the English entry for default workflows:

```text
Use hikspine to start <change-name>
```

Use the Chinese entry for Chinese workflow names, goals, and rules:

```text
使用 hikspine-zh 启动 <change-name>
```

The agent should then load the skill, locate the runtime, and run the engine:

```bash
node "${HIKSPINE_ENGINE:?source the locator block in this same Bash call}" next <change-name> --workflow <workflow-id> --json
```

After finishing the current state, record each required decision:

```bash
node "${HIKSPINE_ENGINE:?source the locator block in this same Bash call}" decide <decision-key> <value> --change <change-name> --json
node "${HIKSPINE_ENGINE:?source the locator block in this same Bash call}" next <change-name> --json
```

Common workflow ids:

- `new`: new project from 0 to 1.
- `feature`: non-trivial feature or requirement change in an existing codebase.
- `fix`: bug fix or lightweight change.

Project-level configuration is optional:

```yaml
# .hikspine/config.yaml
version: 1
defaultWorkflow: feature
guard:
  sourceRoots:
    - src/
    - app/
```

Custom workflows can be saved at two editable scopes:

```text
User scope, shared by new projects on this machine:
~/.hikspine/workflows/<workflow-id>.yaml
~/.hikspine/workflows/zh/<workflow-id>.yaml

Project scope, stored with the current project:
.hikspine/workflows/<workflow-id>.yaml
.hikspine/workflows/zh/<workflow-id>.yaml
```

Built-in workflows live in the plugin and are read-only templates. Hikspine does not copy them into every project automatically. If the same workflow id exists in multiple scopes, the agent must ask which one to use and pass `--workflow-source user`, `--workflow-source local`, or `--workflow-source builtin`.

Useful engine commands:

```bash
node "$HIKSPINE_ENGINE" workflows --json
node "$HIKSPINE_ENGINE" skills --json
node "$HIKSPINE_ENGINE" changes --json
node "$HIKSPINE_ENGINE" board --json
node "$HIKSPINE_ENGINE" ui --project-root /path/to/project
node "$HIKSPINE_ENGINE" ui --all --project-root /path/to/project
```

## Quick Start

1. Install the Hikspine plugin in Claude Code.
2. Open Claude Code in the target project root.
3. Ask the agent to start a workflow:

```text
使用 hikspine-zh 为“登录页接入企业 SSO”启动 feature 工作流
```

4. The agent runs `next --json`, reads the returned `goal`, `rules`, `capabilities`, and `missing` decisions, then loads the required capability skills.
5. When a state is done, the agent records decisions with `decide`, then calls `next` again.
6. Open the board when you want a visual status view:

```text
使用 hikspine-ui 打开当前项目看板
```

For all locally registered projects:

```text
使用 hikspine-global-ui 打开全局看板
```

## Roadmap

- Locale-aware project rules, so `.claude/rules` can use Chinese or default wording without duplicating conflicting instructions.
- Better server-oriented multi-project reporting for team-wide adoption metrics.
- More workflow authoring validation in the canvas, including safer editing for capability tags and decision predicates.
- Richer artifact previews and task analytics on the board.
- Cleaner integration paths for code exploration tools such as codegraph.

## Verification

```bash
npm test
```
