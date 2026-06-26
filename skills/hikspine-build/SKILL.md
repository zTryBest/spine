---
name: hikspine-build
description: "hikspine 阶段 3（计划与构建）。内部阶段步骤，由统一入口 /hikspine（别名 /hs）自动分发，通常无需直接调用。按预设步骤制定计划、选择执行方式并实施。"
---

# hikspine 阶段 3：计划与构建（Build，步骤驱动）

本 skill **步骤驱动**：执行预设为 build 阶段声明的 `steps`（默认 `plan`→`writing-plans`，`implement`→`executing-plans`，`tdd`→`test-driven-development`，`review`→`requesting-code-review`），并按 build 决策应用条件。

> 换某步的 skill：在 `.hikspine/config.json` 的 `providers` 里加覆盖。插入新步骤（如 `scaffold`→公司脚手架、`index`→CodeGraph）：预设 `build.steps` 加一项（插件级），或 `.hikspine/config.json` 的 `extra_steps`（如 `build.before_implement`）加一项（项目级，不 fork）。本 skill 在 Step 3.5 依次执行插入步骤。

## 脚本 bootstrap

```bash
. "${CLAUDE_PLUGIN_ROOT}/skills/hikspine/scripts/hikspine-env.sh"
"$HIKSPINE_BASH" "$HIKSPINE_STATE" check <name> build
```

查看本阶段步骤（已应用 provider 覆盖）：

```bash
"$HIKSPINE_BASH" "$HIKSPINE_STATE" steps <name> build
# 解析单个 role 的 skill：provider <name> build <role>
```

**幂等性**：可安全重复。读 `phase` 确认仍在 build，读 plan 文件头 `base-ref`，`grep -n '\- \[ \]' tasks.md | head -1` 找第一个未勾选任务继续。已提交任务不重复提交。

## 步骤

### 1. plan 步骤（Subagent Offload）

加载 `provider <name> build plan` 解析出的 skill（默认 `writing-plans`），优先通过 subagent 创建实施计划。**Subagent 指令**：加载该 plan skill（ARGUMENTS 含 `Language:`），读取 Design Doc 和 `tasks.md`，按指引创建计划，保存至 `docs/superpowers/plans/YYYY-MM-DD-<feature>.md`，文件头含：

```yaml
---
change: <name>
design-doc: docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md
base-ref: <实施前 git rev-parse HEAD>
---
```

派发后：返回有效路径则记为 plan；失败则主 session 内联加载该 plan skill（降级回退）。

### 2. 记录 plan 并提供 plan-ready 暂停点

```bash
"$HIKSPINE_BASH" "$HIKSPINE_STATE" set <name> plan docs/superpowers/plans/YYYY-MM-DD-feature.md
```

立即提供用户决策点（**必须暂停等明确选择**，不得自动继续，不得把暂停写入 `build_mode`）：
| 选项 | 行为 |
|------|------|
| A | 继续执行 → `set <name> build_pause null`，进入 Step 3 |
| B | 暂停切换模型 → `set <name> build_pause plan-ready`，本次停止，稍后用 `/hikspine` 恢复 |

### 3. 选择工作方式（阻塞点）

恢复时若 `build_pause: plan-ready` 且 plan 存在，不要重跑 plan；告知用户停在暂停点，确认后 `set <name> build_pause null` 再继续。

**体验档位（flow_mode）**：读取 `flow_mode`：

```bash
MODE=$("$HIKSPINE_BASH" "$HIKSPINE_STATE" config-get flow_mode)   # guided（默认）| fast
```

- `fast` 模式：把四项配置合并成**一个**确认——「使用推荐设置？**branch + executing-plans + tdd + standard review**」，选项 `[用推荐 / 我要自定义]`。
  - 用户选「用推荐」：依次 `set <name> isolation branch`、`set <name> subagent_dispatch null`、`set <name> build_mode executing-plans`、`set <name> tdd_mode tdd`、`set <name> review_mode standard`，然后**跳过**下面的逐项选择，直接进入执行隔离。分支名仍需用户确认（见下）。
  - 用户选「我要自定义」：按下面 guided 的逐项选择进行。
- `guided` 模式（默认）：按下面逐项选择。

> fast 只合并 build 的低风险配置项确认；其余高风险阻塞点（设计确认、verify 失败决策、分支处理、归档前确认）在任何档位都保留。

**guided 逐项选择**——**一次性询问用户**选择隔离方式、执行方式、TDD 模式、代码审查模式（**必须暂停等明确选择**，推荐规则只作建议）：
- **隔离**：A 分支（≤3 文件推荐）/ B Worktree（并行/有未提交工作推荐）
- **执行方式**：A `subagent-driven-development`（任务≥3、复杂、需双阶段审查）/ B `executing-plans`（任务≤2、轻量）
- **TDD**：`tdd`（业务逻辑/新功能/API 推荐）/ `direct`
- **代码审查**：`off`（文档/低风险）/ `standard`（默认）/ `thorough`（高风险/多模块）

写字段：
```bash
"$HIKSPINE_BASH" "$HIKSPINE_STATE" set <name> isolation <branch|worktree>
"$HIKSPINE_BASH" "$HIKSPINE_STATE" set <name> tdd_mode <tdd|direct>
"$HIKSPINE_BASH" "$HIKSPINE_STATE" set <name> review_mode <off|standard|thorough>
```
- 选 `executing-plans`：`set <name> subagent_dispatch null` 再 `set <name> build_mode executing-plans`
- 选 `subagent-driven-development`：先确认平台有真实后台 subagent/Task/multi-agent 调度；确认后 `set <name> subagent_dispatch confirmed` 再 `set <name> build_mode subagent-driven-development`；无法确认则不得写入，暂停等改选 `executing-plans`
- `feature` 默认不得用 `direct`；仅用户明确要求且记录 override：`set <name> direct_override true` 再 `set <name> build_mode direct`

> 守卫强制：离开 build 前 `isolation`、`build_mode`、`tdd_mode`、`review_mode` 必须均已选定。

**执行隔离**：
- **branch**：按 workflow 前缀 + `date +%Y%m%d` + change 名推荐分支名，**暂停等用户确认/自定义**，再 `git checkout -b <branch>`
- **worktree**：必须加载 `using-git-worktrees` 技能创建隔离工作区，不得用普通命令绕过；先提交 plan 再创建 worktree

### 3.5 执行插入的额外步骤

运行 `steps <name> build`，对其中**非 plan/implement/tdd/review** 的步骤（如 `scaffold`、`index`），**按顺序使用 Skill 工具加载其 `<skill>` 执行**（按 `<note>` 的职责）。这是 CodeGraph/公司脚手架等能力的插入点——加 step 即生效，不改本 skill。

**每执行完一个步骤记录状态**（plan / 插入步骤 / implement / tdd / review 都记）：`"$HIKSPINE_BASH" "$HIKSPINE_STATE" step-record <name> build <role> done`（条件不满足而跳过→`skipped` 带原因，如 `tdd` 在 `tdd_mode=direct` 时；失败→`failed`）。

### 4. implement 步骤（按 build_mode）

implement 步骤的 skill 由 `provider <name> build implement` 解析（默认 `executing-plans`），实际加载哪个由 `build_mode` 决定：
- `build_mode: executing-plans`：**立即执行：** 使用 Skill 工具加载该 implement skill。禁止跳过。ARGUMENTS 含 `Language:`。按计划执行
- `build_mode: subagent-driven-development`：主会话只协调，禁止直接写实现代码。**立即执行：** 使用 Skill 工具加载 Superpowers `subagent-driven-development` 技能。每个后台 implementer 自行加载 tdd 步骤的 skill 并遵循 TDD 约束。若平台无真实后台调度能力，暂停等用户改主窗口执行；用户选择后先 `set <name> build_mode executing-plans` 再按对应分支加载
- `build_mode: direct`（hotfix/tweak 或带 override）：直接按 tasks 实现

**tdd 步骤**：`tdd_mode: tdd` 时，`executing-plans` 分支在执行第一个任务前**立即执行：** 使用 Skill 工具加载 `provider <name> build tdd` 解析出的 skill（默认 `test-driven-development`）一次，对每个任务遵循 Red-Green-Refactor，不得跳过失败测试验证。`tdd_mode: direct` 时按正常流程。

**review 步骤 / review gate**：`executing-plans` 且 `review_mode` 为 `standard`/`thorough` 时，所有任务完成后、推进前，必须加载 `provider <name> build review` 解析出的 skill（默认 `requesting-code-review`）请求一次审查。`off` 时跳过并在 tasks.md/报告记录原因。CRITICAL 发现（安全/数据丢失/构建测试失败）必须先修复。

### 4b. 执行中异常调试

执行任务期间，只要运行程序/测试/构建/手动验证出现崩溃、异常、测试失败或构建失败，必须使用 Skill 工具加载 Superpowers `systematic-debugging` 技能。完成根因调查前不得提出或实施源码修复。

### 5. Spec 增量更新

发现初版 spec 不完整时分级：小 → 直接改 delta spec + design.md 追加 tasks；中 → **暂停确认后**加载 `brainstorming` 更新；大 → **暂停确认拆分**，加载 `hikspine-open` 技能创建独立 change。**50% 阈值**：新增任务超过 tasks.md 初始总数一半视为超范围，**必须暂停等用户决定是否拆分**。

每完成一个 task 按 `review_mode` 完成验收后勾选并提交（commit message 体现设计意图）。

## 退出条件

- 本阶段适用 `steps` 已执行；tasks.md 全部勾选，代码已提交
- 已显式运行项目构建/测试命令并通过
- `isolation`、`build_mode`、`tdd_mode`、`review_mode` 均已写定（`subagent-driven-development` 需 `subagent_dispatch: confirmed`）
- `review_mode` 为 `standard`/`thorough` 时已完成审查且 CRITICAL 已修复；`off` 已记录跳过原因
- **阶段守卫**：

```bash
"$HIKSPINE_BASH" "$HIKSPINE_STATE" transition <name> complete
```

PASS 后自动推进到 `phase: verify`、`verify_result: pending`。

> 后续增强：`build_command`/`verify_command` 由守卫自动执行（对应 comet 的 `hikspine-guard.sh`）。当前由本 skill 流程纪律显式运行构建/测试命令。

## 自动衔接下一阶段

```bash
"$HIKSPINE_BASH" "$HIKSPINE_STATE" next <name>
```

- `NEXT: auto` → 加载 `SKILL` 指向的 skill 进入 verify
- `NEXT: manual` → 不调用下一 skill，按 `HINT` 提示手动运行 `/hikspine`
- `NEXT: done` → 流程已完成
