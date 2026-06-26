---
name: hikspine-hotfix
description: "hikspine 预设路径 hotfix 的构建阶段 skill。直接构建（build_mode: direct），跳过 brainstorming 和完整 plan。用于行为修复、不涉及新 capability 设计的场景。由 /hikspine 在 hotfix 预设的 build 阶段路由调用。"
---

# hikspine hotfix 预设 — 直接构建（Build）

hotfix 预设的执行链路 open → build → verify → archive 由 `/hikspine` orchestrator 编排，open/verify/archive 复用共享阶段 skill。本 skill 是 **hotfix 预设的 build 阶段**：直接构建。

**适用条件**（必须全部满足）：修复已有功能 bug、不新增 capability、不涉及接口/架构调整、改动可预估（通常 ≤ 2 文件）。

## 脚本 bootstrap

```bash
. "${CLAUDE_PLUGIN_ROOT}/skills/hikspine/scripts/hikspine-env.sh"
"$HIKSPINE_BASH" "$HIKSPINE_STATE" check <name> build
```

## 步骤

### 0. 输出语言约束

精简产物和反馈使用触发本次工作流的用户请求语言。

### 1. 直接构建（preset build）

使用 hotfix 默认值：`build_mode: direct`、`isolation: branch`、`tdd_mode: direct`、`review_mode: off`（init 时已写入）。跳过 Superpowers `brainstorming` 和 `writing-plans`（除非任务 > 3 个；超过则加载 `hikspine-build` 技能按其计划与执行方式选择切换，注意这不触发 feature 升级，仅切换执行方式）。

开始修改前先检查未提交改动并归因；若归因后发现范围超出 hotfix，按下方「升级条件」处理。

**执行插入的额外步骤**：运行 `"$HIKSPINE_BASH" "$HIKSPINE_STATE" steps <name> build`，若有声明的步骤（如 `scaffold`→公司脚手架、`index`→CodeGraph），**按顺序使用 Skill 工具加载其 `<skill>` 执行**。默认 hotfix 无此类步骤（直接构建）；这是不改本 skill 就能插入能力的钩子。

**立即执行：** 按 tasks.md 逐个执行任务：
1. 读取 `openspec/changes/<name>/tasks.md` 获取未完成任务
2. 对每个未完成任务：按描述改代码 → 运行格式化命令（如 `npm run format`、`mvn spotless:apply`）→ 运行相关测试 → 把对应 `- [ ]` 勾选为 `- [x]` → 提交（`fix: <简述>`）
3. 全部完成后显式运行项目测试和构建命令

执行期间只要运行程序/测试/构建/手动验证出现崩溃、异常、测试失败或构建失败，必须使用 Skill 工具加载 Superpowers `systematic-debugging` 技能。完成根因调查前不得提出或实施源码修复。

若修复影响已有 spec 验收场景，在 `openspec/changes/<name>/specs/<capability>/spec.md` 创建仅含 `## MODIFIED Requirements` 的 delta spec。

### 2. 根因消除检查

**推进阶段前执行**：读 proposal.md 的 bug 描述与根因 → 搜索验证问题代码不再存在 → 根因未消除则回 Step 1 继续修复（仍在 build 阶段，无需状态回退）。

### 3. 推进到验证

根因确认消除后：

```bash
"$HIKSPINE_BASH" "$HIKSPINE_STATE" transition <name> complete
```

全部 PASS 后自动推进到 `phase: verify`、`verify_result: pending`。然后按 `next` 路由进入 verify 阶段（加载 `hikspine-verify` 技能）。

## 升级条件

满足以下**任一**时，停止 hotfix，升级为 `feature` 预设：改动 3+ 文件、架构变更、数据库 schema 变更、引入新 public API、修复范围超出单一函数/模块。

满足升级条件时**必须暂停并等待用户明确确认**升级。不得直接进入设计、不得自动补 Design Doc。用户确认后切换预设再进入设计：

```bash
"$HIKSPINE_BASH" "$HIKSPINE_STATE" set <name> workflow feature
HIKSPINE_FORCE_PHASE=1 "$HIKSPINE_BASH" "$HIKSPINE_STATE" set <name> phase design
```

然后**立即执行：** 使用 Skill 工具加载 `hikspine-design` 技能，后续走完整 feature 流程。若用户不确认升级，停止 hotfix 并报告变更已超出 hotfix 适用范围。

## 连续执行模式

hotfix 默认连续执行；`auto_transition: false` 时在 phase 边界停下由用户手动推进。无论取值，以下情况必须暂停等用户确认：升级条件、任务 > 3 转入 `hikspine-build` 技能的隔离/执行方式选择、verify 的失败决策与分支处理、归档前最终确认。

## 自动衔接下一阶段

```bash
"$HIKSPINE_BASH" "$HIKSPINE_STATE" next <name>
```

- `NEXT: auto` → 调用 `SKILL` 指向的 skill 继续（`verify` → `hikspine-verify`，`archive` → `hikspine-archive`）
- `NEXT: manual` → 不调用下一 skill，按 `HINT` 提示手动运行
- `NEXT: done` → 流程已完成
