## What's Changed [0.2.1] - 2026-06-29

### Added

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
