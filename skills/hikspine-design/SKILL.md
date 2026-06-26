---
name: hikspine-design
description: "hikspine 阶段 1（深度设计）。内部阶段步骤，由统一入口 /hikspine（别名 /hs）自动分发，通常无需直接调用。feature 预设第一步：按预设声明的 provider 步骤依次执行（默认 OpenSpec 简单澄清 → Superpowers 深度头脑风暴），产出 Design Doc，随后 open 阶段用 OpenSpec 形式化。"
---

# hikspine 阶段 1：深度设计（Design，feature 预设第一步）

feature 预设**头脑风暴优先的 hybrid**：本 skill 按预设为 design 阶段声明的 **provider 步骤(steps)** 依次执行——默认 `openspec-explore`(简单澄清) → `brainstorming`(深度头脑风暴) —— 产出 Design Doc，再由 `hikspine-open` 用 OpenSpec 把结论形式化。

**本 skill 是步骤驱动的**：步骤来自 `feature.json` 的 `design.steps`。
- **换某步用的 skill**（例如将来 OpenSpec 把澄清做强、想把 clarify 换成别的）：在 `.hikspine/config.json` 的 `providers` 里加覆盖（优先级 `<workflow>.<phase>.<role>` > `<phase>.<role>` > `<role>`），不动本 skill。
- **插入新能力**（例如 CodeGraph 语义索引、公司代码脚手架）：插件级在预设 `design.steps` 加一项；**项目级**在 `.hikspine/config.json` 的 `extra_steps`（如 `design.after_clarify`）加一项——不 fork 插件。两者本 skill 都会自动按顺序执行。

## 前置条件

- `.hikspine.yaml` 已由 orchestrator Step 2 初始化（phase=design），change 名称已确认
- 尚无 Design Doc

## 脚本 bootstrap

```bash
. "${CLAUDE_PLUGIN_ROOT}/skills/hikspine/scripts/hikspine-env.sh"
"$HIKSPINE_BASH" "$HIKSPINE_STATE" check <name> design
```

**幂等性**：可安全重复。若 `design_doc` 已记录且文件存在，确认其与当前讨论一致后再决定是否重做。

## 步骤

### 0. 输出语言约束

所有 prompt、Design Doc 使用触发本次工作流的用户请求语言。

### 1. 依次执行本阶段的 provider 步骤

读取本阶段的有序步骤（已应用 `.hikspine/config.json` 的 provider 覆盖和 extra_steps 插入）：

```bash
"$HIKSPINE_BASH" "$HIKSPINE_STATE" steps <name> design
# 输出每行：<role>\t<skill>\t<note>
```

**按输出顺序，对每个步骤：使用 Skill 工具加载该行的 `<skill>`，按其 `<role>` 的职责执行。** 禁止跳过任何步骤。常见 role：

- `clarify`（默认 `openspec-explore`）：**简单澄清**——快速对齐问题空间、目标、范围、关键约束。这是轻量的初步澄清，不求深入。
- `brainstorm`（默认 `brainstorming`）：**深度头脑风暴**——在澄清基础上做技术方案探索：架构、数据流、关键技术选型与风险、2-3 个候选方案对比、测试策略、验收场景。不要把一轮 Q&A 当作充分，必须持续提问与用户对齐。
- 其他 role（如未来的 `index` → CodeGraph 语义索引、`scaffold` → 公司脚手架）：按该步骤的 `<note>` 执行所加载 skill 的职责，产出物作为后续步骤的输入。

加载某步的 skill 时，ARGUMENTS 必须包含：`Language: 使用触发本次工作流的用户请求语言`。若某步的 skill 不可用，停止流程并提示安装/启用对应来源，不得用普通对话替代。

**每执行完一个步骤记录状态**（便于断点恢复与审计）：

```bash
"$HIKSPINE_BASH" "$HIKSPINE_STATE" step-record <name> design <role> done [evidence-path]
# 跳过该步：... step-record <name> design <role> skipped "" "<原因>"
# 步骤失败：... step-record <name> design <role> failed
```

> 设计要点：本步骤**不点名固定 skill**，而是执行 `steps` 解析出的结果。这就是"换 provider 改配置、加能力加 step、skill 不动"的落点。

### 1a. 需求知识源（扩展点，可选）

在 `clarify` / `brainstorm` 提问用户前，先消费项目声明的需求知识源以减少提问轮次：读取 `.hikspine/config.json` 的 `requirement_sources`（不存在或为空则跳过）。对每个 `when: clarify` 的源（`type: mcp`），调用其 `server` 上的 `tools` 检索历史需求/相似规格，用结果预填澄清；已能从知识源确认的点不必再问用户。知识源不可用时不阻塞，转人工澄清并告知用户。本扩展点**不点名任何具体 MCP**，加/换/删源只改配置。详见 README「连接需求知识库 MCP」。

### 1b. PRD 拆分判断（阻塞点，按需）

若步骤执行中发现需求是大型 PRD、或含多个可独立设计/构建/验证/归档的 capability/模块/里程碑，**必须暂停并等待用户选择**是否拆分（选项至少：拆分为多个 / 保持单个 / 先调整拆分方案）。拆分时每个拆分项各走一遍 hikspine 流程（orchestrator 重新确认名称 + init）。

### 1c. 用户确认设计方案（阻塞点）

所有步骤执行完、形成设计方案后，**必须暂停并等待用户明确确认**。确认前不得创建 Design Doc、不得写 `design_doc`、不得推进阶段。暂停时只呈现要点：采用的技术方案、关键权衡与风险、测试策略、目标/非目标/范围/验收场景摘要。用户要求调整则继续迭代直到确认。

为支持上下文压缩恢复，可在 `openspec/changes/<name>/.hikspine/handoff/brainstorm-summary.md` 增量记录已确认事实、关键约束、候选方案、权衡风险、测试策略，未确认项标 "pending"。

### 2. 创建 Design Doc

基于全部步骤的产出创建 Design Doc，写入 `docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md`。最小前置元数据：

```yaml
---
hikspine_change: <name>
role: technical-design
canonical_spec: openspec
---
```

应包含确认后的：目标/非目标/范围、技术方案、关键权衡与风险、测试策略、验收场景。它是下一步 `hikspine-open` 用 OpenSpec 形式化 proposal/design/tasks 的输入。

### 3. 更新状态并推进

```bash
"$HIKSPINE_BASH" "$HIKSPINE_STATE" set <name> design_doc docs/superpowers/specs/YYYY-MM-DD-topic-design.md
"$HIKSPINE_BASH" "$HIKSPINE_STATE" transition <name> complete
```

## 退出条件

- 本阶段所有 `steps` 已执行
- Design Doc 已创建保存，前置元数据含 `hikspine_change`、`role: technical-design`、`canonical_spec: openspec`
- 用户已确认设计方案
- `design_doc` 已写入 `.hikspine.yaml` 且指向存在的文件（守卫强制）
- **阶段守卫**：`transition <name> complete` 全部 PASS 后自动推进到 `phase: open`

## 自动衔接下一阶段

```bash
"$HIKSPINE_BASH" "$HIKSPINE_STATE" next <name>
```

- `NEXT: auto` → 加载 `SKILL` 指向的 skill（`hikspine-open`）把方案形式化
- `NEXT: manual` → 不调用下一 skill，按 `HINT` 提示手动运行 `/hikspine`
- `NEXT: done` → 流程已完成
