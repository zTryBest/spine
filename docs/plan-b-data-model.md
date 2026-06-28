# Hikspine 方案 B — 可组合状态机数据模型 v0.7

> v0.7 是一次架构落地，替换掉 v0.6 的「phase → node → step + 观察固定产物」模型。
>
> 起因：v0.6 靠 `exit.checks` 观察某个 skill 产出的固定文件来推进（如 `file.contains_heading: design.md`）。
> 这等于把每个 skill 的产出格式硬编码进 workflow，**换一个 skill 就要改 workflow**，无法自由组合。
>
> v0.7 的核心原则：**状态流转，不是文件观察。**
>
> - workflow = **状态 + 决策驱动的流转**（扁平一层，不再有 phase/node/step）。
> - 每个状态声明 **`needs`（skill 无关的决策）** 和 **`capabilities`（可自由组合的 skill）**。
> - 流转只看「该状态要的决策齐没齐」，永远不看某个 skill 产了什么文件。
> - 换/加/重排 skill = 改某个状态的 `capabilities` 列表，**流转图不变** = 自由组合。
>
> 已落地于分支 `codex/hikspine-initial`。代码是权威，本文档与之对齐。

定位一句话：

```text
Hikspine 是 AI coding 的工作流内核：
引擎维护状态机并在决策齐备时流转，registry 让 skill 自由组合进状态，
AI 执行能力并记录决策，一个可读状态文件记录进度。
```

## 1. 设计原则

1. **状态流转优先**：引擎只判断「当前状态的决策齐没齐」，齐了就流转，不齐就停在这个状态。
2. **决策是 skill 无关的契约**：`needs` 是决策键（如 `framework_choice`、`review_result=pass`），谁产出的不管。
3. **skill 自由组合**：状态用 `capabilities` 列出可用 skill id，由 registry 解析；换 skill 不动流转。
4. **skill 无侵入**：OpenSpec、Superpowers、公司 skill 不需要知道 Hikspine。
5. **一个可读状态文件**：comet 风格，`current + decisions + rollback + history`，一眼可读、可恢复。
6. **跨状态回退**：`fail_when`/`fail_to` 表达「评审/验证不过就回到更早的状态」，回退时清空下游决策逼着重做。
7. **诚实取舍**：决策由 agent 记录，引擎信任它（比观察文件少一层强校验）；用 `requires_user` 硬阻塞点 + write-source guard 补偿。
8. **平台后置**：YAML 可作为未来可视化平台 IR，但 MVP 不被 UI 需求拖重。

边界：

```text
Engine        状态机流转、决策求值、回退、next-action、guard
Workflow      状态、决策 needs、capabilities、流转边、回退边
Skill Registry  capability id 到实际 skill/ref/描述/副作用的绑定
Change State  current 状态、decisions、rollback、history
Events        可选审计和 UI 时间线，不是状态基础
```

## 2. 项目侧目录结构

围绕 change 状态组织，状态跟 change 走。

```text
project/
  .hikspine/
    config.yaml                    # 项目配置：默认 workflow、registry、guard
    active                         # 当前 change 指针
    workflows/                     # 可选：项目自定义 workflow 或 override
      feature.yaml
    registries/                    # 可选：项目/公司 skill 绑定
      company.yaml
    changes/                       # 非 OpenSpec 的轻量 change 状态
      fix-login-timeout.yaml

  openspec/
    changes/<change>/
      proposal.md
      design.md
      tasks.md
      specs/
      .hikspine.yaml               # OpenSpec change 的权威 Hikspine 状态
```

规则：

- 基于 OpenSpec 的 change，状态放 `openspec/changes/<change>/.hikspine.yaml`。
- `simple-fix`/`hotfix` 这类轻量任务，状态放 `.hikspine/changes/<change>.yaml`（storage = standalone）。
- 没有 events，workflow 也必须能靠 workflow + registry + state 正常运行。

## 3. 项目配置

配置只做选择和绑定，不重复描述流程。

```yaml
# .hikspine/config.yaml
version: 1
defaultWorkflow: feature

registries:
  - .hikspine/registries/company.yaml

guard:
  sourceRoots:
    - src/
    - app/
    - packages/*/src/
```

像 `framework_choice`、`component_mapping` 这种是**决策**，记录在状态文件的 `decisions` 里，不写进项目配置。

## 4. Skill Registry

Registry 把 workflow 里的 capability id 绑定到实际 skill。内置绑定见 `lib/registry.mjs`，项目可叠加。

```yaml
# .hikspine/registries/company.yaml
id: company
version: 1

skills:
  company.knowledge:
    ref: company-knowledge
    description: 查询公司知识库、历史方案、平台规范和业务术语
    sideEffects: []
  company.platform-design:
    ref: company-java-design
    description: 检查框架、组件、脚手架、接口、数据规范
    sideEffects: []
  company.review:
    ref: company-java-review
    description: 按公司规范做代码审查
    sideEffects: []
  company.security:
    ref: company-security-review
    description: 检查权限、数据、接口、日志、合规风险
    sideEffects: []
```

关键点：

```text
skill 不声明自己属于哪个状态。
状态用 capabilities 声明它可以组合哪些 skill。
换 skill = 改 capabilities / registry，流转图不动。
```

## 5. Workflow 模型 — 状态 + 决策流转

workflow 是一个扁平的状态机：

```text
workflow
  start                # 起始状态 id
  states[]             # 状态列表
    id
    goal               # 这个状态要达成什么
    forbid             # 该状态禁止的副作用，如 [write-source]
    requires_user      # 是否需要用户确认的硬阻塞点
    capabilities       # 可自由组合的 capability id（registry 解析）
    needs              # skill 无关的决策（流转的依据）
    next               # 决策齐了去哪个状态
    fail_when          # "key=value"：命中则回退
    fail_to            # 回退到哪个状态
    fail_reason        # 回退原因（写进 rollback marker）
    terminal           # 是否终态
```

### 5.1 `needs` 决策的两种写法

```text
key            该决策已记录（任意非空值）
key=value      该决策等于 value（如 review_result=pass）
```

流转只问「`needs` 齐没齐」。`needs` 永远是决策键，不是文件路径、不是 skill 名 —— 这是自由组合的前提。

### 5.2 内置 feature workflow

```yaml
# builtin/workflows/feature.yaml
id: feature
version: 5
name: Feature Development
start: open

states:
  - id: open
    goal: Clarify the change and create OpenSpec artifacts.
    forbid: [write-source]
    capabilities: [openspec-explore, openspec-propose]
    needs: [requirements_clarified, proposal_ready]
    next: design

  - id: design
    goal: Explore the technical path, document it, and get user confirmation.
    forbid: [write-source]
    requires_user: true
    capabilities: [brainstorming, company.platform-design, company.knowledge]
    needs: [design_documented, design_confirmed]
    next: build

  - id: build
    goal: Implement the confirmed design.
    capabilities: [superpowers.plan, superpowers.implement]
    needs: [implemented]
    next: review

  - id: review
    goal: Review the implementation before verification.
    capabilities: [superpowers.review, company.review, company.security]
    needs: [review_result=pass]
    fail_when: review_result=fail
    fail_to: build
    fail_reason: Review found implementation problems.
    next: verify

  - id: verify
    goal: Verify behavior and OpenSpec coverage.
    capabilities: [superpowers.verify, openspec.verify]
    needs: [verify_result=pass]
    fail_when: verify_result=fail
    fail_to: build
    fail_reason: Verification did not pass.
    next: archive

  - id: archive
    goal: Archive the completed change after user confirmation.
    forbid: [write-source]
    requires_user: true
    capabilities: [openspec.archive]
    needs: [archived]
    terminal: true
```

### 5.3 内置 simple-fix workflow

```yaml
# builtin/workflows/simple-fix.yaml
id: simple-fix
version: 5
name: Simple Fix
start: inspect

states:
  - id: inspect
    goal: Understand the issue and the smallest safe change.
    capabilities: [superpowers.inspect, company.knowledge]
    needs: [issue_understood]
    next: fix

  - id: fix
    goal: Apply the minimal patch.
    capabilities: [superpowers.implement]
    needs: [patched]
    next: verify

  - id: verify
    goal: Run focused verification.
    capabilities: [superpowers.verify]
    needs: [verify_result=pass]
    fail_when: verify_result=fail
    fail_to: fix
    fail_reason: Verification did not pass.
    terminal: true
```

simple-fix 的重点是轻：`inspect -> fix -> verify`，不强制 OpenSpec、设计文档或完整 review；verify 不过就回 fix。

## 6. Change State — 一个可读文件

状态文件是权威状态，结构刻意简单、可读、可恢复。

```yaml
# openspec/changes/entrance-monitor/.hikspine.yaml
version: 1
change: entrance-monitor
workflow: feature
workflowVersion: "5"
workflowHash: sha256:...
storage: openspec

current: design          # 就是当前状态 id（字符串）

decisions:               # agent 记录的决策（谁产出的不管）
  requirements_clarified: true
  proposal_ready: true
  framework_choice: Spring Boot 3 + company-starter

rollback:                # 仅在刚回退后存在，前进后清除
  to: build
  from: verify
  reason: Verification did not pass.

history:
  - { at: 2026-06-28T14:12:10.000Z, type: started, workflow: feature, state: open }
  - { at: 2026-06-28T14:20:00.000Z, type: transition, from: open, to: design }
```

字段规则：

```text
current      当前状态 id（字符串，不再是 {phase,node,step}）
decisions    决策表，键是 needs 引用的决策键
rollback     回退 marker，前进一步后自动清除
workflowHash 工作流文件哈希，用于断点恢复时检测 workflow 变化
history      轻量可读日志
```

## 7. Agent 协议 — `next` + `decide`

引擎只暴露两个命令（`bin/hikspine.mjs`）：

```text
node "$HIKSPINE_ENGINE" next [change] [--workflow <id>] [--storage openspec|standalone] [--json]
node "$HIKSPINE_ENGINE" decide <key> [value] [--change <change>] [--json]
```

- **`next`**：展示当前状态——goal、`forbid`、可组合的 `capabilities`、还缺哪些决策（missing）、回退 marker。新 change 会按 `--workflow` 创建。
- **`decide <key> [value]`**：记录一个决策（value 默认 `true`，可传 `pass`/`fail`/数字等），然后自动流转，返回下一个要做的状态。

`next-action`（`computeNext` 的输出）示例：

```jsonc
{
  "change": "entrance-monitor",
  "workflow": "feature",
  "current": "design",
  "goal": "Explore the technical path, document it, and get user confirmation.",
  "forbid": ["write-source"],
  "requiresUser": true,
  "capabilities": [
    { "id": "brainstorming", "ref": "brainstorming", "description": "Explore options, unknowns, tradeoffs, and questions." },
    { "id": "company.platform-design", "ref": "company-platform-design", "description": "Check framework, component reuse, scaffold, API, data, and platform constraints." }
  ],
  "needs": ["design_documented", "design_confirmed"],
  "missing": ["design_documented", "design_confirmed"],
  "rollback": null,
  "terminal": false,
  "complete": false,
  "transitions": []
}
```

AI 不需要猜：当前在哪个状态、可以组合哪些 skill、还缺哪些决策、记录完去看下一步。

## 8. 流转与回退规则

`computeNext` 在每次调用时自动推进（`lib/transitions.mjs`）：

```text
循环（带上限）：
  s = 当前状态
  1. 若 s.fail_when 命中           → 回退：清空 fail_to..from 的决策，设 rollback marker，current = fail_to，继续
  2. 若 s.needs 还缺               → 停在 s，返回 next-action（agent 需记录决策）
  3. 若 s.terminal 且决策齐         → workflow 完成
  4. 否则                           → 清除 rollback marker，current = s.next，继续
```

回退示例（`verify_result=fail`）：

```text
1. 清空 build..verify 的决策（implemented / review_result / verify_result）
2. current = build
3. 设 rollback marker { to: build, from: verify, reason }
4. 停在 build（缺 implemented）→ agent 必须重新实现
5. 重新实现后 build -> review（review_result 已被清，必须重审）-> verify（必须重验）
```

清空下游决策是关键：它逼着「重实现 → 重审 → 重验」，避免拿着旧的 fail 报告反复触发回退的死循环。

## 9. Guard 与 Hook

Hook 只做 guard，不做主编排（`hooks/guard.mjs` + `lib/checks.mjs` 的 `checkGuard`）。

```text
PreToolUse：读当前状态的 forbid，拦截不允许的写操作
```

Guard 逻辑：

```text
1. 读 change state 的 current（状态 id）
2. 在 workflow.states 里找到该状态，取它的 forbid
3. 若 forbid 含 write-source 且目标命中 isSourcePath → BLOCK
```

`isSourcePath` 由 `config.guard.sourceRoots` + 源码扩展名判断；`openspec/changes` 和 `.hikspine` 路径豁免。

```text
open/design/archive 状态默认 forbid: [write-source]。
build/fix/patch 状态允许写 sourceRoots。
```

guard 是 **fail-open** 的：没有 active change 或解析异常时放行，不阻塞正常编辑。

## 10. OpenSpec、Superpowers、公司 Skill 的衔接

三者都以 capability 进入 registry，状态用 `capabilities` 组合：

```text
OpenSpec     openspec-explore / openspec-propose / openspec.design / openspec.verify / openspec.archive
Superpowers  superpowers.inspect / plan / implement / review / verify
Company      company.knowledge / platform-design / review / security
```

状态把它们组合起来，例如 review 状态：

```yaml
- id: review
  capabilities: [superpowers.review, company.review, company.security]
  needs: [review_result=pass]
  fail_when: review_result=fail
  fail_to: build
```

公司 skill 不需要写「我用于 review 阶段」「完成后做什么」——这些由状态的 `capabilities`/`needs` 和 next-action 告诉 AI。要加一个公司专属评审 skill，只往 `capabilities` 里加一个 id 即可，`needs`（`review_result=pass`）不变。

## 11. 内置工作流

```text
feature       open -> design -> build -> review -> verify -> archive
new-project   open -> design -> scaffold -> build -> review -> verify
simple-fix    inspect -> fix -> verify
hotfix        inspect -> patch -> verify
```

- **feature**：常规需求。design 需用户确认（`requires_user`）；review/verify fail 回 build。
- **new-project**：从 0 到 1，多一个 scaffold 状态；review/verify fail 回 build。
- **simple-fix / hotfix**：轻量，standalone 存储，不强制 OpenSpec；verify fail 回 fix/patch。

## 12. MVP 范围

已落地：

```text
1. 状态机内核（lib/transitions.mjs）
   - 决策驱动的 computeNext（自动前进）
   - recordDecision
   - 跨状态回退（清空下游决策）

2. Builtin workflows（feature / new-project / simple-fix / hotfix），states schema

3. Skill registry（lib/registry.mjs + 项目/公司 registry 叠加）

4. Change state（OpenSpec colocated .hikspine.yaml / standalone .hikspine/changes/<change>.yaml）

5. Claude Code adapter
   - hikspine skill 作为用户入口
   - node "$HIKSPINE_ENGINE" next / decide
   - PreToolUse guard（per-state forbid）
```

暂缓：

```text
events 作为权威状态源
Web designer / 完整 graph engine / 并行子工作流
远程 worker / 复杂权限模型
```

## 13. 诚实取舍

状态机信任「agent 记录的决策」，比 v0.6 观察文件少一层强校验。补偿：

```text
1. requires_user 硬阻塞点（design 确认、archive 归档）——必须停下问用户
2. write-source guard hook——错误阶段写源码直接拦
3. 决策可带值（review_result=pass/fail），回退基于值，不靠 agent 自觉
4. workflowHash + 可读状态文件——断点恢复时能看清在哪、记了什么
```

未来若需要更强校验，可在状态上挂**可选的**轻量检查（复用 `lib/checks.mjs` 的 `evaluateCheck`，它仍保留但不再驱动流转），作为决策之外的二次确认——但流转核心永远是决策，不是文件观察。

## 14. 最终分层

```text
State Machine Kernel
  状态流转、决策求值、回退、next-action、guard

Workflow (states)
  状态、needs（决策）、capabilities（可组合 skill）、流转边、回退边

Skill Registry
  capability id 到实际 skill/ref/描述/副作用的绑定

Change State
  current 状态、decisions、rollback、history（一个可读文件）

Runtime Adapter
  Claude Code / CLI / future web worker

Optional Events
  审计、回放、UI 时间线增强
```

一句话总结：

```text
Hikspine v0.7 的内核是一个可组合的状态机：
状态 + 决策流转是骨架，skill 通过 registry 自由插进状态，
换 skill 不动流转。状态流转，不是文件观察。
```
