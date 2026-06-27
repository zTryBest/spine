---
name: hikspine-engine-zh
description: "Hikspine 引擎中文说明。Use when the user wants Chinese documentation or clarification for Hikspine's plugin-level engine, runtime, next protocol, workflow phases, skill orchestration, guard hook, or cross-platform path usage."
---

# Hikspine 引擎中文说明

这个 skill 是 `hikspine` 主 skill 的中文参考版本。真正执行工作流时优先使用 `hikspine` skill；本文件用于解释引擎边界、状态文件、`next` 协议和守卫行为。

## 核心边界

```text
skill 负责触发和指导 Agent
bin/hikspine.mjs 只提供很薄的 CLI 入口
lib/store.mjs 负责状态文件和 workflow 加载
lib/checks.mjs 负责机器可检查的 exit checks 和 guard 判断
lib/transitions.mjs 负责自动状态流转
lib/rules.mjs 负责把插件内置 Markdown 规则分发到项目 .claude/rules
hooks/guard.mjs 负责 Claude Code hook 桥接
builtin/workflows/*.yaml 负责内置工作流定义
```

Hikspine 不是 Claude Code command。用户输入 `/hs ...` 时，把它当作自然语言触发 `hikspine` skill。

## 跨平台加载 Runtime

不要假设 `CLAUDE_PLUGIN_ROOT` 一定存在。先定位 plugin root，再 source 定位器：

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
unset _hs_env_file f r b
unset -f _hs_norm_root
```

注意：Bash 工具每次调用都是新的 shell。定位 runtime 和执行 `node "$HIKSPINE_ENGINE" ...` 必须放在同一次 Bash 调用里；不要先单独 source，再在下一次 Bash 调用里读取环境变量。

之后统一调用：

```bash
node "$HIKSPINE_ENGINE" next <change> --workflow <workflow-id> --json
node "$HIKSPINE_ENGINE" next <change> --json
```

如果用户或项目指定了 workflow，就使用那个 id。新增 workflow 时，把文件放到 `.hikspine/workflows/<workflow-id>.yaml`，然后传 `--workflow <workflow-id>`；不需要修改入口 skill。如果 `.hikspine/config.yaml` 配了 `defaultWorkflow`，新 change 可以省略 `--workflow`。

## 为什么只保留 next

Agent 不应该调用一堆状态写入命令。Hikspine 的主循环是：

```text
Agent 调 next
引擎观察产物并自动流转
引擎返回当前卡住的 phase/node 和缺失检查
Agent 使用相关 skill 产生产物
Agent 再调 next
```

也就是说，`next` 同时负责观察、判断和返回下一步。没有项目 init，也没有 `fact/artifact/complete/advance` 这套写回协议。

`next` 还会在项目里幂等创建 `.claude/rules`，并复制插件 `rules/` 目录下的 Markdown 规则。插件规则更新时，未被项目侧修改过的托管规则会自动更新；如果项目里已经手改过对应规则，引擎不会覆盖。

Claude Code 的无路径规则通常在 session 启动时进入上下文，所以如果 `.claude/rules` 是当前 session 开始后才由 `next` 创建的，不要假设它会自动立即生效。`next --json` 会返回 `projectRules.readNow`，Agent 应该立刻读取这些文件，让本次 session 也吃到规则。

## 语言规则

根据用户当前触发工作流的输入语言决定 Agent 执行语言。面向用户的解释、澄清问题、阶段总结和工作流产物默认使用同一种语言；如果用户后续显式切换语言，以最新用户语言为准。代码标识符、命令、文件路径、API 名称和引用原文保持原样。

## Workflow v2 的设计

工作流不要用“语义 done”做流转条件。引擎是代码，只能判断可观测事实。

推荐结构：

```yaml
inputs:
  required:
    - key: proposal
      path: openspec/changes/{change}/proposal.md
      useBefore: [brainstorming]
    - key: tasks
      path: openspec/changes/{change}/tasks.md
      useBefore: [brainstorming]
    - key: specs
      path: openspec/changes/{change}/specs
      useBefore: [brainstorming]
skills:
  required: [brainstorming]
  recommended: [company.knowledge, company.platform-design]
  output: [openspec.design]
agent:
  rules:
    - Read proposal.md, tasks.md, and specs/ before running brainstorming.
    - Run brainstorming before selecting a design direction; derive questions, options, and tradeoffs from the required inputs.
outputs:
  - key: design_doc
    path: openspec/changes/{change}/design.md
exit:
  checks:
    - file.exists: openspec/changes/{change}/design.md
    - file.contains_headings: { path: openspec/changes/{change}/design.md, headings: [Inputs Reviewed, Brainstorming, Questions From OpenSpec, Options Considered, Tradeoffs, Selected Direction, Company Constraints, Open Questions] }
    - file.contains: { path: openspec/changes/{change}/design.md, text: openspec/changes/{change}/proposal.md }
    - file.contains: { path: openspec/changes/{change}/design.md, text: openspec/changes/{change}/tasks.md }
    - file.contains: { path: openspec/changes/{change}/design.md, text: openspec/changes/{change}/specs }
```

`inputs.required` 是给 Agent 的上下文依赖要求；`skills.required` 是给 Agent 的强执行要求。如果没有 Claude Code 原生 skill 调用 trace，引擎不会假装自己能验证“skill 是否真的调用”。真正阻塞流转的是 `exit.checks` 里的机器检查。

后续阶段也沿用同一个 YAML 约定，不要在引擎里给每个阶段写兜底。比如 build 节点应该把 `design.md` 声明为 planning 的输入，再给 planning step 写 `exit.checks`，这样实现步骤不会早于计划产物开始。如果后续阶段依赖前序阶段的产物契约，就在后续阶段 YAML 里重复关键检查；这样恢复会话或升级 workflow 时，行为仍然显式，而不是写死在引擎里。

## Feature 设计阶段

`feature` 工作流的设计阶段要求：

- 先运行 brainstorming，再选设计方向。
- brainstorming 前必须先读取 `proposal.md`、`tasks.md` 和 `specs/`。
- 涉及公司框架、组件、平台、中间件、权限、监控、发布、历史系统时，先咨询 `company.knowledge`。
- 需要平台或脚手架判断时，使用 `company.platform-design`。
- 把头脑风暴结论、备选方案、最终方向、公司约束和开放问题写入 OpenSpec design.md。

引擎检查：

```text
openspec/changes/<change>/design.md 存在
包含 Inputs Reviewed
包含 Brainstorming
包含 Questions From OpenSpec
包含 Options Considered
包含 Tradeoffs
包含 Selected Direction
包含 Company Constraints
包含 Open Questions
包含 proposal.md、tasks.md 和 specs 路径引用
```

引擎不判断内容好坏，只判断契约是否落地。

## 状态文件

OpenSpec-backed 工作流：

```text
openspec/changes/<change>/.hikspine.yaml
```

轻量工作流：

```text
.hikspine/changes/<change>.yaml
```

状态文件记录当前 phase/node、节点状态、产物路径和历史。不要手动改 `current.phase`、`current.node` 或 node status。

## 守卫

守卫在 hook 里执行，不需要 Agent 调用。`hooks/guard.mjs` 会直接调用 `lib/checks.mjs`：

```text
PreToolUse -> hooks/guard.sh -> hooks/guard.mjs -> checkGuard(...)
```

默认规则：

- `open`、`design`、`archive` 等声明 `forbid: [write-source]` 的阶段禁止写源码。
- OpenSpec 产物和 `.hikspine` 状态文件不视为源码。
- `build`、`fix`、`patch` 等实现阶段允许写源码。

守卫是流程护栏，不是权限沙箱。真正权限隔离仍依赖 Claude Code 自身权限设置。
