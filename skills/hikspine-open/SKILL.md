---
name: hikspine-open
description: "hikspine 开启 / 形式化阶段。内部阶段步骤，由统一入口 /hikspine（别名 /hs）自动分发，通常无需直接调用。按预设声明的步骤用 OpenSpec 把需求形式化为 change 结构（proposal + design + tasks）。feature 里它在 brainstorming 之后形式化 Design Doc；hotfix/tweak 里它是第一步。"
---

# hikspine 开启 / 形式化（Open，步骤驱动）

用 OpenSpec 创建 change 的正式产物（proposal/design/tasks）。本 skill **步骤驱动**：执行预设为 open 阶段声明的 `steps`（默认 `formalize`→`openspec-propose`）。

- **feature 预设**：本阶段在 `hikspine-design`（brainstorming）**之后**，输入是已确认的 Design Doc。
- **hotfix/tweak 预设**：本阶段是第一步，直接从用户需求精简形式化。

> change 名称确认与 `.hikspine.yaml` 初始化已由 orchestrator Step 2 完成，本 skill **不重复 init 或确认名称**。
> 换某步的 skill：在 `.hikspine/config.json` 的 `providers` 里加覆盖。插入新步骤（如脚手架）：预设 `open.steps` 加一项（插件级），或 `.hikspine/config.json` 的 `extra_steps`（如 `open.after_formalize`）加一项（项目级，不 fork）。本 skill 都会自动按顺序执行。

## 脚本 bootstrap

```bash
. "${CLAUDE_PLUGIN_ROOT}/skills/hikspine/scripts/hikspine-env.sh"
"$HIKSPINE_BASH" "$HIKSPINE_STATE" check <name> open
```

## 步骤

### 0. 输出语言约束

传给 OpenSpec 的每个 prompt 和产物请求都带输出语言约束：使用触发本次工作流的用户请求语言。

### 1. 准备形式化输入

- **feature**：读取 Design Doc（`design_doc` 指向的文件），它已含确认后的目标/非目标/范围、技术方案、测试策略、验收场景，作为 `openspec-propose` 的输入。
- **hotfix/tweak**：无 Design Doc；小范围修复通常无需长探索。

### 2. 依次执行本阶段的 provider 步骤

```bash
"$HIKSPINE_BASH" "$HIKSPINE_STATE" steps <name> open
# 每行：<role>\t<skill>\t<note>
```

**按输出顺序，对每个步骤：使用 Skill 工具加载该行的 `<skill>` 执行。** 禁止跳过任何步骤。已知 role：

- `formalize`（默认 `openspec-propose`）：一步生成 change 产物。**feature 预设下务必以 Design Doc 内容为准填充**（proposal 目标/范围、design 方案、tasks 任务边界都与 Design Doc 一致，不另起炉灶）。
- 其他 role（如未来的 `scaffold` → 公司代码脚手架）：按该步骤 `<note>` 执行所加载 skill 的职责，产物作为后续输入。

加载步骤 skill 时 ARGUMENTS 含 `Language:` 约束。若某步 skill 不可用，停止流程并提示安装/启用对应来源。

**每执行完一个步骤记录状态**：`"$HIKSPINE_BASH" "$HIKSPINE_STATE" step-record <name> open <role> done`（跳过→`skipped` 带原因，失败→`failed`）。

确认以下产物已生成且非空：

```
openspec/changes/<name>/
├── .openspec.yaml
├── proposal.md       # Why + What：问题、目标、范围、非目标
├── design.md         # How（高层）：架构决策、方案选择（与 Design Doc 一致）
└── tasks.md          # 任务清单（checkbox）
```

**命名与范围守卫**：change 范围必须与用户确认的需求/Design Doc 一致，不得自行扩大或缩小。

### 3. 内容完整性检查

确认三个文档内容完整：proposal.md（问题背景、目标、范围、非目标）、design.md（高层架构决策、方案选择、数据流）、tasks.md（任务列表，每个任务有清晰描述）。任一缺失或为空，返回 Step 2 补齐。

**幂等性**：可安全重复。若产物已存在且完整，跳过已完成步骤。

### 4. 用户审视与确认（阻塞点）

产物生成且完整性检查通过后，**必须暂停并等待用户确认**。以单选题呈现摘要（proposal/design/tasks 要点）和选项：
- 「确认，进入下一阶段」— 执行退出条件
- 「需要调整」— 附调整说明，修改后再次确认（feature 下若涉及方案层面改动，回到 `hikspine-design` 的 brainstorming）

## 退出条件

- 本阶段所有 `steps` 已执行
- proposal.md、design.md、tasks.md 均生成且内容完整；feature 下与 Design Doc 一致
- **用户已确认**
- **阶段守卫**：

```bash
"$HIKSPINE_BASH" "$HIKSPINE_STATE" transition <name> complete
```

守卫 PASS 后自动推进到 `phase: build`。失败会打印 `[FAIL]` 原因，补齐产物，不要强改 phase。

## 自动衔接下一阶段

```bash
"$HIKSPINE_BASH" "$HIKSPINE_STATE" next <name>
```

- `NEXT: auto` → 加载 `SKILL` 指向的 skill 进入 build（feature→`hikspine-build`，hotfix→`hikspine-hotfix`，tweak→`hikspine-tweak`）
- `NEXT: manual` → 不调用下一 skill，按 `HINT` 提示手动运行 `/hikspine`
- `NEXT: done` → 流程已完成
