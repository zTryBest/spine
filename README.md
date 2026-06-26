# hikspine

Phase-guarded, preset-driven development workflow — distributed as a single
**Claude Code plugin**. Wraps **OpenSpec** (WHAT) and **Superpowers** (HOW)
behind a unified `/hikspine` entry (alias `/hs`) with a generic, preset-driven
state machine.

> Derived from the design ideas of [comet](https://github.com/rpamis/comet),
> rebuilt as a Claude-Code-only plugin with a generalized preset state machine.

## Status

Early scaffolding. Implemented so far:

- Plugin manifest + marketplace (`.claude-plugin/`)
- Unified entry commands `/hikspine` and `/hs`
- Upstream vendoring (`scripts/sync-upstream.sh` + `vendor.config.json`)
- **Generic preset-driven state machine** (`skills/hikspine/scripts/`):
  `hikspine-state.sh` reads the phase graph, exit guards, and transition side
  effects from `presets/*.json` — adding a workflow is adding a preset file, no
  code change. Verified end-to-end by `test/state-machine.test.sh` (16 checks).
- **Orchestrator + 7 phase skills (中文)**: `hikspine` (entry brain) plus
  `hikspine-open/design/build/verify/archive/hotfix/tweak`. Each preset phase
  routes to its skill via `hikspine-state.sh next`. Skills wrap the vendored
  OpenSpec/Superpowers skills and advance via `transition <name> complete|fail`.

- **Phase-write guard hook** (`hooks/hooks.json` + `hikspine-hook-guard.sh`):
  a PreToolUse hook blocks source writes during design/open/archive phases and
  catches illegal phase jumps (feature build without a Design Doc). Invoked via
  `bash "${CLAUDE_PLUGIN_ROOT}/.../hikspine-hook-guard.sh"` so it works on
  Windows Git Bash / WSL too. Verified by `test/hook-guard.test.sh` (11 checks).

  > ⚠️ **The guard is a workflow guardrail, not a security sandbox.** It matches
  > `Write|Edit` to keep the agent in the right phase. It does **not** stop shell
  > redirection, `patch`/`sed`-type tools, or future tools with other names — and
  > is not a permission boundary. Use Claude Code's own permission/sandbox
  > settings for real isolation.

Not yet implemented: `hikspine-guard.sh` wrapper (auto-running build/verify
commands), deterministic design handoff package + SHA256 tracing, one-command
archive automation, auto scale assessment, and structured context-recovery
output. These are noted as "后续增强" inline in the skills; the flow is
functional without them.

## Requirements

- **Node.js 20.19.0+** (OpenSpec CLI requirement)
- Git; a Bash-compatible shell (Git Bash on Windows, or WSL)

## Install (team)

```bash
# in Claude Code
/plugin marketplace add <internal-git-url-or-path>
/plugin install hikspine@hikspine
```

OpenSpec also needs its CLI on PATH (binary cannot be bundled in a plugin):

```bash
npm i -g @fission-ai/openspec@<pinned-version>   # Node 20.19.0+
```

## First run (what it looks like)

```
> /hs 给订单列表加一个按状态筛选的功能

1. 命名      → hikspine 给 2-3 个 kebab-case 名，你选一个（如 order-status-filter）
2. design    → OpenSpec 简单澄清 → Superpowers 深度 brainstorming → 你确认设计方案 → 生成 Design Doc
3. open      → OpenSpec 把方案形式化为 proposal / design / tasks → 你确认产物
4. build     → 选隔离/执行/TDD/审查方式 → 按 plan 实现（TDD）→ 代码审查
5. verify    → 验证 + 处理分支 → 写验证报告
6. archive   → 你确认归档 → 合并 delta spec 进主 spec，change 移入 archive
```

中途任何时候关掉，再敲 `/hs`（或 `/hikspine`）即可——它读 `.hikspine.yaml` 自动检测当前阶段并续传。各阶段的 ✋ 阻塞点会停下等你确认，其余自动推进。

## Extensibility model (three stable layers)

Most customization should land in the first two layers — **without editing phase
skills**:

| Layer | File(s) | Change this to… |
|-------|---------|-----------------|
| **Workflow shape** | `skills/hikspine/presets/*.json` | add/reorder/remove phases, swap a phase's skill, change guards |
| **Behavior & integrations** | project `.hikspine/config.json` | tune `auto_transition`/`review_mode`, override step `providers`, insert `extra_steps`, declare requirement sources / MCP integrations |
| **Phase behavior** | `skills/hikspine-*/SKILL.md` | rarely — only to change what a phase *does* internally |

Phase skills expose **generic extension points** (e.g. "consult configured
requirement sources before asking the user"), so adding an integration is a
config edit, not a skill edit. See `templates/hikspine-config.example.yaml`.

### Provider steps: swap a skill, or insert a capability

Each preset phase declares an ordered list of **provider steps** (`steps` in the
preset JSON) — each step binds a *role* to a default *skill*. The `feature`
preset is a curated **hybrid** (the same best-of-both split comet uses):

| Phase | Steps (role → default skill) | Why |
|-------|------------------------------|-----|
| design | `clarify`→`openspec-explore`, `brainstorm`→`brainstorming` | OpenSpec quick clarify, then Superpowers deep brainstorming |
| open | `formalize`→`openspec-propose` | OpenSpec rich, maintainable specs |
| build | `plan`→`writing-plans`, `implement`→`executing-plans`, `tdd`→`test-driven-development`, `review`→`requesting-code-review` | Superpowers planning + TDD |
| verify | `verify`→`verification-before-completion`, `spec-verify`→`openspec-verify-change`, `finish`→`finishing-a-development-branch` | both |
| archive | `archive`→`openspec-archive-change` | OpenSpec spec lifecycle |

Two cheap extension moves, neither edits a phase skill:

- **Swap the skill bound to a role** (e.g. when a framework improves a step):
  add an entry under `providers` in `.hikspine/config.json`. Resolution is
  most-specific-wins, so teams keep the simple form but can target precisely:
  `"<workflow>.<phase>.<role>"` › `"<phase>.<role>"` › `"<role>"`. The resolver
  (`hikspine-state.sh provider <change> <phase> <role>`) applies the override;
  the phase skill runs whatever it resolves to.
- **Insert a new capability** (e.g. **CodeGraph** semantic indexing, or a
  **company code-scaffold skill**) — two ways, neither edits a phase skill:
  - **Plugin-level**: add a step to the phase's `steps` in the preset JSON.
  - **Project-level (no fork)**: add to `extra_steps` in `.hikspine/config.json`
    at a named position — `"<phase>.start"`, `"<phase>.before_<role>"`,
    `"<phase>.after_<role>"`, `"<phase>.end"` — e.g.
    `"build.before_implement": [{ "role": "scaffold", "skill": "company-scaffold" }]`.

  **All phase skills are step-driven** — they run
  `hikspine-state.sh steps <change> <phase>` (which merges preset steps +
  `extra_steps` and applies `providers` overrides) and execute each step in
  order, so the new capability runs without touching any skill or forking the
  plugin. Company-capability skills should be **idempotent/self-checking** (e.g.
  a scaffold skill that no-ops when the scaffold already exists).

> Today the curated hybrid is fixed per phase. "All-Superpowers" / "All-OpenSpec"
> presets are deliberately deferred — frameworks keep fixing their own weak
> spots, so a per-step hybrid that you can swap point-by-point ages better.

### Connecting a requirement-knowledge MCP

The clarification step of `hikspine-design` consults requirement sources declared
in `.hikspine/config.json` to reduce manual Q&A. Wiring is **config only** — no
skill edit when you add/swap/remove a source:

1. **Connect the MCP.** Copy `.mcp.json.example` → `.mcp.json` (plugin root) and
   fill in your requirement-KB MCP's launch command/URL. Because it ships inside
   the plugin, the whole team gets it on `/plugin install`. (MCP tools are
   ambient — the agent can call them once connected; you do not name the MCP in
   any skill.)
2. **Declare it as a source.** In `.hikspine/config.json`, add the server under
   `requirement_sources` with the tools to query. The `server` name must match
   `.mcp.json`.
3. Done. To add another source later, add another `requirement_sources` entry —
   skills stay untouched.

> Note: the exact plugin MCP-manifest field is evolving; confirm `.mcp.json`
> auto-load vs a `mcpServers` key in `plugin.json` against current Claude Code
> docs when you wire the real server.

## Vendoring upstream skills

OpenSpec and Superpowers are open source but distribute through their own
installers, not plain git subpaths. `sync-upstream.sh` stages each via its
official installer into a throwaway `.claude/`, then snapshots the generated
skill/command dirs into this repo. Re-running picks up upstream's latest.

```bash
npm run sync            # refresh all vendored skills, update VENDOR.lock.json
npm run sync:check      # report whether upstream changed, write nothing
bash scripts/sync-upstream.sh superpowers   # one vendor only
```

**Vendored dirs under `skills/` are read-only mirrors.** Never hand-edit them —
the next sync overwrites. Layer any customization as a separate hikspine skill.
Pinned versions are recorded in `VENDOR.lock.json`; source refs live in
`vendor.config.json` (set a vendor's `ref` to a tag/commit to pin, or `latest`
to track upstream).

**OpenSpec profile**: `vendor.config.json` requests OpenSpec's expanded
(`custom`) profile via a `workflows` list, so the sync pulls the full skill set —
including `openspec-new-change` and `openspec-verify-change`. Drop the
`workflows` field (or set `profile: core`) for the minimal explore/propose set.

## Workflow model

A run is a sequence of phases. Each **preset** (under
`skills/hikspine/presets/*.json`) declares the phase order, which skill owns each
phase, the guard that must pass to leave it, and the next/failure transitions.
The shell state machine is a generic interpreter of these presets — adding a
workflow means adding a preset file, not changing code.

The bundled `feature` preset is **brainstorm-first**:
`design → open → build → verify → archive` (Superpowers brainstorming runs first,
then OpenSpec formalizes the result). `hotfix`/`tweak` skip design:
`open → build → verify → archive`.
