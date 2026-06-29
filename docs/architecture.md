# Hikspine 工作流引擎架构设计

本文档描述 Hikspine 工作流引擎的架构、数据模型与运行协议，是引擎的权威设计文档，与 `lib/`、`bin/hikspine.mjs`、`builtin/workflows/` 的实现保持一致。

定位：

```text
Hikspine 是 AI coding 的工作流内核：
引擎维护一个可组合的状态机，在决策齐备时流转；
状态用 capabilities 列出可组合的真实 skill 名（由文件系统发现解析）；AI 执行能力并记录决策；
一个可读的状态文件记录进度，支持中断恢复。
```

## 1. 设计目标与动机

引擎要同时满足三件事：

```text
1. 稳定的阶段流转    open -> design -> build -> review -> verify -> archive
2. skill 自由组合    同一阶段可任意增删/替换/重排 skill，不改流程骨架
3. 可恢复            中断后读状态文件即可准确恢复当前位置和已记录的决策
```

核心设计取向是**状态流转，而不是文件观察**。

若引擎靠「观察某个 skill 产出的固定文件」来判断能否推进（例如检查 `design.md` 是否包含某标题），就等于把每个 skill 的产出格式硬编码进 workflow——换一个 skill 就要改 workflow，skill 无法自由组合。

因此引擎把推进的依据定义为**决策（decision）**：每个状态声明它需要哪些 skill 无关的决策（`needs`），以及可以组合哪些 skill（`capabilities`）。流转只问「该状态要的决策齐没齐」，与「是哪个 skill、产出了什么文件」无关。要替换或新增一个 skill，只需修改状态的 `capabilities` 列表，流转图保持不变。

## 2. 核心概念与边界

```text
Engine          状态机流转、决策求值、回退、next-action、guard
Workflow        状态、决策 needs、capabilities、流转边、回退边
Skill Discovery 从文件系统发现真实 skill（name / description / source），capabilities 即 skill 名
Change State    current 状态、decisions、rollback、history（一个可读文件）
Events          可选的审计与 UI 时间线，不是状态基础
```

设计原则：

1. **状态流转优先**：引擎判断当前状态的决策是否齐备，齐则流转，不齐则停在该状态。
2. **决策是 skill 无关的契约**：`needs` 是决策键（如 `framework_choice`、`review_result=pass`），与产出者无关。
3. **skill 自由组合**：状态用 `capabilities` 列出真实 skill 名，由文件系统发现解析；替换 skill 不影响流转。
4. **skill 无侵入**：OpenSpec、Superpowers 及任何其它 skill 不需要知道 Hikspine 的存在。
5. **单一可读状态**：状态文件记录 `current + decisions + rollback + history`，可读、可恢复。
6. **跨状态回退**：`fail_when` / `fail_to` 表达「评审或验证不通过则回到更早的状态」，回退时清空下游决策以强制重做。
7. **关键节点人工确认**：`requires_user` 标记必须停下征询用户的硬阻塞点。

## 3. 项目目录结构

状态围绕 change 组织，跟随 change 走，便于恢复与迁移。

```text
project/
  .hikspine/
    config.yaml                    # 项目配置：默认 workflow、guard
    active                         # 当前 change 指针
    workflows/                     # 可选：项目自定义 workflow 或 override
      feature.yaml
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

- 基于 OpenSpec 的 change，状态写在 `openspec/changes/<change>/.hikspine.yaml`。
- `simple-fix` / `hotfix` 等轻量任务（storage = standalone），状态写在 `.hikspine/changes/<change>.yaml`。
- 没有 events 时，引擎也必须能仅凭 workflow + 已发现的 skill + state 正常运行。

## 4. 项目配置

配置只做选择与绑定，不重复描述流程。

```yaml
# .hikspine/config.yaml
version: 1
defaultWorkflow: feature

guard:
  sourceRoots:
    - src/
    - app/
    - packages/*/src/
```

`framework_choice`、`component_mapping` 这类属于运行期**决策**，记录在状态文件的 `decisions` 中，不写入项目配置。

## 5. Skill 发现

没有 registry，也没有 capability id→skill 的映射层。workflow 里的 `capabilities` 直接写**真实的 Claude Code skill 名**——就是 Agent 传给 Skill 工具的那个 `name`。引擎按 Claude Code 自己读取的同一批文件系统位置发现 skill（`lib/skills.mjs` 的 `discoverSkills`）：

```text
1. 本插件自带         <plugin>/skills/
2. plugin marketplace ~/.claude/plugins/marketplaces/**/skills/
3. 个人               ~/.claude/skills/
4. 项目               <project>/.claude/skills/
```

每个 skill 读其 `SKILL.md` frontmatter 的 `name` / `description`，按 `name` 去重——后面的源覆盖前面的，因此项目 skill 胜出。解析 `capabilities` 时从发现结果取 description；workflow 里引用了一个本机未安装的 skill 名也照样透传（标 `unknown`），不会报错。

开源 skill 与公司 skill 不再有任何区分——它们都只是 skill，装在上面四个位置之一即可被发现。`hikspine skills --json` 列出当前能发现的全部 skill（既是编排界面挑选器的数据源，也是合法 capability 名的来源）。

要点：

```text
skill 不声明自己属于哪个状态。
状态用 capabilities 声明它可以组合哪些真实 skill 名。
换 skill = 改某个状态的 capabilities（装好对应 skill 即可），流转图不变。
```

## 6. Workflow 模型：状态 + 决策流转

workflow 是一个扁平的状态机。

```text
workflow
  start                # 起始状态 id
  states[]             # 状态列表
    id
    goal               # 该状态要达成什么
    forbid             # 该状态禁止的副作用，如 [write-source]
    requires_user      # 是否为需要用户确认的硬阻塞点
    capabilities       # 可组合的 capability id（由 registry 解析）
    needs              # skill 无关的决策（流转依据）
    next               # 决策齐备后流转到的状态
    fail_when          # "key=value"：命中则触发回退
    fail_to            # 回退到的状态
    fail_reason        # 回退原因（写入 rollback 标记）
    terminal           # 是否为终态
```

### 6.1 needs 决策的两种写法

```text
key            该决策已记录（任意非空值）
key=value      该决策等于 value（如 review_result=pass）
```

`needs` 永远是决策键，不是文件路径，也不是 skill 名——这是自由组合的前提。

### 6.2 内置 feature workflow

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
    capabilities: [brainstorming]
    needs: [design_documented, design_confirmed]
    next: build

  - id: build
    goal: Implement the confirmed design.
    capabilities: [writing-plans, executing-plans]
    needs: [implemented]
    next: review

  - id: review
    goal: Review the implementation before verification.
    capabilities: [requesting-code-review]
    needs: [review_result=pass]
    fail_when: review_result=fail
    fail_to: build
    fail_reason: Review found implementation problems.
    next: verify

  - id: verify
    goal: Verify behavior and OpenSpec coverage.
    capabilities: [verification-before-completion, openspec-verify-change]
    needs: [verify_result=pass]
    fail_when: verify_result=fail
    fail_to: build
    fail_reason: Verification did not pass.
    next: archive

  - id: archive
    goal: Archive the completed change after user confirmation.
    forbid: [write-source]
    requires_user: true
    capabilities: [openspec-archive-change]
    needs: [archived]
    terminal: true
```

### 6.3 内置 simple-fix workflow

```yaml
# builtin/workflows/simple-fix.yaml
id: simple-fix
version: 5
name: Simple Fix
start: inspect

states:
  - id: inspect
    goal: Understand the issue and the smallest safe change.
    capabilities: [systematic-debugging]
    needs: [issue_understood]
    next: fix

  - id: fix
    goal: Apply the minimal patch.
    capabilities: [executing-plans]
    needs: [patched]
    next: verify

  - id: verify
    goal: Run focused verification.
    capabilities: [verification-before-completion]
    needs: [verify_result=pass]
    fail_when: verify_result=fail
    fail_to: fix
    fail_reason: Verification did not pass.
    terminal: true
```

simple-fix 走轻量路径 `inspect -> fix -> verify`：不强制 OpenSpec、设计文档或完整 review；验证不通过则回到 fix。

## 7. Change State：单一可读文件

状态文件是权威状态，结构刻意简单、可读、可恢复。

```yaml
# openspec/changes/entrance-monitor/.hikspine.yaml
version: 1
change: entrance-monitor
workflow: feature
workflowVersion: "5"
workflowHash: sha256:...
storage: openspec

current: design          # 当前状态 id（字符串）

decisions:               # AI 记录的决策（与产出者无关）
  requirements_clarified: true
  proposal_ready: true
  framework_choice: Spring Boot 3 + company-starter

rollback:                # 仅在刚回退后存在，前进一步后清除
  to: build
  from: verify
  reason: Verification did not pass.

history:
  - { at: 2026-06-28T14:12:10.000Z, type: started, workflow: feature, state: open }
  - { at: 2026-06-28T14:20:00.000Z, type: transition, from: open, to: design }
```

字段说明：

```text
current      当前状态 id（字符串）
decisions    决策表，键为 needs 引用的决策键
rollback     回退标记，前进一步后自动清除
workflowHash 工作流文件哈希，用于恢复时检测 workflow 是否变动
history      轻量可读日志
```

## 8. Agent 协议：next 与 decide

引擎对 AI 暴露两个命令（`bin/hikspine.mjs`）：

```text
node "$HIKSPINE_ENGINE" next [change] [--workflow <id>] [--storage openspec|standalone] [--json]
node "$HIKSPINE_ENGINE" decide <key> [value] [--change <change>] [--json]
```

- **next**：展示当前状态——goal、`forbid`、可组合的 `capabilities`、还缺哪些决策（missing）、回退标记。对新 change 会按 `--workflow` 创建。
- **decide `<key> [value]`**：记录一个决策（value 默认 `true`，可传 `pass` / `fail` / 数字等），随后自动流转，返回下一个需要处理的状态。

`computeNext` 输出（next-action）示例：

```jsonc
{
  "change": "entrance-monitor",
  "workflow": "feature",
  "current": "design",
  "goal": "Explore the technical path, document it, and get user confirmation.",
  "forbid": ["write-source"],
  "requiresUser": true,
  "capabilities": [
    { "id": "brainstorming", "name": "brainstorming", "description": "Explore options, unknowns, tradeoffs, and questions.", "source": "marketplace" }
  ],
  "needs": ["design_documented", "design_confirmed"],
  "missing": ["design_documented", "design_confirmed"],
  "rollback": null,
  "terminal": false,
  "complete": false,
  "transitions": []
}
```

AI 无需猜测：当前在哪个状态、可以组合哪些 skill、还缺哪些决策、记录后如何取下一步。

### 8.1 只读列表命令

除了驱动状态机的 `next` / `decide`，CLI 还有三个**只读**列表命令，用于路由和工具，不会 auto-advance 或改动任何 change：

```text
node "$HIKSPINE_ENGINE" skills [--json]
node "$HIKSPINE_ENGINE" workflows [--json]
node "$HIKSPINE_ENGINE" changes [--json]
```

- **skills**：`discoverSkills` 的输出——当前能发现的全部 Claude Code skill（`name` / `description` / `source` / `path`），按 name 去重。既是挑选 capability 的数据源，也是合法 capability 名的来源。
- **workflows**：列出可用 workflow（内置 + 项目，项目按 id 覆盖内置），每个带 `intent`（声明「何时该用这条流程」），供 Agent 把请求路由到正确的 workflow。
- **changes**：扫描所有在跑的 change（两种存储），逐个给出 workflow、当前状态、`nextAction`、缺失决策和是否 active。是并发运行的只读注册表，也是后续看板的数据源。

## 9. 流转与回退规则

`computeNext` 在每次调用时自动推进（`lib/transitions.mjs`）：

```text
循环（带上限）：
  s = 当前状态
  1. 若 s.fail_when 命中      → 回退：清空 fail_to..from 的决策，设 rollback 标记，current = fail_to，继续
  2. 若 s.needs 还缺          → 停在 s，返回 next-action（AI 需记录决策）
  3. 若 s.terminal 且决策齐    → workflow 完成
  4. 否则                     → 清除 rollback 标记，current = s.next，继续
```

回退示例（`verify_result=fail`）：

```text
1. 清空 build..verify 的决策（implemented / review_result / verify_result）
2. current = build
3. 设 rollback 标记 { to: build, from: verify, reason }
4. 停在 build（缺 implemented）→ AI 必须重新实现
5. 重新实现后 build -> review（review_result 已清空，必须重审）-> verify（必须重验）
```

清空下游决策是关键：它强制「重实现 → 重审 → 重验」，避免拿着旧的失败结论反复触发回退导致死循环。

## 10. Guard 与 Hook

Hook 只负责 guard，不参与主编排（`hooks/guard.mjs` + `lib/checks.mjs` 的 `checkGuard`）。

```text
PreToolUse：读当前状态的 forbid，拦截不允许的写操作
```

判定逻辑：

```text
1. 读 change state 的 current（状态 id）
2. 在 workflow.states 中定位该状态，取其 forbid
3. 若 forbid 含 write-source 且目标命中 isSourcePath → BLOCK
```

`isSourcePath` 由 `config.guard.sourceRoots` 与源码扩展名共同判定；`openspec/changes` 与 `.hikspine` 路径豁免。

```text
open / design / archive 状态默认 forbid: [write-source]。
build / fix / patch 状态允许写 sourceRoots。
```

Guard 采用 **fail-open**：无 active change 或解析异常时放行，不阻塞正常编辑。

## 11. 与 OpenSpec、Superpowers 等 Skill 的衔接

所有 skill 都以真实 skill 名进入状态的 `capabilities`，由文件系统发现解析。无论来自 OpenSpec、Superpowers，还是某个公司 marketplace、个人或项目目录，在引擎眼里都只是 skill：

```text
OpenSpec      openspec-explore / openspec-propose / openspec-verify-change / openspec-archive-change
Superpowers   systematic-debugging / writing-plans / executing-plans / requesting-code-review / verification-before-completion
其它（公司等） 装到 ~/.claude/skills、某个 marketplace 或项目 .claude/skills 即可被发现并写入 capabilities
```

例如 review 状态：

```yaml
- id: review
  capabilities: [requesting-code-review]
  needs: [review_result=pass]
  fail_when: review_result=fail
  fail_to: build
```

skill 无需声明「我用于 review 阶段」或「完成后做什么」——这些由状态的 `capabilities` / `needs` 和 next-action 告知 AI。要新增一个公司专属评审 skill，只需把它装到被发现的位置，再在 `capabilities` 中加入它的 `name`，`needs`（`review_result=pass`）保持不变。

## 12. 内置工作流

```text
feature       open -> design -> build -> review -> verify -> archive
new-project   open -> design -> scaffold -> build -> review -> verify
simple-fix    inspect -> fix -> verify
hotfix        inspect -> patch -> verify
```

- **feature**：常规需求开发。design 需用户确认（`requires_user`）；review / verify 失败回 build。
- **new-project**：从 0 到 1，多一个 scaffold 状态；review / verify 失败回 build。
- **simple-fix / hotfix**：轻量、standalone 存储、不强制 OpenSpec；验证失败回 fix / patch。

## 13. 实现范围与非目标

已实现：

```text
1. 状态机内核（lib/transitions.mjs）
   - 决策驱动的 computeNext（自动前进）
   - recordDecision
   - 跨状态回退（清空下游决策）

2. 内置 workflow（feature / new-project / simple-fix / hotfix），states schema

3. Skill 发现（lib/skills.mjs：从 Claude Code 读取的同一批文件系统位置发现真实 skill，无 registry）

4. Change state（OpenSpec colocated .hikspine.yaml / standalone .hikspine/changes/<change>.yaml）

5. Claude Code 适配
   - hikspine skill 作为用户入口
   - node "$HIKSPINE_ENGINE" next / decide
   - PreToolUse guard（per-state forbid）
```

非目标（当前不纳入）：

```text
events 作为权威状态源
可视化设计器 / 完整图引擎 / 并行子工作流
远程 worker / 复杂权限模型
```

## 14. 设计取舍

状态机以「AI 记录的决策」作为流转依据，相比观察文件少一层强校验。这一取舍由以下机制补偿：

```text
1. requires_user 硬阻塞点（design 确认、archive 归档）——必须停下征询用户
2. write-source guard hook——错误状态下写源码直接拦截
3. 决策可带值（review_result=pass/fail），回退基于值判定，不依赖 AI 自觉
4. workflowHash + 可读状态文件——恢复时可清晰判断当前位置与已记录决策
```

如需更强校验，可在状态上挂载**可选的**轻量检查（复用 `lib/checks.mjs` 的 `evaluateCheck`，该模块保留但不再驱动流转），作为决策之外的二次确认；流转核心始终是决策，而非文件观察。

## 15. 演进方向

待内核稳定后，可将 workflow YAML 视为可视化平台的中间表示：

```text
Designer -> workflow.yaml -> engine -> state / events -> board / timeline
```

届时可增强：

```text
events.ndjson 成为完整审计日志
board.json 成为 UI 投影缓存
workflow 支持条件分支、并行、子工作流
skill 发现支持版本管理与更丰富的 marketplace 元数据
```

## 16. 分层总结

```text
State Machine Kernel
  状态流转、决策求值、回退、next-action、guard

Workflow (states)
  状态、needs（决策）、capabilities（可组合 skill）、流转边、回退边

Skill Discovery
  从文件系统发现真实 skill（name / description / source），capabilities 即 skill 名

Change State
  current 状态、decisions、rollback、history（一个可读文件）

Runtime Adapter
  Claude Code / CLI / 未来的 web worker

Optional Events
  审计、回放、UI 时间线增强
```

一句话总结：

```text
Hikspine 的内核是一个可组合的状态机——
状态与决策流转构成稳定骨架，每个状态的 capabilities（真实 skill 名，文件系统发现）可自由增删替换；
替换 skill 不改动流转。状态流转，而非文件观察。
```
