## What's Changed [0.3.0] - 2026-06-29

可视化编排（界面 + 多 workflow + 自动选流程）的 Phase 1：纯引擎/CLI 底座，可测试，UI 在后续 Phase 叠加。

### Added

- **真实 skill 名作为 capability + skill 发现**: `capabilities` 现在直接写真实的 Claude Code skill 名（如 `writing-plans`、`executing-plans`、`systematic-debugging`），不再是经 registry 映射的抽象 id。新增 `lib/skills.mjs` 的 `discoverSkills`，从 Claude Code 自己读取的同一批文件系统位置发现 skill——项目 `.claude/skills`、个人 `~/.claude/skills`、插件市场 `~/.claude/plugins/marketplaces/**/skills`、本插件 `skills/`——读 `SKILL.md` frontmatter 的 `name`/`description`，按 name 去重并标 source。`capabilities` 解析时从发现结果取 description；未安装的名字仍原样透传（标 `unknown`）。
- **`skills` 命令**: `hikspine skills [--json]` 列出所有可发现的 skill（name/description/source/path），是编排界面挑选器的数据源，也是合法 capability 名的来源。
- **`workflows` 命令 + workflow 级 `intent`**: `hikspine workflows [--json]` 列出所有可用 workflow（内置 + 项目，项目按 id 覆盖内置），每个带 `intent`（声明“何时该用这条流程”）。四个内置 workflow 都补了 `intent`。供 Agent 路由请求到正确流程，也供未来编排界面读取。
- **`changes` 命令（并发运行注册表）**: `hikspine changes [--json]` 扫描所有在跑的 change（两种存储），列出各自的 workflow、当前状态、`nextAction`、缺失决策和是否 active。只读，不会 auto-advance 或改动任何 change。让多个 workflow（new/fix/hotfix）以独立 change 共存，是后续看板的数据源。
- **自动选 workflow（skill 指令）**: 两份 spine skill 增加“选择 workflow”段——用户没指定且无 `defaultWorkflow` 时，读 `workflows --json` 的 `intent`，结合需求与项目现状（紧急度、影响范围、是否已有代码）匹配；两者旗鼓相当时用 `AskQuestion` 让用户拍板。路由判断在 Agent，引擎只提供候选 + intent，保持 skill-agnostic。
- **`lintWorkflow`（给编排界面用）**: `lib/store.mjs` 把 workflow 结构校验抽成不抛异常的 `lintWorkflow`（一次返回全部问题）与共享的 `workflowIssues`，供未来 UI 编辑器校验；`validateWorkflow` 复用同一套规则（仍 fail-fast）。

### Removed

- **registry 与 company 概念**: 删除 `lib/registry.mjs` 及 capability-id→skill 的抽象映射。开源与公司 skill 都只是 skill，不再区分；内置 workflow 的 `superpowers.*` / `openspec.*` 别名换成真实 skill 名，`company.*` 占位（本仓库无对应 skill）从内置 workflow 移除。“换 skill 不改 workflow”现在的含义是：states/transitions（大阶段）是稳定骨架，`capabilities`（每个阶段能用的真实 skill 集合）可自由增删替换。

### Changed

- **`summarize` 抽取（只读状态摘要）**: `lib/transitions.mjs` 抽出 `summarize(workflow, state)`——不 auto-advance、不存盘、不加载 registry，返回 `current/goal/missing/nextAction/rules` 等。`computeNext` 复用它，`changes` 列表也用它逐个汇总并发 change，`nextAction` 判定单一来源。

### Tests

- 新增编排 registry 场景：`workflows` 列出内置且带 `intent`；两个不同 workflow 的 change 并发共存，`changes` 全部列出、逐个报 `nextAction`、正确标记 active。共 90 passed。

## What's Changed [0.2.1] - 2026-06-29

### Added

- **状态级 `rules`（自定义 workflow 声明规则）**: workflow 的状态可声明 `rules` 列表，`computeNext` 原样透传到输出的 `rules` 字段，`formatNextAction` 也打印出来。引擎只搬运、不解析、不强制——这是一个 skill 无关的透传通道，让自定义 workflow 声明本状态的硬性要求（例如“设计阶段必须用 brainstorming 探索备选与权衡”），而不需要把任何上游 skill 名写进引擎或 spine skill。通用纪律仍在 spine skill，具体规则在 workflow，职责分离。内置 `feature` / `new-project` 的 design 状态已示范一条 `rules`；两份 spine skill 和 `rules/hikspine-workflow.md` 增加“读取并遵守状态 `rules`”的通用指令。
- **确定性流转指令 `nextAction`**: `computeNext` 现在输出 `nextAction`（`work` / `confirm` / `done`），把“要不要续跑”从 Agent 推断变成引擎给出的确定性指令——`work` = 组合 capability、`decide`、再 `next`，不要停下来问是否继续；`confirm` = 先干活、再停下让用户确认后才 `decide` 确认类决策；`done` = 工作流完成。判定只来自引擎已有信息（`terminal` / `requires_user` / `missing`），不绑定任何上游 skill。借鉴自 comet 的 `NEXT: auto|manual|done`，但因 Hikspine 是“一个状态多 skill 自由组合 + 决策驱动”，指令指向循环动作而非具体 skill，保持 skill 无关。两份 spine skill 同步说明如何先读 `nextAction`。
- **流转纪律下沉到引擎（skill-agnostic）**: `computeNext` 现在在每次 `next`/`decide` 的返回里带 `transitionPolicy` 字段，`formatNextAction` 也输出同一句提示：阶段流转由 workflow 决定、不由组合的 skill 决定；任何组合 skill 结束或抛出“是否继续”都不是停止点，应记录该状态的 `needs` 再 `next`，唯一真正停下问用户的点是 `requiresUser`。提示是 skill 无关的，不绑定任何上游 skill，符合“引擎只编排、上游 skill 不可改”的设计理念。两份 spine skill 和 `rules/hikspine-workflow.md` 同步补充同一条 skill 无关的流转纪律。

### Fixed

- **入口 skill 与引擎脱钩**: `skills/hikspine/SKILL.md` 和 `skills/hikspine-engine-zh/SKILL.md` 仍在描述已删除的"观察引擎"（`next`-only、`exit.checks`、`nextSkill`/`requiredInputs`/`file.contains_headings`），完全没有 `decide`。照此执行的 Agent 做完一个阶段后只调 `next`、从不 `decide`，决策驱动的状态机停在原状态不动，退化成"要不要进入下一阶段"的临场提问——表现为"没有自动流转"。两份 skill 改写为真实的 `next → 干活 → decide → next` 循环，并明确"让流程前进的唯一动作是 `decide`，产出产物后不要停下来问用户是否进入下一阶段，除非 `requiresUser`"。
- **分发规则同步**: `rules/hikspine-workflow.md`（分发到 `.claude/rules`）原本同样写着 `next` 为唯一协议、`exit.checks` 驱动流转、`nextSkill`/`requiredSkills`/`requiredInputs`，会双重强化错误行为。改为 decide 驱动表述，并保留 `requiresUser`、valued 决策回退、write-source 守卫等规则。

### Changed

- **Skill 精简为操作指令**: 按"SKILL.md 只写 Agent 照着执行的操作指令、不写面向人的说明文档"重写两份 skill，剔除架构原理、引擎内部循环伪代码、状态文件内部结构、各源文件职责清单、守卫内部机制（这些归 `docs/architecture.md`）。`skills/hikspine-engine-zh/SKILL.md` 从约 200 行压到约 80 行，保留 runtime 加载、`next`/`decide` 主循环、字段如何行动、`requiresUser`、语言规则、内置工作流清单。

## What's Changed [0.2.0] - 2026-06-28

### Added

- **Composable state machine kernel**: Replaced the observation engine with a decision-driven state machine (`lib/transitions.mjs`). States declare skill-agnostic `needs` (decision keys) and `capabilities` (composable skills). Advancement is driven by recorded decisions, not by observing files on disk — skills can be freely swapped without changing the workflow graph.
- **Skill registry**: Capability IDs are bound to actual skills via a built-in registry (`lib/registry.mjs`) plus optional project-level overlays. Skills no longer need to know what state they belong to.
- **Cross-state rollback**: States can declare `fail_when` / `fail_to` edges. On failure, all downstream decisions between `fail_to` and the current state are cleared, forcing re-do instead of re-checking stale results.
- **User confirmation gates**: States can declare `requires_user: true` as a hard blocking point (e.g., design confirmation, archive). The engine stops until the user confirms.
- **Guard hook**: `PreToolUse` hook (`hooks/guard.mjs`) that blocks `Write|Edit|MultiEdit` calls when the current state's `forbid: [write-source]` matches the target file. Fail-open design: if no active change, all writes are allowed.
- **Rule sync**: Plugin-authored Markdown rules (`rules/`) are idempotently distributed to project `.claude/rules/` with SHA-256 tracking; locally-edited rules are preserved.
- **Next/decide protocol**: The agent protocol is reduced to exactly two verbs: `next` (show current state, missing decisions, composable capabilities) and `decide` (record a decision; engine auto-advances or rolls back).
- **Builtin workflows v5**: `feature`, `new-project`, `simple-fix`, `hotfix` — all migrated to the states-based YAML format with decision-driven transitions.
- **Project workflow support**: Custom workflows in `.hikspine/workflows/<id>.yaml` take precedence over builtins.
- **Dual storage modes**: OpenSpec-backed changes co-locate state at `openspec/changes/<change>/.hikspine.yaml`; lightweight standalone changes store at `.hikspine/changes/<change>.yaml`.
- **Architecture design document**: `docs/architecture.md` as the authoritative design reference for the engine.
- **Chinese documentation**: `README.zh-CN.md` and `skills/hikspine-engine-zh/SKILL.md`.
- **Company skill registry template**: `templates/company-registry.example.yaml` and `templates/hikspine-config.example.yaml`.

### Changed

- **`skills/hikspine/SKILL.md`**: Rewritten as skill-first entry point; `/hs` is a natural-language convention, not a command file.
- **`skills/hikspine/scripts/hikspine-env.sh`**: Runtime locator searches multiple fallback paths; no longer requires `CLAUDE_PLUGIN_ROOT`.
- **`lib/checks.mjs`**: Retained for guard decisions and optional secondary validation; no longer drives state transitions.
- **CLI**: Rewritten as `bin/hikspine.mjs` with `next` and `decide` subcommands, replacing the old `hikspine-preset.mjs` + `hikspine-state.sh` scripts.
- **Vendor config**: OpenSpec vendored to v1.4.1; `commands/opsx/` directory removed (skills replace slash commands).

### Removed

- **Preset system**: `skills/hikspine/presets/feature.json`, `hotfix.json`, `tweak.json` — replaced by YAML workflows.
- **Observation engine**: `skills/hikspine/scripts/hikspine-state.sh`, `hikspine-preset.mjs`, `hikspine-config.mjs`, `hikspine-hook-guard.sh` — replaced by the composable state machine and guard hook.
- **Old tests**: `test/state-machine.test.sh`, `test/hook-guard.test.sh` — replaced by `test/workflow-kernel.test.sh`.
- **`commands/` directory**: All `opsx/` and `hikspine.md`/`hs.md` command files removed; skills are the entry point.

### Tests

- Full rewrite of `test/workflow-kernel.test.sh`: 80 assertions covering the runtime locator, feature workflow E2E (decision-driven advancement through all states, cross-state rollback with decision clearing, re-do verification), simple-fix and hotfix workflows (standalone storage, rollback), new-project workflow (scaffold state), custom project workflows (states-based YAML format), guard hook (source-write blocking and non-source allow), and edge cases (invalid change names, missing active/change arg errors).

### Security

- Guard hook unifies write-source control: `open`, `design`, and `archive` states forbid writing to configured `sourceRoots`; `build`, `fix`, `patch`, `scaffold` states allow it. The guard is fail-open — if no active change exists or state resolution fails, writes proceed normally.
