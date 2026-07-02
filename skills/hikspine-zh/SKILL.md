---
name: hikspine-zh
description: "Use when the user speaks Chinese and wants Hikspine to run or resume a phased Claude Code workflow, choose a workflow, follow next/decide transitions, load capability skills, or start from the cross-platform runtime locator."
---

# Hikspine 中文工作流执行规范

## 运行纪律

- 使用中文回应用户，并让 workflow 产物默认使用中文；代码标识符、命令、路径、API 名称、上游 skill 名称和引用原文保持原样。
- 每次启动或恢复工作，先运行 `next --json`。不要根据记忆、上一次对话或下方路由参考推断当前状态。
- 阶段流转只由 workflow 的 `needs` 和 `decide` 决定。组合进来的 skill 结束、询问是否继续或建议落地产物时，都不是 Hikspine 的阶段边界。
- 除非当前状态 `requiresUser: true`，完成状态工作后不要问用户“是否进入下一阶段”；记录该状态的决策后继续 `next`。
- 如果 Claude Code 的 Skill 工具不可用，或 runtime 返回的 capability skill 无法加载，停下来报告阻塞，不要用内联工作替代。

## 加载 Runtime

Bash 工具每次调用都是新 shell。定位 runtime 和执行 `node "${HIKSPINE_ENGINE:?source the locator block in this same Bash call}" ...` 必须放在同一次 Bash 调用里。

**硬性要求：** 使用本中文入口时，所有 Hikspine 引擎命令都必须同时显式传 `--project-root "$PROJECT_ROOT"` 和 `--locale zh`。不要只依赖 `HIKSPINE_WORKFLOW_LOCALE=zh`，也不要先单独打印 `HIKSPINE_ENGINE`，再在后续 Bash 调用里直接 `node <打印出的路径>`；后续 Bash 不会继承前一次的环境变量，容易回落到英文 workflow 或错误项目目录。

```bash
_hs_norm_root() { local r="${1:-}"; r="${r//\\//}"; while [ "${#r}" -gt 1 ] && [ "${r%/}" != "$r" ]; do r="${r%/}"; done; printf '%s\n' "$r"; }
_hs_env_file=""
for r in "${HIKSPINE_PLUGIN_ROOT:-}" "${CLAUDE_PLUGIN_ROOT:-}" "$(pwd)" "$(git rev-parse --show-toplevel 2>/dev/null || true)"; do
  r="$(_hs_norm_root "$r")"
  if [ -n "$r" ] && [ -f "$r/skills/hikspine/scripts/hikspine-env.sh" ]; then
    _hs_env_file="$r/skills/hikspine/scripts/hikspine-env.sh"
    break
  fi
done
if [ -z "$_hs_env_file" ]; then
  for b in "${HOME:-}" "${USERPROFILE:-}" "${APPDATA:-}" "${LOCALAPPDATA:-}" "/mnt/c/Users" "/mnt/d" "/mnt/e"; do
    [ -n "$b" ] || continue
    f="$(find "$b" -maxdepth 10 -path '*/skills/hikspine/scripts/hikspine-env.sh' -print -quit 2>/dev/null || true)"
    if [ -n "$f" ]; then _hs_env_file="$f"; break; fi
  done
fi
[ -n "$_hs_env_file" ] || { echo "ERROR: cannot locate hikspine-env.sh; set HIKSPINE_PLUGIN_ROOT to the hikspine plugin root." >&2; exit 1; }
. "$_hs_env_file" || exit 1
export HIKSPINE_WORKFLOW_LOCALE=zh
unset _hs_env_file f r b
unset -f _hs_norm_root
```

把目标项目根目录写入 `PROJECT_ROOT` 后再执行引擎命令：

```bash
PROJECT_ROOT="<项目根目录>"
node "${HIKSPINE_ENGINE:?source the locator block in this same Bash call}" workflows --project-root "$PROJECT_ROOT" --locale zh --json
```

`--locale zh` 会让新建 change 优先加载项目级 `.hikspine/workflows/zh/<workflow-id>.yaml`。`workflows`、`next`、`board`、`ui` 会把插件内置 workflow 模板补齐到当前项目 `.hikspine/workflows/`，只复制缺失文件，不覆盖项目已有定制。已有 change 使用状态文件里记录的 `workflowLocale`，不会因为之后切换入口而改变。

引擎命令必须传 `--project-root "$PROJECT_ROOT"`。全新项目第一次 `next` 必须显式指向项目根目录，确保 `openspec/` 和 `.hikspine/` 落在根目录。

## 选择 Workflow

用户没有指定 workflow，且项目没有 `.hikspine/config.yaml` 的 `defaultWorkflow` 时，先列出候选：

```bash
PROJECT_ROOT="<项目根目录>"
node "${HIKSPINE_ENGINE:?source the locator block in this same Bash call}" workflows --project-root "$PROJECT_ROOT" --locale zh --json
```

选择前必须真实检查项目是否已有源码，不要凭需求名称猜测：

```bash
git -C <项目根目录> ls-files | head
ls -A <项目根目录>
```

按真实信号选择：

- `new`: 几乎没有源码的全新/空仓库，从 0 到 1，含脚手架。项目里已有源码时不要选。
- `feature`: 已有代码库里的新需求或较大变更。
- `fix`: bug 修复或小型轻量变动，包含紧急修复。

两个 workflow 都合理时，先向用户确认。选定后启动：

```bash
PROJECT_ROOT="<项目根目录>"
node "${HIKSPINE_ENGINE:?source the locator block in this same Bash call}" next <change> --workflow <workflow-id> --project-root "$PROJECT_ROOT" --locale zh --json
```

恢复已有 change：

```bash
PROJECT_ROOT="<项目根目录>"
node "${HIKSPINE_ENGINE:?source the locator block in this same Bash call}" next <change> --project-root "$PROJECT_ROOT" --locale zh --json
```

多个 change 并行时：

```bash
PROJECT_ROOT="<项目根目录>"
node "${HIKSPINE_ENGINE:?source the locator block in this same Bash call}" changes --project-root "$PROJECT_ROOT" --locale zh --json
```

## 主循环

只用两个动作推进流程：

```bash
PROJECT_ROOT="<项目根目录>"
node "${HIKSPINE_ENGINE:?source the locator block in this same Bash call}" next [change] --project-root "$PROJECT_ROOT" --locale zh --json
node "${HIKSPINE_ENGINE:?source the locator block in this same Bash call}" decide <key> [value] --change <change> --project-root "$PROJECT_ROOT" --locale zh --json
```

执行顺序：

1. 运行 `next --json`，读取 `nextAction`、`current`、`goal`、`forbid`、`rules`、`capabilities`、`needs`、`missing`、`requiresUser`。
2. 按 `goal` 和 `rules` 做当前状态的工作，遵守 `forbid`。
3. 在任何排查、规划、编辑或验证之前，按 `capabilities` 加载适用 skill。
4. 完成一个 `need` 后运行 `decide <key> <value>`。布尔决策可省略 value；结果类决策使用真实结果，如 `review_result pass`、`verify_result fail`。
5. 看 `decide` 返回的新状态继续循环，直到 `complete: true`。

`nextAction` 的含义：

```text
work     加载能力 skill，完成工作，记录 needs，然后继续 next。
confirm  先完成工作，再停下征询用户；得到明确确认后才能 decide 确认类决策。
done     workflow 已完成，无需继续推进。
```

失败回退由 workflow 声明的 `fail_when` / `fail_to` 决定。记录 `fail` 后，下游决策可能被清空，需要从回退状态重新做。

若 `next --json` 返回 `projectRules.readNow`，立刻读取列出的规则文件。

## Capability Skill 加载

每个 capability 都是真实 Claude Code skill 名，必须按标签加载：

```text
required: true    干本状态工作之前必须加载
group: <名称>     同组 skill 可互换，只选择并加载一个
when: <说明>      条件成立时加载
无标签            用途与当前工作匹配时加载
```

加载触发表述固定使用：

```text
**立即执行：** 使用 Skill 工具加载 <skill-name> 技能。禁止跳过此步骤。
```

使用 `next --json` 返回的 capability `id` 作为 `<skill-name>`；有 `ref` 时可按 `ref` 定位。不要维护写死的内置 skill 列表，自定义 workflow 返回的 capability 也按同一规则处理。

## 用户确认点

`requiresUser: true` 时，先把当前状态要求的工作做到可确认，再向用户提出明确问题。得到用户答复前，不得记录确认类决策，例如 `design_confirmed`、`archived`。

技术栈、架构/集成、数据/实时链路、归档和发布类选择必须由用户拍板。确认问题逐项询问，不要一次性抛出大段问卷。

## 看板

当前项目看板：

```bash
PROJECT_ROOT="<项目根目录>"
node "${HIKSPINE_ENGINE:?source the locator block in this same Bash call}" ui --project-root "$PROJECT_ROOT" --locale zh
```

全局看板：

```bash
PROJECT_ROOT="<任一项目根目录>"
node "${HIKSPINE_ENGINE:?source the locator block in this same Bash call}" ui --all --project-root "$PROJECT_ROOT" --locale zh
```

## Workflow 路由参考

这只是路由参考，不代表当前状态；当前状态永远以 `next --json` 为准。

```text
new       scaffold -> brainstorm -> openspec -> design -> build -> review -> verify -> archive -> hido
feature   open -> design -> build -> review -> verify -> archive
fix       inspect -> fix -> verify
```

新增中文 workflow 放当前项目 `.hikspine/workflows/zh/<id>.yaml`，默认语言 workflow 放当前项目 `.hikspine/workflows/<id>.yaml`，传 `--workflow <id>`。插件内置 workflow 只是模板来源，不要直接编辑插件目录里的 workflow。
