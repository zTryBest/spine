---
name: hikspine
description: "hikspine — 预设驱动、阶段守卫的开发流程，封装 OpenSpec（WHAT）与 Superpowers（HOW）。用 /hikspine（别名 /hs）启动，自动检测阶段并分发。阶段序列来自当前 change 的预设（feature/hotfix/tweak），不写死在脚本里。"
---

# hikspine — 预设驱动的开发流程

OpenSpec 与 Superpowers 围绕同一目标协同。阶段序列、退出守卫、转换副作用**都不写死**——它们来自当前 change 的预设 `presets/<workflow>.json`，状态机 `hikspine-state.sh` 是这些预设的通用解释器。

```
OpenSpec 负责 WHAT  — 提案、spec 生命周期、归档
Superpowers 负责 HOW — brainstorming、计划、TDD、执行、review
```

**核心原则： 预设下 brainstorming/深度设计必不可跳过；`hotfix`/`tweak` 预设可以跳过设计。**

---

## 决策核心（Decision Core）

agent 做决策只需读本节。

### 输出语言规则

以触发本次工作流的用户请求语言作为默认输出语言。恢复已有 change 时，如果现有产物有明确主语言，除非用户明确要求切换，否则保持该语言。

### Step 0 — 脚本 bootstrap（每会话执行一次）

hikspine 是 Claude Code 插件，脚本在插件根目录下。source 定位器一次，后续复用导出的变量，并始终通过 `"$HIKSPINE_BASH"` 调用脚本。

```bash
. "${CLAUDE_PLUGIN_ROOT}/skills/hikspine/scripts/hikspine-env.sh"
# 导出：HIKSPINE_BASH、HIKSPINE_STATE、HIKSPINE_PRESET_JS、HIKSPINE_PRESETS_DIR
if [ -z "${HIKSPINE_STATE:-}" ]; then
  echo "ERROR: 未找到 hikspine 脚本，请确认 hikspine 插件已完整安装。" >&2
fi
```

### Step 1 — 活跃 change 发现与意图判定

1. **Preset 检测优先级最高。** 用户明确描述为满足 hotfix 条件的 bug fix、或满足 tweak 条件的文案/配置/文档微调时，直接用对应预设创建 change。
2. 否则运行 `openspec list --json` 枚举所有活跃 change。

| 活跃 change | 用户输入 | 行为 |
|-------------|---------|------|
| 无 | 非 preset 输入 | → 创建新 change（Step 2，`feature` 预设） |
| 恰好 1 个 | `/hikspine <描述>` | → **询问**：继续该变更 or 创建新变更 |
| 多个 | `/hikspine <描述>` | → **询问**：继续现有（列出清单）or 创建新变更 |
| 恰好 1 个 | `/hikspine`（无描述） | → 自动选中，进入 Step 3 |
| 多个 | `/hikspine`（无描述） | → 列出清单让用户选择 |

### Step 2 — 创建新 change

**2a. 确认 change 名称（阻塞点）。** init 必须先有名称，所以**在创建前**暂停让用户决定 change 名称，不得自动生成或静默推断。名称必须是 **kebab-case 英文**（小写字母、数字、连字符，如 `refine-requirements-doc`）。暂停时给出 2-3 个基于用户描述的推荐名（各附一行范围说明）+ 允许自定义；若用户输入中文或非 kebab-case，转换为合规英文名并回显确认。名称与已有 change 冲突时请用户另选。

**2b. 初始化状态。** 名称确认后：

```bash
"$HIKSPINE_BASH" "$HIKSPINE_STATE" init <change-name> <feature|hotfix|tweak>
```

`init` 依据预设写出 `.hikspine.yaml`（phase = **首个阶段**、预设默认值、运行时字段），并创建 change 目录。注意 **feature 预设首个阶段是 design（头脑风暴优先）**，hotfix/tweak 首个阶段是 open。

**2c. 分发。** 运行 `next <change-name>` 并按 `SKILL:` 行加载第一个阶段 skill（feature → `hikspine-design`；hotfix/tweak → `hikspine-open`）。init 由本步骤统一负责，阶段 skill 不再重复 init。

### Step 3 — 读状态并路由

```bash
"$HIKSPINE_BASH" "$HIKSPINE_STATE" phase <change-name>   # 当前阶段
"$HIKSPINE_BASH" "$HIKSPINE_STATE" next  <change-name>   # 该阶段归属哪个 skill
```

`next` 输出 `NEXT: auto|manual|done` 和 `SKILL: <name>`，据此路由。phase→skill 映射在预设里，**不在本文件硬编码**。

**断点恢复规则**（每次恢复上下文都重跑 Step 0–1，不依赖对话历史）：
- `next` 输出 `NEXT: done`（已归档）→ 流程完成。
- `phase: verify` 且 `verify_result: fail` → 验证失败阻塞点：暂停询问用户修复还是接受偏差。仅当用户选「修复」后才运行 `transition <name> fail` 并路由到 build。
- 其他情况分发到 `next` 给出的 skill。
- **续传辅助**：进入某阶段前可运行 `"$HIKSPINE_BASH" "$HIKSPINE_STATE" step-list <name>` 查看该阶段已 done/skipped/failed 的步骤，避免重复执行已完成的 step（各步骤驱动 skill 用 `step-record` 记录）。

### 阶段推进协议

每个阶段 skill 退出前运行带守卫的转换：

```bash
"$HIKSPINE_BASH" "$HIKSPINE_STATE" transition <change-name> complete   # 推进
"$HIKSPINE_BASH" "$HIKSPINE_STATE" transition <change-name> fail       # 回退（如 verify 失败）
```

- `transition complete` 先跑当前阶段的**退出守卫**（预设里声明的 artifacts + 状态证据）。守卫失败会打印 `[FAIL]` 原因且**不推进**——去补齐证据，不要强改 phase。
- 转换成功后运行 `next <change-name>` 决定是否自动调用下一 skill（`NEXT: auto`）或暂停（`NEXT: manual`，当 `auto_transition: false`）。**phase 推进始终发生；`auto_transition` 只控制是否自动调用下一个 skill。**
- 仅用于修复的逃生通道（绕过守卫，谨慎使用）：
  `HIKSPINE_FORCE_PHASE=1 "$HIKSPINE_BASH" "$HIKSPINE_STATE" set <name> phase <value>`

---

## 决策点是阻塞点

到达下列任一节点，**必须停住**，通过当前平台的输入/确认机制获取用户明确选择。不得用默认值、推荐或历史偏好代替。用户明确选择后才写状态、才继续。

1. open 阶段 proposal/design/tasks 审视确认
2. brainstorming 确认设计方案（feature 预设）
3. build 阶段工作方式配置：隔离方式（`branch`/`worktree`）+ 执行方式（`build_mode`）+ TDD 方式（feature 预设）
4. verify 不通过时决定修复或接受偏差
5. finishing-branch 选择分支处理方式
6. 执行归档前的最终确认
7. 遇到预设升级条件（hotfix/tweak → feature）
8. build 阶段范围扩张需重新设计或拆分新 change

**红旗清单** — 出现以下想法立即停止：

| Agent 心理 | 实际风险 |
|-----------|---------|
| "用户应该会同意" | 不能替用户决策，必须询问 |
| "小改动不需要确认" | 决策点无大小之分 |
| "上次选过 A" | 历史 ≠ 当前同意 |
| "我解释了，用户没反对" | 没反对 ≠ 同意 |
| "走到这里应该没问题" | 未通过 ≠ 通过，检查 verify_result |

---

## 预设选择条件

**用 `hotfix`**（否则升级 `feature`）：单个 bug fix、< 3 文件、无架构/schema 变更、无新 public API。

**用 `tweak`**（否则升级 `feature`）：文案/配置/文档微调、< 5 文件、无新 capability、无需 delta spec。

**升级到 `feature`** 的任一条件：3+ 文件（hotfix）/ 5+ 文件（tweak）、架构或 schema 变更、新 capability、需要 delta spec、跨模块协调。触发升级时阻塞确认，再创建设计产物并把 change 迁到 `feature` 预设。

---

## 状态模型

| 文件 | 归属 | 用途 |
|------|------|------|
| `.openspec.yaml` | OpenSpec | spec 生命周期、change 元数据 |
| `.hikspine.yaml` | hikspine | workflow（预设名）、phase、执行方式、验证状态 |

`.hikspine.yaml` 关键字段：`workflow`（预设名）、`phase`、`build_mode`、`isolation`、`tdd_mode`、`review_mode`、`verify_result`、`verification_report`、`branch_status`、`auto_transition`、`archived`。所有写入都经 `hikspine-state.sh`——它是 agent 唯一的状态接口。禁止手改 `.hikspine.yaml`，禁止直接 set `phase`（会绕过守卫）。

## 阶段 skill

**用户唯一入口是 `/hikspine`（别名 `/hs`）。** 阶段 skill（`hikspine-open`、`hikspine-design`、`hikspine-build`、`hikspine-verify`、`hikspine-archive`、`hikspine-hotfix`、`hikspine-tweak`）是内部步骤，由本 orchestrator 通过 Skill 工具按 `hikspine-state.sh next` 的 `SKILL:` 行分发加载，**通常无需用户直接调用**。即使中途中断或上下文压缩，用户也只需再次运行 `/hikspine`——它会重新检测阶段并从断点续传。这些阶段 skill 封装了 OpenSpec 与 Superpowers skill。
