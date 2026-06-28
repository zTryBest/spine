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
