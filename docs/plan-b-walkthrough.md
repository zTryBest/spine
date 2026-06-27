# Hikspine 方案 B — feature 全生命周期纸面走查（v0.1）

> 目的：在写 engine 前，用纸面事件流压一遍 `mustResolve ↔ decision ↔ exit ↔ briefing ↔ recovery` 的咬合，抠出 schema 缝隙。
> 配套：[数据模型规范](plan-b-data-model.md)。
> **结论先行**：走查发现 4 处 schema 需要收敛（见末尾「走查发现」），happy path + 恢复 + verify 回退都能跑通。

---

## A. 被走查的 feature spec（当前模型，YAML）

```yaml
name: feature
version: 1.0.0
phases:
  - id: open
    goal: 探索澄清并形式化为 OpenSpec 产物
    mustResolve: [requirements_clear]
    capabilities: [openspec-explore, openspec-new-change]
    exit:
      allOf: [ {decisionsPresent: [requirements_clear]}, {artifactExists: proposal}, {artifactExists: tasks} ]
    guard: { forbid: [write-source] }
    next: design

  - id: design
    goal: 把技术路径想清楚
    briefing: { from: open, include: [proposal, specs, decisions] }
    mustResolve: [framework_choice, component_mapping, scaffold_decision, risks_identified]
    capabilities: [brainstorming, company-framework, company-component, company-scaffold]
    exit:
      allOf: [ {decisionsPresent: [framework_choice, component_mapping, scaffold_decision, risks_identified]}, {artifactExists: design_doc} ]
    guard: { forbid: [write-source] }
    next: build

  - id: build
    goal: 按设计实现并自测
    briefing: { from: design, include: [design_doc, decisions] }
    mustResolve: [isolation, build_mode, tdd_mode, tasks_done]
    capabilities: [writing-plans, executing-plans, subagent-driven-development, test-driven-development, requesting-code-review]
    exit:
      allOf: [ {decisionsPresent: [isolation, build_mode, tdd_mode]}, {artifactExists: plan}, {tasksAllChecked: tasks} ]
    guard: {}   # build 允许写源码
    next: verify

  - id: verify
    goal: 验证并处理分支
    briefing: { from: design, include: [design_doc, specs] }
    mustResolve: [verify_passed, branch_handled]
    capabilities: [verification-before-completion, openspec-verify-change, finishing-a-development-branch]
    exit:
      allOf: [ {decisionEquals: {key: verify_result, value: pass}}, {decisionEquals: {key: branch_status, value: handled}}, {artifactExists: verification_report} ]
    onFail: build
    guard: {}
    next: archive

  - id: archive
    goal: 合并主 spec 并归档
    mustResolve: [archived]
    capabilities: [openspec-archive-change]
    exit:
      allOf: [ {decisionEquals: {key: archived, value: "true"}} ]
    guard: { forbid: [write-source] }
    terminal: true
```

---

## B. 事件流走查（空项目「门禁监控」新功能）

每段：事件 → engine 折叠的 state → 该算出的 next-action / exit 判定。

### open
```
phase.enter open
skill.call openspec-explore
note{key:requirements_clear, text:"目标:门禁出入监控;范围:实时告警;非目标:人脸库"}
decision{key:requirements_clear, value:true}
skill.call openspec-new-change
artifact{key:proposal, path:openspec/changes/entrance-monitor/proposal.md}
artifact{key:tasks, path:.../tasks.md}
```
- state: `phase=open, resolved={requirements_clear:true}, artifacts={proposal,tasks}`
- exit(open) = requirements_clear✓ ∧ proposal✓ ∧ tasks✓ → **可过**
- next-action（过前）：`mustResolve:[] resolved:[requirements_clear] → recordWith: hikspine advance`
```
transition{from:open, to:design}
```

### design（进入时 engine 注入 briefing：proposal 摘要 + specs + open 的 decisions）
```
phase.enter design
skill.call brainstorming
note{key:component_mapping, text:"订单/门禁列表→可能 company-table+filter，分页组件待确认"}   ← 在途面包屑
skill.call company-framework
decision{key:framework_choice, value:"Spring Boot 3 + company-starter-iot", srcHash:{proposal:"ab12"}}
```
- state: `phase=design, resolved={…,framework_choice}, notes:[component_mapping 待确认]`
- next-action: `mustResolve:[component_mapping,scaffold_decision,risks_identified] capabilities:[company-component,company-scaffold,…] forbid:[写源码]`

#### ⚡ 断线/压缩点（恢复走查）
> 此刻会话丢失。重连后 `SessionStart` hook 触发 → engine `computeResumeAction`：
```
重放 events → state: phase=design, resolved=[requirements_clear, framework_choice]
最近 note: component_mapping "分页组件待确认"
resume next-action:
  phase: design   goal: 把技术路径想清楚
  resolved: [framework_choice]
  inProgress: [{key:component_mapping, note:"分页组件待确认"}]   ← 来自 note 面包屑
  mustResolve: [component_mapping, scaffold_decision, risks_identified, design_doc]
  capabilities: [company-component, company-scaffold, brainstorming]
  suggestedNext: 续 company-component 确认分页组件，再定 scaffold/risks
```
> ✅ agent 一上来就知道：在 design、framework 已定、component 卡在分页组件、还差哪些。**不靠它记得。**

继续：
```
skill.call company-component
decision{key:component_mapping, value:{"门禁列表":["company-table","company-filter","company-pager"]}, srcHash:{proposal:"ab12"}}
skill.skip{skill:company-scaffold, reason:"existing source detected"}
decision{key:scaffold_decision, value:"skipped", reason:"existing source detected"}
decision{key:risks_identified, value:["第三方门禁SDK限流","断网缓冲"]}
artifact{key:design_doc, path:docs/superpowers/specs/2026-06-26-entrance-monitor-design.md}
```
- exit(design) = 四个 decision✓ ∧ design_doc✓ → **可过**
```
transition{from:design, to:build}
```

### build（briefing：design_doc + design 的 decisions）
```
phase.enter build
decision{key:isolation, value:branch}
decision{key:build_mode, value:executing-plans}
decision{key:tdd_mode, value:tdd}
skill.call writing-plans
artifact{key:plan, path:docs/superpowers/plans/2026-06-26-entrance-monitor.md}
skill.call executing-plans
skill.call test-driven-development
… 写代码（guard 不拦，build 允许）… 勾选 tasks.md …
```
- exit(build) = isolation,build_mode,tdd_mode✓ ∧ plan✓ ∧ **tasksAllChecked(tasks)**✓ → **可过**
- ⚠️ 注意：`tasks_done` 不靠 agent 自己说，靠 `tasksAllChecked` 断言读 tasks.md（见发现 #3）
```
transition{from:build, to:verify}
```

### verify（含 🔁 失败回退走查）
```
phase.enter verify
skill.call verification-before-completion
decision{key:verify_result, value:fail}          ← 先失败
```
- exit(verify) 要 verify_result=pass → **不可过**；verify onFail=build
- 验证失败是用户决策点（修/接受偏差），用户选「修」：
```
transition{from:verify, to:build}                 ← 🔁 回退
… 修复，再次 build→verify …
skill.call verification-before-completion
decision{key:verify_result, value:pass}
artifact{key:verification_report, path:docs/superpowers/reports/…-verify.md}
skill.call finishing-a-development-branch
decision{key:branch_status, value:handled}
```
- exit(verify) = verify_result=pass ∧ branch_status=handled ∧ verification_report✓ → **可过**
```
transition{from:verify, to:archive}
```

### archive
```
phase.enter archive
（归档前最终确认：用户决策点，agent 暂停等确认）
skill.call openspec-archive-change
decision{key:archived, value:"true"}
```
- exit(archive) = archived=true → **terminal，done**。next-action → `NEXT: done`

---

## C. 走查发现（schema 需要收敛的 4 处）

| # | 发现 | 现象 | 建议修正 |
|---|------|------|---------|
| **1** | **`mustResolve` 与 `exit` 是两份、会漂移** | verify 里 `mustResolve:[verify_passed]` 而 `exit` 用 `decisionEquals{verify_result,pass}`——同一件事两种写法，key 都对不上 | **合并成带 label 的 `requires`**：每条 = `{key, 满足来源}`。`next-action.mustResolve`=未满足的 key，`resolved`=已满足的，exit=全满足。一份，构造上不漂移 |
| **2** | **decisions 与 flags 二元重复** | verify_result/branch_status/archived 既像"决策"又像"状态位"，规范里一会 `fieldEquals{flag}` 一会 `decisionEquals` | **取消 flags，全归 decision**：用 `decisionEquals{key,value}` 断言。state 只有 `resolved`，没有单独 flags |
| **3** | **"任务全勾"无法用 decision 表达** | build 的 `tasks_done` 若让 agent 自己 `decision tasks_done=true` 不可靠 | **加 `tasksAllChecked: <artifact>` 断言**，engine 读 tasks.md 机械判定，不信 agent 自述 |
| **4** | 小冗余 | open 早期版本有 `proposal_ready` decision 与 `artifactExists:proposal` 重复 | 删冗余 decision，能用 artifact/断言判的就不另设 decision |

**happy path / 恢复 / verify 回退** 都跑通了；问题集中在"判定来源不统一"。修正后 §2 phase 形如：

```yaml
- id: verify
  briefing: { from: design, include: [design_doc, specs] }
  requires:
    - { key: verify_passed,  decisionEquals: { key: verify_result, value: pass } }
    - { key: branch_handled, decisionEquals: { key: branch_status, value: handled } }
    - { key: report,         artifactExists: verification_report }
  onFail: build
  capabilities: [verification-before-completion, openspec-verify-change, finishing-a-development-branch]
  next: archive
```

`requires[].key` 既是 next-action 给 LLM 看的"待解决项"label，又是 exit 的机械条件——**mustResolve 和 exit 从此是同一份**。
