# Hikspine 方案 B - Workflow Kernel + Skill Orchestration 草案 v0.6

> v0.6 调整：
>
> - MVP 目标收敛为：**稳定跑通阶段流转，并稳定指导 AI 使用 skill**。
> - `events.ndjson` 不作为 MVP 权威状态源，降回可选增强；当前权威状态是 change state。
> - 项目目录改为 change-centric，状态跟 change 走，便于恢复、排查和迁移。
> - workflow 保留未来可视化平台的扩展空间，但 MVP 先采用“阶段 + 节点 + skill recipe + gate”的简单模型。
> - skill 不需要改造；workflow recipe 负责说明在某个阶段如何使用 skill。

定位一句话：

```text
Hikspine 是 AI coding 的工作流内核：
引擎判断当前阶段和下一步，workflow recipe 编排 skill，AI 执行能力，state 记录进度。
```

## 0. 当前最重要的问题

现在最重要的不是审计、回放或平台 UI，而是把这三件事跑稳：

```text
1. 阶段流转稳定
   open -> design -> build -> review -> verify -> archive

2. skill 使用稳定
   AI 知道当前节点必须/建议调用哪些 skill，顺序是什么，出口条件是什么

3. 状态恢复稳定
   中断后读取 change state，可以准确恢复当前 phase、node、step 和 missing gate
```

因此 MVP 的权威输入是：

```text
workflow definition + skill registry + change state
```

可选增强是：

```text
events.ndjson / board.json / visual designer / run replay
```

## 1. 设计原则

1. **状态优先**：MVP 以 change state 作为权威状态源，events 只是增强记录。
2. **约定优先**：引擎内置常见 workflow，项目只选择 workflow 和 skill registry。
3. **阶段确定**：引擎确定当前 phase、node、step，以及是否允许 advance。
4. **skill 无侵入**：已有 OpenSpec、Superpowers、公司 skill 不需要知道 Hikspine。
5. **recipe 绑定能力**：workflow recipe 声明某阶段用哪些 skill、是否必须、顺序和出口条件。
6. **探索阶段可循环**：design/open 这类阶段允许 agent-loop，但必须有明确 stopWhen。
7. **执行阶段可线性**：build/review/verify 更适合 skill-sequence 和明确 gate。
8. **平台后置**：YAML 可作为未来可视化平台 IR，但 MVP 不被 UI 需求反向拖重。

边界：

```text
Engine：阶段流转、节点状态、gate 求值、next-action、guard
Workflow：阶段、节点、skill recipe、fallback、gate
Skill Registry：skill id 到实际 skill/ref/描述/副作用的绑定
Change State：当前 phase/node/step、facts、artifacts、node 状态
Events：可选审计和 UI 时间线，不是 MVP 状态基础
```

## 2. 项目侧目录结构

项目侧目录应围绕 change 状态，而不是围绕 run events。

推荐结构：

```text
project/
  .hikspine/
    config.yaml                    # 项目配置：默认 workflow、registry、guard
    active                         # 当前 change，可选

    workflows/                     # 可选：项目自定义 workflow 或 override
      feature.yaml
      simple-fix.yaml

    registries/                    # 可选：项目/公司 skill 绑定
      company.yaml

    changes/                       # 可选：非 OpenSpec 场景的轻量 change state
      fix-login-timeout.yaml

  openspec/
    changes/<change>/
      proposal.md
      design.md
      tasks.md
      specs/
      .hikspine.yaml               # OpenSpec change 的权威 Hikspine 状态
      .hikspine/                   # 可选增强
        events.ndjson
        board.json
        notes.md
```

规则：

- 如果 change 基于 OpenSpec，优先把状态放在 `openspec/changes/<change>/.hikspine.yaml`。
- 如果是 `simple-fix` 这类不需要 OpenSpec 的轻量任务，可以放在 `.hikspine/changes/<change>.yaml`。
- `.hikspine/<change>/runs/` 这种 event-first 布局不作为 MVP 主路径。
- `events.ndjson`、`board.json` 都可以从 state 和操作记录再增强，不影响阶段流转。

## 3. 项目配置

项目配置只做选择和绑定，不重复描述完整流程。

```yaml
# .hikspine/config.yaml
version: 1

defaultWorkflow: feature

registries:
  - builtin.openspec
  - builtin.superpowers
  - .hikspine/registries/company.yaml

guard:
  sourceRoots:
    - src/
    - app/
    - packages/*/src/
  writeSourceAllowedIn:
    - build
    - fix
    - patch
```

项目不需要重复写：

```text
framework_choice
component_mapping
scaffold_decision
```

这些应留在公司 skill 的执行内容里，或者作为某个节点的 summary/fact，而不是散落在项目配置中。

## 4. Skill Registry

Skill registry 负责把 workflow 中的 skill id 绑定到实际 skill。

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
    description: 检查 Java 服务设计是否符合公司框架、组件、脚手架、接口和数据规范
    sideEffects: []

  company.review:
    ref: company-java-review
    description: 按公司 Java 服务规范做代码审查
    sideEffects: []

  company.security:
    ref: company-security-review
    description: 检查权限、数据、接口、日志、合规等安全风险
    sideEffects: []
```

关键点：

```text
skill 不声明自己属于哪个阶段。
workflow recipe 声明某个阶段要如何使用 skill。
```

这样已有的好 skill 不需要改造，只需要 registry 里有一个绑定。

## 5. Workflow 模型

MVP 不直接做完整图引擎，而采用更稳定的结构：

```text
workflow
  phases[]                 # 阶段顺序
    nodes[]                # 阶段内节点
      skill / skill-sequence / agent-loop / gate / human-approval
  fallbacks[]              # 失败回退
```

引擎按顺序推进：

```text
phase -> node -> step -> node completed -> phase completed -> next phase
```

需要自定义复杂流程时，后续再扩展为可视化图 IR。

### 5.1 内置 feature workflow

```yaml
# builtin/workflows/feature.yaml
id: feature
version: 1
name: Feature Development

phases:
  - id: open
    guard:
      forbid:
        - write-source
    nodes:
      - id: open.openspec
        type: skill-sequence
        required: true
        steps:
          - skill: openspec.change
            task: 澄清需求并创建 proposal、tasks、必要的 specs
        completeWhen:
          artifacts:
            - proposal
            - tasks

  - id: design
    guard:
      forbid:
        - write-source
    nodes:
      - id: design.explore
        type: agent-loop
        required: true
        objective: 澄清剩余问题，比较方案，检查公司约束，形成可实施设计
        allowedSkills:
          - brainstorming
          - company.knowledge
          - company.platform-design
          - openspec.design
        mustConsult:
          - company.knowledge
        rules:
          - 涉及公司框架、组件、平台、中间件、权限、监控、发布或历史系统时，必须查 company.knowledge
          - 做设计结论前必须完成 company_constraints_checked
          - 如果仍有开放问题，必须先向用户澄清，不得进入 build
        stopWhen:
          facts:
            - no_open_questions
            - company_constraints_checked
            - design_direction_selected

      - id: design.documented
        type: skill
        required: true
        skill: openspec.design
        task: 根据设计探索结论更新 design.md
        completeWhen:
          artifacts:
            - design_doc

  - id: build
    nodes:
      - id: build.implement
        type: skill-sequence
        required: true
        steps:
          - skill: superpowers.plan
            task: 制定实现计划
          - skill: superpowers.implement
            task: 按 tasks.md 实现并自测
        completeWhen:
          facts:
            - implementation_done

  - id: review
    nodes:
      - id: review.quality
        type: skill-sequence
        required: true
        steps:
          - skill: superpowers.review
            task: 做通用代码审查
          - skill: company.review
            task: 做公司规范审查
          - skill: company.security
            task: 做安全风险审查
        completeWhen:
          facts:
            - review_result

  - id: verify
    nodes:
      - id: verify.acceptance
        type: skill-sequence
        required: true
        steps:
          - skill: superpowers.verify
            task: 运行测试和必要验证
          - skill: openspec.verify
            task: 验证 OpenSpec change
        completeWhen:
          facts:
            - verify_result

  - id: archive
    nodes:
      - id: archive.openspec
        type: skill
        required: true
        skill: openspec.archive
        completeWhen:
          facts:
            - archived

fallbacks:
  - from: review
    when: review_result=fail
    to: build

  - from: verify
    when: verify_result=fail
    to: build
```

### 5.2 内置 simple-fix workflow

```yaml
# builtin/workflows/simple-fix.yaml
id: simple-fix
version: 1
name: Simple Fix

phases:
  - id: inspect
    nodes:
      - id: inspect.understand
        type: agent-loop
        required: true
        objective: 理解问题，定位最小修改范围
        allowedSkills:
          - superpowers.inspect
          - company.knowledge
        stopWhen:
          facts:
            - issue_understood
            - impact_scope_known

  - id: fix
    nodes:
      - id: fix.apply
        type: skill
        required: true
        skill: superpowers.implement
        task: 做最小必要修改
        completeWhen:
          facts:
            - patch_applied

  - id: verify
    nodes:
      - id: verify.focused
        type: skill-sequence
        required: true
        steps:
          - skill: superpowers.verify
            task: 运行聚焦验证
        completeWhen:
          facts:
            - verify_result

fallbacks:
  - from: verify
    when: verify_result=fail
    to: fix
```

simple-fix 的重点是轻：

```text
inspect -> fix -> verify
```

不强制 OpenSpec，不强制设计文档，不强制公司完整 review。

## 6. Change State

Change state 是 MVP 权威状态。

OpenSpec change 示例：

```yaml
# openspec/changes/entrance-monitor/.hikspine.yaml
version: 1
change: entrance-monitor

workflow: feature
workflowVersion: 1
workflowHash: sha256:...

current:
  phase: design
  node: design.explore
  step: null

nodes:
  open.openspec:
    status: done
    result: pass
    summary: proposal/tasks 已创建

  design.explore:
    status: doing
    result:
    summary:

  design.documented:
    status: todo

facts:
  no_open_questions: false
  company_constraints_checked: false
  design_direction_selected: false

artifacts:
  proposal: openspec/changes/entrance-monitor/proposal.md
  tasks: openspec/changes/entrance-monitor/tasks.md
  design_doc:

history:
  - at: 2026-06-27T14:12:10+08:00
    type: phase.changed
    from: open
    to: design
  - at: 2026-06-27T14:20:00+08:00
    type: node.started
    node: design.explore
```

字段规则：

```text
current.phase：当前阶段
current.node：当前节点
current.step：skill-sequence 中当前 step，可为空
nodes：节点状态，todo/doing/done/failed/skipped
facts：引擎可判断的少量事实
artifacts：产物路径指针
history：轻量可读日志，不承担完整审计
```

## 7. Next Action

`next-action` 是引擎给 AI 的主输出。

对于 agent-loop：

```jsonc
{
  "change": "entrance-monitor",
  "workflow": "feature",
  "phase": "design",
  "node": "design.explore",
  "nodeType": "agent-loop",
  "objective": "澄清剩余问题，比较方案，检查公司约束，形成可实施设计",
  "allowedSkills": [
    "brainstorming",
    "company.knowledge",
    "company.platform-design",
    "openspec.design"
  ],
  "mustConsult": [
    "company.knowledge"
  ],
  "rules": [
    "涉及公司框架、组件、平台、中间件、权限、监控、发布或历史系统时，必须查 company.knowledge",
    "做设计结论前必须记录 company_constraints_checked=true",
    "如果仍有开放问题，必须先向用户澄清，不得进入 build"
  ],
  "missing": [
    "no_open_questions",
    "company_constraints_checked",
    "design_direction_selected"
  ],
  "commands": {
    "fact": "hikspine fact entrance-monitor <key> <value>",
    "artifact": "hikspine artifact entrance-monitor <key> <path>",
    "complete": "hikspine complete entrance-monitor design.explore --result pass --summary \"...\"",
    "advance": "hikspine advance entrance-monitor"
  }
}
```

对于 skill-sequence：

```jsonc
{
  "change": "entrance-monitor",
  "phase": "review",
  "node": "review.quality",
  "nodeType": "skill-sequence",
  "currentStep": 2,
  "nextSkill": {
    "id": "company.review",
    "ref": "company-java-review",
    "task": "做公司 Java 服务规范审查"
  },
  "remaining": [
    "company.security"
  ],
  "commands": {
    "completeStep": "hikspine step entrance-monitor review.quality --done",
    "completeNode": "hikspine complete entrance-monitor review.quality --result pass --summary \"...\""
  }
}
```

这样 AI 不需要猜：

```text
当前在哪个阶段
当前节点是什么
是否必须执行
应该用哪个 skill
skill 顺序是什么
出口条件是什么
完成后写什么命令
```

## 8. 阶段推进规则

节点完成：

```text
hikspine complete <change> <node> --result pass|fail --summary "..."
```

记录 fact：

```text
hikspine fact <change> <key> <value>
```

记录 artifact：

```text
hikspine artifact <change> <key> <path>
```

推进阶段：

```text
hikspine advance <change>
```

`advance` 规则：

```text
1. 读取 workflow
2. 读取 change state
3. 找到 current.phase/current.node
4. 如果 current node 未完成，返回 next-action
5. 如果当前 phase 还有 required node 未完成，切到下一个 node
6. 如果 phase 所有 required node 完成，检查 fallback 条件
7. 若 fail 条件命中，回退到目标 phase，并清理触发 fail 的 fact
8. 否则进入下一个 phase
```

回退示例：

```yaml
fallbacks:
  - from: verify
    when: verify_result=fail
    to: build
```

命中后：

```text
1. current.phase = build
2. current.node = build.implement
3. facts.verify_result 被清掉，避免死循环
4. history 记录 rollback
```

## 9. Events 是增强，不是 MVP 地基

事件流仍然有价值，但不应成为第一阶段的核心复杂度。

可选路径：

```text
openspec/changes/<change>/.hikspine/events.ndjson
```

或非 OpenSpec change：

```text
.hikspine/changes/<change>.events.ndjson
```

事件用于：

```text
完整审计
可视化时间线
失败分析
状态重建
多人协作冲突排查
```

但 MVP 要求：

```text
没有 events，workflow 也必须能靠 workflow + registry + state 正常运行。
```

## 10. Guard 与 Hook

Hook 只做 guard，不做主编排。

默认：

```text
PreToolUse：拦截不允许的写操作
SessionStart：提示 active change 和 next-action
UserPromptSubmit：默认关闭，必要时只注入短提醒
PostToolUse：默认关闭，除非需要记录特定副作用
```

Guard 输入：

```text
current.phase
current.node
workflow guard
skill sideEffects
project sourceRoots
toolCall
```

示例：

```text
open/design 阶段默认禁止 write-source。
build/fix/patch 阶段允许写 sourceRoots。
sideEffects=write-source 的 skill 需要人工确认或处于允许阶段。
```

## 11. OpenSpec、Superpowers、公司 Skill 的衔接

OpenSpec、Superpowers、公司能力都以 skill 进入 registry：

```text
OpenSpec：proposal/design/tasks/specs/verify/archive
Superpowers：inspect/plan/implement/review/verify
Company：knowledge/platform-design/review/security/release
```

workflow recipe 负责把它们串起来：

```yaml
review.quality:
  type: skill-sequence
  steps:
    - skill: superpowers.review
      task: 做通用代码审查
    - skill: company.review
      task: 做公司规范审查
    - skill: company.security
      task: 做安全风险审查
```

公司 skill 不需要写：

```text
我用于 review 阶段
完成后执行 hikspine complete
```

这些由 workflow recipe 和 next-action 告诉 AI。

## 12. 内置工作流建议

### 12.1 new-project

```text
open -> design -> scaffold -> build -> review -> verify -> archive
```

特点：

- 适合从 0 到 1。
- design 较重。
- scaffold 通常需要 human approval。
- 公司平台、组件、模板、部署规范应强制检查。

### 12.2 feature

```text
open -> design -> build -> review -> verify -> archive
```

特点：

- 常规需求开发。
- design 用 agent-loop。
- build/review/verify 用 skill-sequence。
- review/verify fail 回 build。

### 12.3 simple-fix

```text
inspect -> fix -> verify
```

特点：

- 小修复。
- 不强制 OpenSpec。
- 不强制设计文档。
- 可以选配公司 quick-risk-check。

### 12.4 hotfix

```text
inspect -> patch -> risk-check -> verify -> release
```

特点：

- 紧急修复。
- 流程短，但 guard、verify、release check 更严格。

## 13. MVP 范围

第一阶段：

```text
1. Workflow kernel
   - phase/node/step 状态
   - required node 判断
   - fallback
   - next-action

2. Builtin workflows
   - feature
   - simple-fix

3. Skill registry
   - builtin.openspec
   - builtin.superpowers
   - project/company registry

4. Change state
   - OpenSpec colocated .hikspine.yaml
   - non-OpenSpec .hikspine/changes/<change>.yaml

5. Claude Code adapter
   - hikspine skill 作为用户入口
   - /hs 仅作为触发 hikspine skill 的文本约定，不提供 command 文件
   - skill 内部调用插件级 runtime：node "$HIKSPINE_ENGINE" next/fact/artifact/complete/advance
   - PreToolUse guard
```

暂缓：

```text
events as source of truth
Web designer
完整 graph engine
parallel/subworkflow
远程 worker
复杂权限模型
```

## 14. 后续平台演进

当 MVP 跑稳后，再把 workflow YAML 视为可视化平台 IR：

```text
Designer -> workflow.yaml -> engine -> state/events -> board/timeline
```

这时可以增强：

```text
events.ndjson 变成完整审计日志
board.json 变成 UI 投影缓存
workflow graph 支持条件分支、并行、subworkflow
registry 支持 marketplace 和版本管理
```

但这些不应阻塞第一阶段目标。

## 15. 最终分层

```text
Workflow Kernel
  阶段流转、节点推进、fallback、next-action、guard

Workflow Recipe
  阶段内如何使用 skill，哪些必须，顺序和出口条件

Skill Registry
  skill id 到实际 skill/ref/描述/副作用的绑定

Change State
  当前 phase/node/step、facts、artifacts、node 状态

Runtime Adapter
  Claude Code / CLI / future web worker

Optional Events
  审计、回放、UI 时间线、状态重建增强
```

一句话总结：

```text
Hikspine v0.6 的 MVP 不是事件平台，
而是一个先把阶段流转和 skill 使用跑稳的 workflow kernel。
```
