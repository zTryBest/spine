---
name: hikspine-verify
description: "hikspine 阶段 4（验证与收尾）。内部阶段步骤，由统一入口 /hikspine（别名 /hs）自动分发，通常无需直接调用。按预设步骤验证实现、处理分支、记录证据。"
---

# hikspine 阶段 4：验证与收尾（Verify，步骤驱动）

本 skill **步骤驱动**：执行预设为 verify 阶段声明的 `steps`（默认 `verify`→`verification-before-completion`，`spec-verify`→`openspec-verify-change`，`finish`→`finishing-a-development-branch`）。

## 前置条件

- 代码已提交（阶段 3 完成），tasks.md 全部完成

## 脚本 bootstrap

```bash
. "${CLAUDE_PLUGIN_ROOT}/skills/hikspine/scripts/hikspine-env.sh"
"$HIKSPINE_BASH" "$HIKSPINE_STATE" check <name> verify
```

验证报告和分支处理说明使用触发本次工作流的用户请求语言。

**幂等性**：可安全重复。若 `verify_result` 已 `pass` 且 `branch_status` 已 `handled`，直接推进；若 `pending`，从头验证。

## 步骤

### 1. 改动规模评估

> 后续增强：自动规模评估（对应 comet 的 `scale`）。当前**人工判定**并写 `verify_mode`：任务数 > 3、delta spec 能力数 > 1、或变更文件数 > 4，任一满足即 `full`，否则 `light`。

若 build 阶段每任务都已提交，工作区 diff 可能低估规模，用 plan 文件头 `base-ref` 提交区间复核：

```bash
PLAN=$("$HIKSPINE_BASH" "$HIKSPINE_STATE" get <name> plan)
BASE_REF=$(grep '^base-ref:' "$PLAN" 2>/dev/null | head -1 | sed 's/^base-ref: *//')
git diff --stat "$BASE_REF"...HEAD
"$HIKSPINE_BASH" "$HIKSPINE_STATE" set <name> verify_mode <light|full>
```

### 2. 依次执行本阶段的 provider 步骤

```bash
"$HIKSPINE_BASH" "$HIKSPINE_STATE" steps <name> verify
# 每行：<role>\t<skill>\t<note>
```

**按输出顺序执行每个步骤**（加载该行 `<skill>`），并应用以下条件与决策点：

- `verify`（默认 `verification-before-completion`）：**始终执行**。按 `verify_mode` 分支：
  - **轻量验证**（6 项）：① tasks.md 全 `[x]` ② 改动文件与 tasks 一致（`git diff --stat`/`<base-ref>...HEAD`）③ 编译通过 ④ 相关测试通过 ⑤ 无明显安全问题 ⑥ 代码审查：`review_mode` 为 `standard`/`thorough` 时加载 `requesting-code-review` 只查正确性/安全/边界；`off` 时跳过并记录原因。通过标准：6 项全 OK，无 CRITICAL/IMPORTANT。
  - **完整验证**：在轻量 6 项基础上，对照检查实现符合 `design.md`/Design Doc、能力规格场景全过（读 `specs/*/spec.md`）、proposal 目标满足、delta spec 与 design doc 无矛盾。
- `spec-verify`（默认 `openspec-verify-change`）：**仅 `verify_mode: full` 时执行**；`light` 时跳过。用其验证 OpenSpec 规格覆盖。
- `finish`（默认 `finishing-a-development-branch`）：**始终执行**。分支处理选项（本地合并 / 推送建 PR / 保持分支 / 丢弃）是**用户决策点**，**必须暂停等用户选择**，不得自行选择。用户完成选择且操作完成后才允许写 `branch_status: handled`。
- 其他 role（如未来插入的步骤）：按其 `<note>` 执行。

若某步 skill 不可用，停止流程并提示安装/启用对应来源。

**每执行完一个步骤记录状态**：`"$HIKSPINE_BASH" "$HIKSPINE_STATE" step-record <name> verify <role> done`（`spec-verify` 在 light 模式跳过时→`skipped` 带原因，失败→`failed`）。

**验证失败决策（阻塞点）**：任一验证步骤发现失败时，**必须暂停等用户决定修复或接受偏差**，不得自动回退或自动加载 `hikspine-build` 技能。列出失败项 + 严重程度（CRITICAL/IMPORTANT/WARNING/SUGGESTION，不确定时降级，仅构建/测试/安全用 CRITICAL）+ 推荐处理。
- **全部修复**：`transition <name> fail` 然后加载 `hikspine-build` 技能修复
- **逐项处理**：CRITICAL/IMPORTANT 必须修复；WARNING/SUGGESTION 可接受偏差但须在验证报告记录原因和影响。存在任何 CRITICAL/IMPORTANT 时不允许全部接受

> `transition <name> fail` 回 build 不重置 `branch_status`；若首次 verify 已处理分支，修复后再次 verify 可 `set <name> branch_status handled` 保留结果。

**Spec 漂移处理**（用户决策点）：完整验证若发现 delta spec 有内容但 design doc 未体现，**必须以单选题暂停**：A design doc 追加 "Implementation Divergence" 节（verify 阶段允许产物）；B `transition <name> fail` 回 build 用 `brainstorming` 更新；C 确认可接受继续（归档时标 `superseded-by-main-spec`）。

### 3. 记录验证证据

验证报告落盘并记录；分支处理完成后写状态。不要手动设 `verify_result: pass`，由推进自动完成。

```bash
mkdir -p docs/superpowers/reports
# 将验证结论写入 docs/superpowers/reports/YYYY-MM-DD-<name>-verify.md
"$HIKSPINE_BASH" "$HIKSPINE_STATE" set <name> verification_report docs/superpowers/reports/YYYY-MM-DD-<name>-verify.md
"$HIKSPINE_BASH" "$HIKSPINE_STATE" set <name> branch_status handled
```

## 退出条件

- 本阶段所有适用 `steps` 已执行（`spec-verify` 仅 full 时）
- 验证报告通过，分支已处理
- `verification_report` 指向存在的报告文件，`branch_status: handled`（守卫强制）
- **阶段守卫**：

```bash
"$HIKSPINE_BASH" "$HIKSPINE_STATE" transition <name> complete
```

PASS 后自动推进到 `phase: archive`、`verify_result: pass`、`verified_at`。

## 自动衔接下一阶段

```bash
"$HIKSPINE_BASH" "$HIKSPINE_STATE" next <name>
```

- `NEXT: auto` → 加载 `SKILL` 指向的 skill（`hikspine-archive`）
- `NEXT: manual` → 不调用下一 skill，按 `HINT` 提示手动运行 `/hikspine`
- `NEXT: done` → 流程已完成

> 注意：无论 auto/manual，`hikspine-archive` 进入后必须先执行归档前最终确认，不得因验证通过就自动归档。
