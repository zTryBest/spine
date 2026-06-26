---
name: hikspine-archive
description: "hikspine 阶段 5（归档）。内部阶段步骤，由统一入口 /hikspine（别名 /hs）自动分发，通常无需直接调用。按预设步骤合并主 spec、标注 design doc/plan、归档 change。"
---

# hikspine 阶段 5：归档（Archive，步骤驱动）

本 skill **步骤驱动**：执行预设为 archive 阶段声明的 `steps`（默认 `archive`→`openspec-archive-change`）。

## 前置条件

- 验证已通过（阶段 4 完成），分支已处理
- `.hikspine.yaml` 中 `verify_result: pass`

## 脚本 bootstrap

```bash
. "${CLAUDE_PLUGIN_ROOT}/skills/hikspine/scripts/hikspine-env.sh"
"$HIKSPINE_BASH" "$HIKSPINE_STATE" check <name> archive
```

归档摘要使用触发本次工作流的用户请求语言。

## 步骤

### 1. 归档前最终确认（阻塞点）

**必须暂停并等待用户确认是否立即归档**。确认前不得执行任何归档动作。展示摘要：change 名称、验证报告路径与结论、分支处理状态、不可逆动作（合并主 spec、标注 design doc/plan、移动 change 到 archive 目录）。

单选选项：
- 「确认归档」— 继续 Step 2
- 「需要调整或重新验证」— 不归档；用修复逃生通道回 verify：

  ```bash
  HIKSPINE_FORCE_PHASE=1 "$HIKSPINE_BASH" "$HIKSPINE_STATE" set <name> phase verify
  "$HIKSPINE_BASH" "$HIKSPINE_STATE" set <name> verify_result pending
  ```

  再加载 `hikspine-verify` 技能。
- 「暂不归档」— 保留 `phase: archive`，等用户稍后再次运行 `/hikspine`（会路由回 archive）

只有选「确认归档」后才继续。

### 2. 标注关联文档

- Design Doc（`docs/superpowers/specs/`）追加 `archived-with: <name>` 和 `status`
- Plan（`docs/superpowers/plans/`）追加 `archived-with: <name>`

### 3. 标记 hikspine 状态为已归档

**在 change 目录被移动前**执行，确保状态机能定位状态文件：

```bash
"$HIKSPINE_BASH" "$HIKSPINE_STATE" transition <name> complete
```

archive 为终态阶段，该转换将 `archived` 置为 `true`。

### 4. 依次执行本阶段的 provider 步骤

```bash
"$HIKSPINE_BASH" "$HIKSPINE_STATE" steps <name> archive
# 每行：<role>\t<skill>\t<note>
```

**按输出顺序，对每个步骤：使用 Skill 工具加载该行的 `<skill>` 执行。** 已知 role：

- `archive`（默认 `openspec-archive-change`）：按 `ADDED/MODIFIED/REMOVED/RENAMED` delta 语义把 delta spec 合并进主 spec，并把 change 移动到归档目录。归档后校验主 spec 无残留 delta-only section。（若只需同步 spec 不归档，改用 `openspec-sync-specs`。）
- 其他 role（如未来的发布/通知步骤）：按其 `<note>` 执行所加载 skill 的职责。

> 注意：归档步骤会移动 change 目录，因此 `step-record` 须在归档步骤**执行前**对其它步骤记录；归档步骤本身完成后目录已移走，不必再记。

## 退出条件

- `.hikspine.yaml` 中 `archived: true`
- 本阶段所有 `steps` 已执行：delta spec 已合并进主 spec、主 spec 无残留 delta-only section、change 已移动到归档目录
- Design Doc / Plan 已标注 `archived-with`

> WARNING：归档移动后**不要再对原 change 名运行 `check`/`transition`**，原活跃目录可能已不存在。

## 完成

hikspine 流程全部完成。开始新工作请运行 `/hikspine`（或 `/hs`）。

```bash
"$HIKSPINE_BASH" "$HIKSPINE_STATE" next <name>   # archived 后输出 NEXT: done
```
