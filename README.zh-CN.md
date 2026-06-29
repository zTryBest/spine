# hikspine

面向 Claude Code 的 skill-first 工作流内核。

Hikspine 用来降低 AI 编程流程漂移：它会明确当前阶段、当前节点、建议或必须使用的 skill，以及哪些机器可检查的产物契约还没满足。它以 Claude Code plugin 形式分发，但用户入口是 **skill**，不是 slash-command 文件。

## 当前结构

```text
skills/hikspine/SKILL.md
  用户入口。用户可以输入 "/hs ..." 或 "用 hikspine ..." 触发这个 skill。

src/hikspine.mjs
  很薄的公开 CLI。Agent 主循环是 next + decide；skills、workflows、changes、board、ui 是只读列表/看板。

src/store.mjs
  配置、workflow 加载、状态文件位置、active change。

src/transitions.mjs
  决策驱动的状态流转与回退。

src/skills.mjs
  Skill 发现。把 workflow 的 capabilities（真实 Claude Code skill 名）按 Claude Code 读取的同一批文件系统位置解析出来。没有 registry。

src/server.mjs、dashboard/
  本地 web 看板（状态视图），用 hikspine ui 启动。

src/workflows/
  内置工作流：new、feature、fix。

rules/
  插件作者维护的项目规则，会被复制到 `.claude/rules`。

hooks/guard.mjs
  Claude Code PreToolUse hook 桥接，直接调用 guard 逻辑。
```

仓库里不再提供 Claude command 文件。`/hs` 只是触发 `hikspine` skill 的文本约定。

## 安装

通过团队的 Claude Code plugin marketplace 或本地 plugin source 安装这个仓库。

如果工作流使用 OpenSpec 产物，OpenSpec CLI 仍需要在 PATH 中可用。

不需要项目初始化。用户第一次在项目里调用 `hikspine next` 时，Hikspine 会创建 `.claude/rules`，并把插件 `rules/` 目录下的 Markdown 规则复制进去。插件规则更新时，未被本地修改过的托管规则会自动更新；项目侧手改过的规则不会被覆盖。

Claude Code 的无路径 `.claude/rules` 通常在 session 启动时加载，所以如果规则是在当前 session 开始后才创建的，不能只依赖自动加载。`next --json` 在复制或更新规则时会返回 `projectRules.readNow`；`hikspine` skill 会要求 Agent 立刻读取这些路径，让当前 session 也生效。

## 用户怎么用

用户可以直接在 Claude Code 里说：

```text
/hs start entrance-monitor with workflow <workflow-id>
```

Claude 应加载 `hikspine` skill，然后运行：

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
node "$HIKSPINE_ENGINE" next entrance-monitor --workflow <workflow-id> --json
```

注意：Bash 工具每次调用都是新的 shell。定位 runtime 和执行 `node "$HIKSPINE_ENGINE" ...` 必须放在同一次 Bash 调用里；不要先单独 source，再在下一次 Bash 调用里读取环境变量。

不需要项目初始化。如果状态不存在，`next <change> --workflow <id>` 会懒创建状态。
同一次 `next` 调用也会确保项目 `.claude/rules` 已存在并包含插件分发的规则。
如果本次调用复制或更新了规则，JSON 响应会包含 `projectRules.readNow`。

## next 协议

主循环只有 `next`：

```text
Agent 调 next
引擎观察文件、目录和检查项
引擎自动推进已经完成的节点
引擎返回当前卡住的节点
Agent 使用相关 skill 并产生产物
Agent 再调 next
```

引擎不再要求 Agent 写 `no_open_questions=true` 这类语义事实，也不需要 Agent 调 `complete/advance`。流程只根据机器可检查的 `exit.checks` 推进。

## 内置工作流

- `new`：`open -> design -> scaffold -> build -> review -> verify`（从 0 到 1）
- `feature`：`open -> design -> build -> review -> verify -> archive`（新需求）
- `fix`：`inspect -> fix -> verify`（bug 或轻量变动）

每个 workflow 都声明一个 `intent`（一句话说明“何时该用这条流程”），供 Agent 路由请求；见 `hikspine workflows --json`。

自定义 workflow 是一等入口。把 workflow 放到：

```text
.hikspine/workflows/<workflow-id>.yaml
```

然后运行：

```bash
node "$HIKSPINE_ENGINE" next <change> --workflow <workflow-id> --json
```

也可以设置项目默认：

```yaml
# .hikspine/config.yaml
version: 1
defaultWorkflow: <workflow-id>
```

`new` 和 `feature` 默认基于 OpenSpec，状态文件放在：

```text
openspec/changes/<change>/.hikspine.yaml
```

`fix` 默认更轻量，状态文件放在：

```text
.hikspine/changes/<change>.yaml
```

## Workflow v2

工作流把 Agent 指导和引擎硬门禁分开：

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
  recommended: []
  output: [openspec-verify-change]
agent:
  rules:
    - Read proposal.md, tasks.md, and specs/ before running brainstorming.
    - Run brainstorming before selecting a design direction; derive questions, options, and tradeoffs from the required inputs.
    - Stop for user confirmation after brainstorming before moving to build.
outputs:
  - key: design_doc
    path: openspec/changes/{change}/design.md
exit:
  checks:
    - file.exists: openspec/changes/{change}/design.md
    - file.contains_headings: { path: openspec/changes/{change}/design.md, headings: [Inputs Reviewed, Brainstorming, Questions From OpenSpec, Options Considered, Tradeoffs, Selected Direction, Company Constraints, Open Questions, User Confirmation] }
    - file.contains_regex: { path: openspec/changes/{change}/design.md, pattern: "^Confirmed by user:\\s*.+" }
    - file.contains: { path: openspec/changes/{change}/design.md, text: openspec/changes/{change}/proposal.md }
    - file.contains: { path: openspec/changes/{change}/design.md, text: openspec/changes/{change}/tasks.md }
    - file.contains: { path: openspec/changes/{change}/design.md, text: openspec/changes/{change}/specs }
```

`inputs.required` 告诉 Agent 某个 skill 运行前必须读取哪些上下文。`skills.required` 告诉 Agent 必须使用什么能力。如果 Claude Code 没有暴露 skill 调用 trace，引擎不会假装自己能验证“skill 是否真的被调用”。真正阻塞流转的是 `exit.checks` 里的可观测产物契约。

内置 `feature` 和 `new-project` 会把设计拆成 `design.brainstorm` 和 `design.confirm`。第一个节点的 `nextSkill` 明确返回 `brainstorming`；第二个节点要求 Agent 停下来让用户确认或调整方案。确认节点会通过 `agent.requiredQuestions` 要求询问技术栈、架构/集成边界等主题。只有 `design.md` 包含 `User Decisions`、`User Confirmation`，并记录 `Technology stack:`、`Confirmed by user:` 等具体用户决策后，build 才会解锁。

后续阶段也沿用同一个约定，不要在引擎里给每个阶段写兜底。比如 build 节点应该把 `design.md` 声明为 planning 的输入，再给 planning step 写 `exit.checks`，这样实现步骤不会早于计划产物开始。如果后续阶段依赖前序阶段的产物契约，就在后续阶段 YAML 里重复关键检查；这样恢复会话或升级 workflow 时，行为仍然显式，而不是写死在引擎里。

## Feature 设计阶段

`feature` 的 design 阶段要求：

- 先运行 brainstorming，再选择设计方向。
- brainstorming 前必须先读取 `proposal.md`、`tasks.md` 和 `specs/`。
- 把头脑风暴结论、备选方案、最终方向、约束和开放问题写入 OpenSpec design.md。

引擎只检查：

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
包含 User Confirmation
包含 Confirmed by user: 确认记录
包含 proposal.md、tasks.md 和 specs 路径引用
```

引擎不判断内容好坏，只判断契约是否落地。

## 支持的检查

当前支持：

- `file.exists`
- `dir.exists`
- `artifact.exists`
- `file.contains`
- `file.contains_regex`
- `file.contains_heading`
- `file.contains_headings`
- `git.has_changes`
- `git.has_source_changes`
- `always.false`

## 项目自定义

可选项目配置：

```yaml
# .hikspine/config.yaml
version: 1
defaultWorkflow: <workflow-id>
guard:
  sourceRoots:
    - src/
    - app/
```

workflow 的 `capabilities` 是真实的 Claude Code skill 名，由文件系统发现解析——没有 registry 需要配置。要让某个 skill 能在某个状态里使用，把它装到 Claude Code 会读取的位置（项目 `.claude/skills`、个人 `~/.claude/skills`，或某个 plugin marketplace），再把它的 `name` 加进该状态的 `capabilities`。运行 `hikspine skills --json` 可以看到这里能发现哪些 skill。

## CLI 命令

除了 `next` + `decide` 这个 Agent 主循环，还有只读列表和 Web 看板用于路由和工具：

```bash
hikspine skills [--json]     # 这里能发现的所有 Claude Code skill（合法 capability 名）
hikspine workflows [--json]  # 可用 workflow（内置 + 项目）及其选择 intent
hikspine changes [--json]    # 所有在跑的 change 及其 workflow、当前状态和下一步
hikspine board [--json]      # 当前项目的看板聚合数据
hikspine ui [--port <n>]     # 本地 Web 看板，默认 http://127.0.0.1:4319
```

- `skills`：扫描 Claude Code 读取的同一批位置（项目 `.claude/skills`、个人 `~/.claude/skills`、`~/.claude/plugins/marketplaces/**/skills` 下的 plugin marketplace，以及本插件 `skills/`），按 skill `name` 去重，项目 skill 覆盖。既是挑选 capability 的数据源，也是合法 capability 名的来源。看板会按 Claude Code scope 分组展示：project、user、local、marketplace。
- `workflows`：列出每个 workflow 的 `intent`（“何时该用这条流程”），供 Agent 路由请求；项目 workflow 按 id 覆盖内置。
- `changes`：并发运行的只读注册表；不会 auto-advance 或改动任何 change。
- `board` / `ui`：读取和 Agent 主循环相同的项目状态。如果是从插件安装目录、用户目录，或不在目标项目里的终端启动看板，需要显式传项目根：

```bash
node "$HIKSPINE_ENGINE" ui --project-root /path/to/project
HIKSPINE_PROJECT_ROOT=/path/to/project node "$HIKSPINE_ENGINE" ui
```

`--project-root` 是全局选项，也适用于 `next`、`decide`、`changes`、`workflows`、`skills` 和 `board`。

在 Claude Code 里，用户也可以直接说“启动 Hikspine UI”或“打开 Hikspine 看板”；`hikspine-ui` skill 会封装同一条命令，并指向当前项目启动看板。

## 验证

```bash
npm test
```
