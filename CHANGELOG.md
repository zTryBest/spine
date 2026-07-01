## What's Changed [0.6.34] - 2026-07-01

### Changed

- **new workflow 新增 scaffold 阶段（在设计之前拉代码 + codegraph 初始化）**: `new` 是从零建项目,原来脚手架是在 `build` 阶段才拉的,导致 `design` 阶段无代码可读、只能凭空设计。现在在 `openspec`(需求澄清)之后、`design` 之前插入一个 `scaffold` 阶段:根据已确认的 proposal 判断本次需要后端、前端还是两者都要,只拉取适用的脚手架(`scaffold-aries-cli` 后端 / `scaffold-starfish-initializr` 前端,均为 `when` 条件加载,可只拉其一或都拉),然后对骨架运行 `codegraph init` 建索引。这样后续 `design` 和 `build` 都能像 `feature` workflow 一样用 codegraph MCP 工具 `codegraph_explore` 读代码、找调用路径,而不是盲目 grep/Read。决策键新增 `scaffolded`;流转变为 `brainstorm → openspec → scaffold → design → build → …`。
- **new.design / new.build 加 codegraph 规则、build 去掉脚手架职责**: `design` 新增"基于已拉取的脚手架代码用 `codegraph_explore` 落地设计"规则;`build` 移除 `scaffold-*` capability 和"脚手架 MANDATORY"规则(已前移到 scaffold 阶段),改为保留执行驱动(二选一)+ `hui-pro`(写 UI 时),并新增"改代码前先用 `codegraph_explore` 定位"规则。`docs/workflows-zh/new.yaml` 与看板 demo 数据同步。
- **scaffold 记录构建清单、hido 读取清单(公司构建流程)**: 代码是按组件标识 + SVN 地址从 SVN 拉的,所以 `scaffold` 阶段新增规则:每拉一个脚手架就把该组件的**组件标识、SVN 地址**及其它项目信息(模块名、构建类型、产物名)追加/更新到 `.hikspine/project-build.json`,作为唯一事实来源;`hido`(SVN 构建/打包)阶段新增规则:直接读这个清单拿组件标识和 SVN 地址来驱动构建打包,不再让用户重新提供(文件缺失才询问)。`new` workflow `version` → 15。

### Tests

- **scaffold 阶段覆盖**: workflow kernel 测试更新 `new` 流程路径为 `brainstorm → openspec → scaffold → design → build`,新增断言验证 `openspec` 后进入 `scaffold`、scaffold 的后端/前端 capability 带 `when` 标签、scaffold 规则含 `codegraph init`、`scaffolded` 决策推进到 `design`、`design`/`build` 规则含 `codegraph_explore`、build 不再包含 `scaffold-*`。共 129 passed。

## What's Changed [0.6.33] - 2026-07-01

### Added

- **SessionEnd hook 诊断日志**: `cleanup-ui.sh` 现在会把 bridge 启动、定位成功或失败写入临时目录 `hikspine-hook-events.log`；`cleanup-ui.mjs` 会把 SessionEnd 开始、项目根解析、候选 UI pid、终止结果和完成状态写入项目 `.hikspine/hook-events.log`。下次 UI 未关闭时可区分是 Claude Code 没触发 hook、bridge 没定位到插件，还是 cleanup 找到 pid 后未能终止。

## What's Changed [0.6.32] - 2026-07-01

### Fixed

- **SessionEnd 清理 UI 更稳定**: UI 启动时除了兼容旧的 `hikspine-ui.pid`，还会维护 `.hikspine/hikspine-ui-pids.json` 注册表，支持同一项目多个 UI 进程；UI 退出时只删除自己的记录，不再无条件删除可能属于新进程的 pid 文件。`SessionEnd` 清理 hook 现在会清理注册表中的所有 Hikspine UI 进程，并在 pid 文件丢失时扫描命令行里绑定当前 `--project-root` 的 UI 进程作为兜底，减少“有时能关、有时没关”的竞态残留。

## What's Changed [0.6.31] - 2026-07-01

### Added

- **capability 需求标签（required / group / when）**: `capabilities` 从扁平的字符串数组升级为可带需求标签的条目，让 workflow 作者显式声明"每个 skill 何时该加载",Agent 不再靠猜。三种标签：`required: true`（阶段核心、必加载）、`group: <名>`（同组可互换、只加载一个,如 build 的 `executing-plans`/`subagent-driven-development` 驱动二选一)、`when: <条件>`（条件加载,如 `hui-pro` 仅写 UI 时、`scaffold-*` 仅无代码时）；不带标签的裸字符串仍表示"用途对得上就加载"。引擎新增 `normalizeCapability`/`resolveCapability`/`capabilityTag`（`src/skills.mjs`），`next` 输出的 capabilities 带上标签、文本渲染成 `[required]`/`[one-of:driver]`/`[when …]`，`capabilityPolicy` 说明每个标签含义。引擎保持 skill-agnostic——只透传作者的标签,从不解释某个 skill 具体干什么。裸字符串写法完全向后兼容,自定义 workflow 无需改动。
- **看板显示需求标签**: 状态看板的阶段技能 chip 现在跟着显示 `required`/`one-of:<组>`/`when …` 小标签（新增 `.cap-tag` 样式）,`/api/*` 经 `normalizeCapability` 输出对象形态,dashboard 同时兼容对象和旧字符串(demo 数据)两种形态。

### Changed

- **三个内置 workflow + 中文阅读版加上需求标签**: `new`/`feature`/`fix` 的所有阶段 capabilities 改用标签形式——核心单技能标 `required`,build 的驱动/脚手架标 `group`、脚手架/`hui-pro` 标 `when`。这把之前只能靠 build 阶段堆一大段 MANDATORY 规则表达的"选驱动不代表能跳过脚手架和 UI"直接结构化。`new`→13、`feature`→12、`fix`→9；`docs/workflows-zh/*` 同步。
- **skill 文档解释标签**: `hikspine`/`hikspine-engine-zh` 的 capabilities 速查表和"必须加载对应 Skill / Required Skill Loading"段落改为讲解四种标签语义,Agent 按标签加载而非自行判断"需不需要"。

### Tests

- **需求标签覆盖**: workflow kernel 测试新增断言,验证 `fix.inspect` capabilities 带 `required` 标签、`next` 的 `capabilityPolicy` 描述了 one-of/when 语义、`new.build` 的驱动与脚手架各自成 `group` 且脚手架/`hui-pro` 带 `when` 标签。

## What's Changed [0.6.30] - 2026-07-01

### Changed

- **capabilities 不再被当成"可选"（review/build 阶段漏加载 skill 的根因）**: 引擎的 `next` 输出把该状态的 capabilities 呈现为 "Available skills (compose freely)"，skill 速查表也写 "可自由组合的 skill" —— "freely / 自由" 这个措辞给了 Agent"可以不加载、自己内联做"的许可，导致 `review` 阶段不加载 `requesting-code-review` 直接手搓自审、`build` 阶段漏 `hui-pro`（此前只能靠给单个阶段堆 MANDATORY 规则打补丁）。改为在引擎层根治且保持 skill-agnostic（不点名任何具体 skill）：`next --json` 新增 `capabilityPolicy` 字段、文本输出把标题改为 "Skills for this state — load each one whose purpose matches the work with the Skill tool before acting"，明确"用途对得上的已列 skill 必须用 Skill 工具加载、不得用内联工作替代；多个可互换驱动则二选一"。中英文 skill（`hikspine`/`hikspine-engine-zh`）的速查表和"必须加载对应 Skill"段落同步收紧，去掉"required by / 需要哪个"的模糊表述。

### Tests

- **capabilityPolicy 覆盖**: workflow kernel 测试新增断言，验证 `next --json` 会返回非空的 `capabilityPolicy` 字段。

## What's Changed [0.6.29] - 2026-07-01

### Added

- **内置 workflow 中文阅读版**: 新增 `docs/workflows-zh/{new,feature,fix}.yaml`，把三个内置 workflow 的意图、阶段目标和规则翻译成中文，保留状态 id、skill 名和决策键等机器字段，方便阅读流程而不会被引擎误加载。

### Changed

- **new workflow build 阶段规则修正（脚手架/UI 技能被跳过）**: build 阶段原规则 "Choose exactly one implementation skill" 让 Agent 以为选完 `executing-plans`/`subagent-driven-development` 就完事，把 `hui-pro`（UI 组件）和 `scaffold-*`（脚手架）漏掉；`hui-pro` 那条又是 "请…执行" 的软措辞、排在最后，且英文规则有拼写错（`exisit`）。改为把 build 明确拆成**三类技能**：执行驱动（二选一）、脚手架（无代码时 MANDATORY）、前端 UI 组件（写 UI 时 MANDATORY 用 `hui-pro`，且强调是"在执行驱动之外、额外加载"）。规则里点明"选了执行驱动不代表可以跳过脚手架和 UI 技能"，capabilities 排序与逗号空格也一并规整。`new` workflow `version` → 12。
  - 注意：这些是软引导（引擎只透传规则、不强制）；前提是 `hui-pro`/`scaffold-*` 等 skill 在运行环境可被发现，Agent 才能用 Skill 工具加载。

## What's Changed [0.6.28] - 2026-07-01

### Changed

- **writing-plans 分片计划**: `new.design` 与 `feature.design` 的 workflow 规则进一步收紧：主 Agent 在派发 planning subAgent 前不得读取 OpenSpec 产物内容；多 spec 或超过 6 个任务组时必须按 spec 拆成多个 Superpowers 子计划，并生成一个短 manifest 总计划 `docs/superpowers/plans/{change}.md` 串联执行顺序、共享契约和集成验证，避免单个 `writing-plans` 子代理生成巨型计划导致超时。

### Tests

- **分片计划规则覆盖**: 扩展 workflow kernel 测试，验证 `new` / `feature` 的 design 阶段都会暴露主上下文零读取、按 spec 分片、子计划路径和 manifest 总计划规则。

## What's Changed [0.6.27] - 2026-06-30

### Changed

- **writing-plans 文件交接**: `new.design` 与 `feature.design` 的 workflow 规则改为要求 subAgent 只接收 OpenSpec 产物路径，不再把 proposal、tasks、specs 内容内联进 prompt；计划产物写到 Superpowers 兼容路径 `docs/superpowers/plans/{change}.md`，主 Agent 只带回计划路径、简要摘要和阻塞点，降低 planning 阶段上下文膨胀和 API 超时风险。

### Tests

- **文件交接规则覆盖**: 扩展 workflow kernel 测试，验证 `new` / `feature` 的 design 阶段都会暴露 file handoff 与 Superpowers plans 输出路径规则。

## What's Changed [0.6.26] - 2026-06-30

### Fixed

- **从代码子目录跑引擎会把 change 建歪（项目根唯一化）**: 引擎 `resolveProjectRoot` 在回退到 cwd 时（没传 `--project-root` / `HIKSPINE_PROJECT_ROOT`），现在用 `findProjectRoot` 向上锚定到**已存在的 Hikspine 项目根**（最近一个带 `openspec/` 或 `.hikspine/` 的上级目录）。这样即使 Agent 在代码子目录（如 `workspace/patpps`，本身是独立 git 仓库）里跑 `next`/`decide`，状态也落到项目根的 `openspec/changes`，不会在子目录里另建一套——与 hook 侧（0.6.24）和存储统一（0.6.25）彻底对齐，`.hikspine`/`openspec` 不再分散。显式传 `--project-root` 时仍原样使用，不走锚定。实测：在子目录无 `--project-root` 跑 `next another-change`，状态落到根 `openspec/changes` ✅。
- **首个 change 的落点提示**: 两份 spine skill 补充——引擎命令在项目根跑或传 `--project-root`；全新项目的第一次 `next` 会在当前目录建状态，要在项目根启动，避免 `openspec/`、`.hikspine/` 落进子文件夹。

## What's Changed [0.6.25] - 2026-06-30

### Changed

- **统一存储：所有工作流默认 OpenSpec-backed（fix 用精简 spec）**: 删掉 `store.mjs` 里按 `workflow.id === 'fix'` 写死的存储判断（`createState` 与 `stateFileFor`），改为**默认 openspec**。这样：所有 change 统一在 `openspec/changes/<change>/`，目录不再分叉；看板的 spec 数据源一致；**自定义工作流零配置即获 OpenSpec 存储（不用改代码、不用写 `storage` 字段）**。standalone 仅作为显式 `--storage standalone` 覆盖项保留，并继续读取历史遗留 change。
- **fix 工作流补一份精简 spec**: `fix.inspect` 增加 `openspec-propose` capability、`proposal_ready` 决策与"保持 proposal 精简（只写 what/why，跳过 design/详细 tasks/specs）"的规则，并 `forbid: write-source`。小改动既快又留痕、还能上看板。`fix` workflow `version` → 8。

### Tests

- **fix 存储与 spec 覆盖**: 更新 fix 工作流测试，验证 fix 状态落在 `openspec/changes/<change>/.hikspine.yaml`、`inspect` 同时暴露 `systematic-debugging` 与 `openspec-propose` 且需要 `issue_understood` + `proposal_ready`。共 113 passed。

## What's Changed [0.6.24] - 2026-06-30

### Fixed

- **`.hikspine` 落到不同目录、文件夹混乱**: 引擎用 `--project-root`/`HIKSPINE_PROJECT_ROOT`/cwd 定位项目根（change 状态写在那里），而 `Notification` / `SessionEnd` hook 用 `gitToplevel(cwd)`——两套不一致。当 Agent 在代码子目录（如 `workspace/patpps`，本身是独立 git 仓库）触发通知时，git 顶层 = 子目录，于是 `notifications.json` 落到了 `子目录/.hikspine`，和 change 状态所在的 `项目根/.hikspine` 分叉。修复：新增 `findProjectRoot()`（`src/utils.mjs`）——从 cwd 向上找**真正的 Hikspine 项目根**（优先认有 `openspec/changes`、`.hikspine/active`、`.hikspine/changes` 的目录，跳过只含通知/pid 的空壳 `.hikspine`），两个 hook 都改用它。这样 notification 与 ui pid 都锚定到引擎写状态的同一个 `.hikspine`，不再按 git 顶层分散，并能绕开已经误建的空壳 `.hikspine`。
  - 历史遗留的空壳目录（如 `workspace/patpps/.hikspine`）可手动删除；新逻辑不会再往那里写。

## What's Changed [0.6.23] - 2026-06-30

### Added

- **看板阶段名称配置**: 阶段显示名从前端内联表迁移到 `dashboard/ui-labels.json`，并新增 `/api/ui-labels` 合并项目级 `.hikspine/ui-labels.json` 覆盖；自定义 workflow 新增阶段时可只配置展示名称，不需要修改 UI 源码或污染 Agent 执行上下文。

### Changed

- **通知改为右下角浮窗**: 看板通知从顶部占位模块改为右下角通知入口、toast 提醒与可关闭浮层，待处理数量通过角标提示，避免通知长期占用任务看板空间。

### Fixed

- **退出 Claude 杀不掉 UI（pid 写错了）**: 真正根因——`hikspine-ui` skill 用 `printf '%s' "$!"` 写 pid，但在 Windows Git Bash 里后台 `node ... &` 的 `$!` 是 **MSYS pid，不是 node.exe 的真实 Windows pid**。SessionEnd cleanup 用 `process.kill` 校验这个假 pid 时判定"已死/陈旧"，删掉 pid 文件却放过了真正的 UI 进程。修复：`hikspine ui` 命令（`startBoard`）**启动时自己把 `process.pid`（真实 OS pid）写进 `.hikspine/hikspine-ui.pid`**，并在自身退出/收到 SIGINT/SIGTERM 时删除；`hikspine-ui` skill 不再写 `$!`，改为读引擎写好的 pid 文件。端到端实测：cleanup 现在能正确终止 UI（`stopped UI pid(s): <real-pid>`，端口释放）。
  - 注意：本修复保证 **`exit` / 正常退出**（触发 `SessionEnd`）能杀掉 UI。`Ctrl-C` 是否触发 `SessionEnd` 取决于 Claude Code 是否在 SIGINT 时执行 SessionEnd hook；若不触发，则需用 `exit` 退出，或后续给 UI 加空闲超时兜底。

## What's Changed [0.6.22] - 2026-06-30

### Fixed

- **恢复 session 后引擎命令静默失败，导致"找不到 change"**: 每次 Bash 调用都是新 shell，环境变量不持久。恢复会话后 Agent 若在与 locator **不同**的 Bash 调用里跑 `node "$HIKSPINE_ENGINE" ...`，`$HIKSPINE_ENGINE` 为空、`node ""` 会**静默退出 0、无任何输出**，Agent 看到空输出就误判"没有进行中的 change / 没有 workflow"，反复瞎试。修复：三份 spine skill（`hikspine`、`hikspine-engine-zh`、`hikspine-ui`）的所有引擎调用改用 `node "${HIKSPINE_ENGINE:?source the locator block in this same Bash call}"`——`$HIKSPINE_ENGINE` 为空时 bash 直接报错退出，而非静默成功；并在"加载 Runtime"段写明该症状（命令无输出且退出 0 = 变量为空，要在同一次 Bash 调用里 source locator，不要据此断定"没有 change"）。



### Added

- **看板通知中心**: 看板顶部的临时通知横幅升级为通知模块，集中展示 Claude 等待用户处理的推送消息，并区分待处理与已处理状态，让实时提示不再挤成单条醒目横幅。
- **通知处理状态**: 通知记录现在带稳定 `id`，看板提供单条“标记处理”和“全部处理”动作，处理后写回 `.hikspine/notifications.json` 的 `handledAt`，刷新后仍能保持状态。

### Fixed

- **看板轮询闪屏**: 2 秒轮询现在会先比较状态快照，数据没有变化时跳过 DOM 重绘；首次渲染后也会关闭任务卡和通知模块的入场动画，避免进行中的任务在周期刷新时反复闪动。

### Tests

- **通知状态覆盖**: 扩展 board 聚合测试，验证旧通知会自动补齐 `id`，并随 `/api/state` 暴露待处理/已处理状态。

## What's Changed [0.6.20] - 2026-06-30

### Fixed

- **归档任务仍显示在看板**: 看板聚合层现在会扫描 `openspec/changes/archive/YYYY-MM-DD-<change>` 下保留下来的 `.hikspine.yaml`，已归档 OpenSpec change 不再从任务看板消失，并会带 `archived` / `archivePath` 标记与“已归档”状态徽章。
- **归档产物继续可预览**: 阶段产物扫描会把归档目录作为产物来源，归档后的 proposal、design、tasks、spec 等 Markdown 仍能在任务卡中展示并预览。

### Tests

- **归档看板覆盖**: 扩展 board 聚合测试，验证归档目录中的 OpenSpec change 会继续出现在 `/api/state` / `board --json`，并保留归档路径和 Markdown 产物。

## What's Changed [0.6.19] - 2026-06-30

### Changed

- **Feature 设计阶段承接 writing-plans**: `feature` workflow 的 `design` 阶段现在同时暴露 `brainstorming` 与 `writing-plans`，先探索技术路径与取舍，再用 `writing-plans` 形成实施设计、任务拆解和验证方案；`build` 阶段保持只负责编码实现候选，不再承担写计划职责。

### Tests

- **设计/实现职责边界覆盖**: 更新 workflow kernel 测试，验证 `feature.design` 返回 `writing-plans`，而 `feature.build` 只返回实现类 capability（`executing-plans` / `subagent-driven-development`）。

## What's Changed [0.6.18] - 2026-06-30

### Changed

- **Build 阶段实现策略选择**: `new` 与 `feature` workflow 的 `build` 阶段不再只走单一实现方式，而是同时暴露 `executing-plans` 与 `subagent-driven-development` 两个候选 skill，并通过阶段 `rules` 要求 Agent 在编辑源码前按任务规模选择一种：小型顺序改动走 `executing-plans`，可拆分、多模块或需要隔离上下文的实现走 `subagent-driven-development`。

### Tests

- **Build capability 覆盖**: 扩展 workflow kernel 测试，验证 `new` / `feature` 的 build 阶段会返回 `executing-plans` 与 `subagent-driven-development`，且不再把 `writing-plans` 当作 build 实现 capability。

## What's Changed [0.6.17] - 2026-06-30

### Fixed

- **Workflow skill 动态强制加载**: `hikspine` 入口 skill、中文操作说明与分发规则明确要求每次 `next --json` 后必须按运行时返回的 `capabilities[].id/ref` 用 Claude Code 的 Skill 工具加载对应 skill，不能把内置 workflow 列表或 capability 描述当成可手写替代；该规则不写死内置 skill，适用于未来新增 capability 和自定义 workflow。

## What's Changed [0.6.16] - 2026-06-30

### Fixed

- **退出 Claude 没杀掉 UI 进程**: `SessionEnd` 清理 hook(`hooks/cleanup-ui.mjs`)原来只从 `payload.cwd` / `process.cwd()` 找 `.hikspine/hikspine-ui.pid`,但 UI 是以 **git 顶层目录**(`--project-root`)启动、pid 写在仓库根。**从子目录退出 Claude 时 cwd 是子目录,就找不到 pid 文件而静默跳过。** 现在对每个候选目录额外解析其 `git rev-parse --show-toplevel`,所以无论在哪个子目录退出都能找到仓库根的 pid 并终止 UI。
- **同名 change 存储冲突保护**: 引擎现在拒绝同一个 change 同时存在于 `openspec/changes` 与 `.hikspine/changes`，并拒绝用不同 workflow 复用已存在 change 名，避免 `fix` 的 standalone 状态与 `feature/new` 的 OpenSpec 状态互相遮蔽。

### Added

- **运行时确认推送到看板(`Notification` hook)**: 看板的"待确认"徽章本是 `nextAction=confirm`(`requires_user` 派生的**静态**状态),不是实时事件。新增 `Notification` hook(`hooks/notify.mjs` + `notify.sh` + `hooks.json`):当 Claude 真正等待用户(`permission_prompt` / `idle_prompt` / `elicitation_dialog`)时,把通知写入项目 `.hikspine/notifications.json`(留最近 20 条,按 git 顶层解析项目根)。`boardState` 带出 `notifications`,看板顶部显示醒目横幅(🔔 + 类型 + 消息 + 相对时间 + 计数,中英双语),并在新通知到达时触发浏览器桌面通知(已授权时)。看板每 2 秒轮询,基本实时。
- **阶段用 subAgent 处理(planning)**: 通过状态 `rules` 引导 Agent 把 writing-plans 放到 subAgent(Task 工具)里跑,并把前序产物喂给它,保持主上下文精简。落点:`new` 的 `design`(喂 OpenSpec 产物)、`feature` 的 `build`(喂 proposal.md + design.md)。纯 workflow `rules` 声明,不改引擎、不改上游 skill。`new`/`feature` 的 workflow `version` 各 +1。

### Tests

- **Change 存储冲突覆盖**: 扩展 workflow kernel 测试，验证同名 change 不能跨 workflow 复用，且双存储位置冲突会被明确拒绝。

## What's Changed [0.6.15] - 2026-06-30

### Changed

- **Markdown 产物预览**: 看板产物弹窗不再显示 Markdown 原始文本，改为渲染标题、段落、列表、表格、引用、代码块和链接，让 proposal、design、tasks、spec 等产物更适合阅读。
- **产物类型标签**: 看板聚合数据为 Markdown 产物增加 `type` 字段，并在任务卡按钮和预览弹窗中显示类型标签，方便区分提案、设计、任务、规格、验证等产物。

### Tests

- **产物类型覆盖**: 扩展 board 聚合测试，验证 proposal、spec 与 verification 产物会输出正确 `type`。

## What's Changed [0.6.14] - 2026-06-30

### Changed

- **看板视觉打磨**: 看板改为更清晰的深色工作台视觉，增强统计卡、任务卡、工作流卡片、阶段产物按钮与预览弹层的层次和交互反馈，让进行中任务、阶段产物和工作流详情在演示时更容易扫描。
- **看板响应式细节**: 优化项目根路径换行、移动端工作流详情换行与流水线横向滚动，避免长路径或多阶段流程在窄屏下挤压内容。

## What's Changed [0.6.13] - 2026-06-30

### Fixed

- **看板产物发现范围**: 看板不再只扫描 `openspec/changes/<change>`，现在会合并 `state.artifacts`、OpenSpec change 目录、`.hikspine/artifacts/<change>`、`.hikspine/changes/<change>` 目录以及常见 docs change 目录中的 Markdown 产物，`fix` 等非 OpenSpec 工作流也能在任务卡里显示阶段产物并预览。
- **阶段产物空状态**: 任务卡在没有发现 Markdown 产物时会显示明确的空状态，避免看起来像“产物预览功能没渲染”。

### Tests

- **非 OpenSpec 产物覆盖**: 扩展 board 聚合测试，验证 `.hikspine/artifacts/<change>` 下的 Markdown 会出现在看板数据中，并按阶段归类。

## What's Changed [0.6.12] - 2026-06-30

### Added

- **codegraph 代码图谱接入（探索阶段）**: 在"已有代码"的工作流的探索阶段，通过状态 `rules` 引导 Agent 优先用 codegraph 的 MCP 工具 `codegraph_explore`（缺图时先 `codegraph init`）来定位符号、调用链与改动影响面，而不是盲目 grep/glob/逐文件读；未安装 codegraph 时回退普通检索。落点：`feature` 的 `open`（澄清时探索）与 `design`（基于代码做设计）、`fix` 的 `inspect`（理解 bug 与 blast radius）。**`new`（空仓库无代码）和 workflow 选择阶段都不接 codegraph**——选择阶段只用轻量 `git ls-files` 判断有无代码，正好决定下游是否走到 codegraph。不改上游 skill、不写进引擎，纯 workflow `rules` 声明。`feature`/`fix` 的 workflow `version` 各 +1。

## What's Changed [0.6.11] - 2026-06-30

### Fixed

- **workflow 自动选择误判空项目**: 修复 Agent 明明项目里有代码、却判成空项目而错选 `new` 的问题。`new`/`feature`/`fix` 的选择原来只在技能里软性提了一句"看是否已有代码"，不够硬。三处（两份 spine skill 的"选择 workflow"段 + 分发规则 `rules/hikspine-workflow.md`）改为：选之前**必须先用命令真实检查**（`git ls-files` / `ls -A`），并加硬规则——`new` 只用于几乎没有源码的全新/空仓库，**项目里已有源码就绝不选 `new`**，改选 `feature` 或 `fix`。"是否已有代码"被明确为 `new` 与其它两者的决定性区别。

## What's Changed [0.6.10] - 2026-06-30

### Fixed

- **Windows 项目根路径规范化**: `hikspine-ui` skill 启动看板前会优先用 `cygpath -aw` 把 Git Bash/MSYS 路径转成 Windows 原生绝对路径，避免 `/e/AI/examples` 或反斜杠路径在 Node 中被当成相对路径，导致看板服务到 `E:\AI\examples\eAIexamples` 这类错误目录。
- **project-root 兜底解析**: 引擎补充识别 `e/AI/examples` 与 `E:AIexamples` 这类轻微损坏的 Windows 路径输入，减少 shell 路径转换异常时被 `path.resolve()` 拼到当前工作目录后的概率。

## What's Changed [0.6.9] - 2026-06-30

### Added

- **SessionEnd 自动清理 UI**: 新增 Claude Code `SessionEnd` hook，在 session 结束时读取当前项目 `.hikspine/hikspine-ui.pid` 并终止对应 UI 进程，避免用户退出会话后看板后台进程继续残留。

### Changed

- **UI 进程清理更安全**: 清理逻辑在能读取命令行时会校验其包含 `hikspine.mjs ui`；命令行不可读取时只清理新鲜 pid 文件，避免陈旧 pid 文件误杀无关进程。

## What's Changed [0.6.8] - 2026-06-30

### Added

- **任务阶段产物预览**: 看板任务卡按阶段展示 `openspec/changes/<change>` 下的 Markdown 产物，并支持在弹层中预览内容，方便在看板中直接核对 proposal、design、tasks 与 specs 等阶段产物。
- **阶段耗时展示**: 看板聚合层根据任务 history 计算每个大阶段的分钟级耗时，任务流水线节点下直接显示累计分钟数，当前阶段会持续计入从进入阶段到现在的时间。
- **工作流阶段技能详情**: 工作流卡片支持点击选中，详情区展示该工作流包含的阶段、阶段目标、needs、流转提示以及对应 capabilities/skills。

### Changed

- **技能区收敛为工作流详情**: 看板不再单独展示全局技能分页；技能信息保留在数据层，用于工作流阶段详情中的 capability 展示与中文说明提示。

### Tests

- **看板聚合数据覆盖**: 扩展 board 聚合测试，验证 workflow 阶段详情、阶段耗时对象与 Markdown 产物扫描会随 `/api/state` / `board --json` 一起输出。

## What's Changed [0.6.7] - 2026-06-29

### Changed

- **new 工作流顺序修正**: `new` 内置工作流改为 `brainstorm -> openspec -> design -> build -> review -> verify`，先使用 `brainstorming` 做头脑风暴，再用 `openspec-propose` 生成 OpenSpec 产物，随后用 `writing-plans` 完成设计确认，最后由 `executing-plans` 进入 build，避免技能名称与阶段语义错位。
- **看板阶段文案同步**: 看板新增 `brainstorm` / `openspec` 阶段的中英双语标签与目标文案，示例数据同步新流程顺序。

### Tests

- **new 工作流流转覆盖**: 更新 `new` 工作流测试，验证从头脑风暴到 OpenSpec、设计、build 的顺序和各阶段 capability 名称。

## What's Changed [0.6.6] - 2026-06-29

### Added

- **任务卡加入时间线（history）+ 决策**: 任务卡（看板最重要的模块）内容更丰富——在流水线 stepper、当前阶段、goal、待办决策之外，新增**时间线**：展示该任务最近的事件（开始 / 进入某阶段 / 决策 key=value / 回退 / 完成），按时间倒序、带相对时间（刚刚 / X 分钟前…）与彩色状态点（蓝=流转、绿=决策、红=失败回退、紫=完成）；时间线头部显示“开始于 X · 已决策 N”。中英双语。
- **board 数据带 history / decisions**: `src/board.mjs` 的 `changeSummary` 现在输出 `history`、`decisions`、`needs`、`startedAt`、`updatedAt`，`/api/state` 与 `hikspine board --json` 同步带出，供看板时间线渲染。示例数据补了真实形态的 history（含一条 verify 失败回退的演示）。

## What's Changed [0.6.5] - 2026-06-29

### Added

- **看板中英双语切换**: 看板右上角加语言切换（中文 / EN，默认中文，记忆在 localStorage）。所有界面文案、阶段名（需求/设计/实现… ↔ Open/Design/Build…）、状态徽章、技能 scope 标签与说明、用法、工作流 intent、阶段 goal 全部双语。上游 skill（brainstorming、writing-plans、openspec-* 等）的 SKILL.md 不可改，因此中文描述用看板内置覆盖层提供，英文回退到引擎发现的真实英文描述；内置 workflow 的英文 intent/goal 来自 YAML，中文由覆盖层提供。示例数据改为英文形态（与真实 `/api/state` 一致），中文由覆盖层渲染，切换语言两边都正确。

## What's Changed [0.6.4] - 2026-06-29

### Changed

- **看板回归只读状态视图**: 移除看板上的“启动一个项目”表单与 `POST /api/launch` 接口。Web 服务驱动不了 Claude Code 的 Agent，旧的“启动”只会 `createState` 建一个停在第 1 阶段、无人推进的任务，容易误导。任务的创建与推进统一由 Agent 在 Claude Code 里通过 `next`/`decide` 完成；看板只展示状态（外加点击卡片切换 active）。`src/server.mjs` 仅保留 `GET /`、`GET /api/state`、`POST /api/active`。
- **术语更正：change → 任务**: 看板把工作单元 `change` 的中文从“项目”改为“任务”（一个项目/仓库里有多个 change）。“进行中的项目”→“进行中的任务”、“项目总数”→“任务总数”、副标题与空状态同步更新。引擎与 CLI 的 `change` / `--change` 标识符保持英文不变。

## What's Changed [0.6.3] - 2026-06-29

### Changed

- **看板技能展示**: Web 看板的“技能”区域从只显示总数改为分页技能卡片，按 Claude Code scope 统计 project、user、local、marketplace 技能，并在卡片中显示中文来源说明、技能说明、用法和路径，方便确认当前项目能读取哪些 capability。

### Tests

- **Skill scope 发现**: 新增 project scope 技能发现断言，验证项目 `.claude/skills` 下的 skill 会带 `scope: project` 出现在看板数据中。

## What's Changed [0.6.2] - 2026-06-29

### Added

- **项目根目录显式选择**: CLI 新增全局 `--project-root <dir>` 与 `HIKSPINE_PROJECT_ROOT`，让 `ui` / `board` / `next` / `decide` 等命令可以从插件安装目录、用户目录或任意终端启动，同时读取目标项目的 `.hikspine` 与 `openspec` 状态，解决插件模式下看板绑定错误目录的问题。
- **Hikspine UI 启动 Skill**: 新增 `hikspine-ui` Claude Code skill，用户可直接要求“启动 Hikspine UI/看板”，由 skill 定位插件运行时并用目标项目根目录后台启动本地看板，减少手写命令和切换目录。

### Changed

- **看板启动说明**: README 与中英文 Hikspine skill 同步说明插件模式下启动看板应传 `--project-root` 或设置 `HIKSPINE_PROJECT_ROOT`，避免用户为启动 UI 专门切换目录。

### Tests

- **跨目录看板读取**: 新增 `board --project-root` 与 `HIKSPINE_PROJECT_ROOT` 覆盖测试，验证从仓库目录启动命令时能读取另一个目标项目的 active change 与状态列表。
- **UI Skill 发现**: 新增 skill 发现断言，确保 `hikspine-ui` 会作为插件 skill 被 `hikspine skills --json` 列出。

## What's Changed [0.6.1] - 2026-06-29

### Changed

- **看板视觉打磨（面向团队演示）**: `dashboard/index.html` 重做视觉——中文流水线 stepper（需求/设计/实现/评审/验证/归档、排查/修复 等阶段中文名，引擎 id 仍为英文），完成阶段绿色对勾、当前阶段脉冲高亮（待确认为黄色），状态徽章中文化（进行中/待确认/完成），顶部统计卡（项目总数/进行中/待用户确认/已完成），渐变背景、卡片阴影与入场动画，工作流图例带中文标签。卡片显示当前阶段 goal。
- **示例数据兜底**: 看板在拿不到 `/api/state`（例如直接打开静态文件、未启动服务）时回退到内置示例数据并标注“示例数据”，方便演示与预览；启动 `hikspine ui` 后自动切回真实状态。

## What's Changed [0.6.0] - 2026-06-29

方向收敛：收紧目录、内置工作流精简到三种、看板回归“只展示状态”（移除编排编辑器，留作后续）。

### Changed

- **目录收紧**: 引擎源码统一到 `src/`（原 `bin/` + `lib/` 合并，CLI 为 `src/hikspine.mjs`），内置工作流移到 `src/workflows/`，看板 UI 放到 `dashboard/`，删除空的 `commands/`。顶层只保留 `.claude-plugin`、`src`、`hooks`、`rules`、`skills`、`dashboard`（外加 `test`/`docs` 等元信息）。同步更新 env 定位器（`HIKSPINE_ENGINE`→`src/hikspine.mjs`、`HIKSPINE_WORKFLOWS_DIR`→`src/workflows`）、`BUILTIN_WORKFLOWS_DIR`、`hooks/guard.mjs` 导入、测试与 README 结构说明。无行为变更。
- **内置工作流精简为三种**: `new`（从 0 到 1，原 new-project）、`feature`（新需求，不变）、`fix`（bug 或轻量变动，合并原 simple-fix + hotfix）。入口仍是 `hikspine`，由 Agent 按 `intent` 自动路由。`store.mjs` 的存储判定改为 `fix` 走 standalone，其余走 OpenSpec。
- **看板回归状态展示**: 看板（`dashboard/index.html`，单页 vanilla JS，2 秒轮询）做成可演示的状态大屏——每个 change 显示其流水线 stepper（阶段进度、当前阶段高亮、按 `nextAction` 着色）、状态徽章、缺失决策，顶部有运行数/进行中/待用户/已完成统计，并列出 workflows 与 skills 数。`board.mjs` 的 `changeSummary` 增加 `stages`/`stageIndex` 供流水线渲染。保留启动/切换 run 接口。

### Removed

- **Workflow 图编辑器（0.5.0 的 Phase 3）**: 移除浏览器内 workflow 编排/编辑（`src/editor-html.mjs`、`/editor` 页面、`/api/workflow` 载入/校验/保存接口），按计划留作后续。看板服务（`src/server.mjs`）只保留 `GET /`（看板）、`GET /api/state`、`POST /api/launch`、`POST /api/active`；看板 HTML 从内联模块改为 `dashboard/index.html` 静态文件。

### Tests

- 路径与 workflow 名跟随重构/精简更新；新 `fix`/`new` 工作流端到端、三个内置 workflow 的列举、块状 YAML roundtrip、看板聚合断言全部通过。共 92 passed。

## What's Changed [0.5.0] - 2026-06-29

可视化编排 Phase 3：浏览器里的 Workflow 图编辑器。按引擎现有的 state-machine YAML 编排，capabilities 从发现的真实 skill 里挑，保存即 `.hikspine/workflows/<id>.yaml`。

### Added

- **Workflow 图编辑器（`/editor`）**: 看板新增 workflow 编辑器（`lib/editor-html.mjs`，单页 vanilla JS）。可加载内置/项目 workflow 或新建，编辑每个 state 的 `id`/`goal`/`forbid`/`requires_user`/`capabilities`/`needs`/`rules`/`next`/`fail_when`+`fail_to`/`terminal`；capabilities 从发现的 skill 名里挑（datalist 补全）；右侧实时 SVG 图（实线 next、红虚线 fail）+ 实时校验。看板头部链接到编辑器。
- **编辑器 HTTP 接口**: `GET /editor`（页面）、`GET /api/workflow?id=`（载入定义）、`POST /api/workflow/validate`（用引擎 `lintWorkflow` 实时校验，不落盘）、`POST /api/workflow/save`（校验 + 写 `.hikspine/workflows/<id>.yaml`，id 做文件名安全校验，保存前清掉空字段）。

### Tests

- 新增编辑器输出 roundtrip：编辑器写出的 block 风格 YAML（`-\n  id: …`，由 `writeYamlFile` 产生）能被引擎正确解析、启动、流转到终态，并在 `workflows` 列表里带 `intent` 正确出现。编辑器 HTTP 接口（载入内置、校验非法 `next`、保存并被引擎载入运行）已手动冒烟验证。共 98 passed。

## What's Changed [0.4.0] - 2026-06-29

可视化编排 Phase 2：本地 web 看板。纯 Node、无第三方依赖，复用 `lib/`，浏览器与 Agent 共享同一批 `.hikspine` 文件，不分叉状态。

### Added

- **本地 web 看板（`hikspine ui`）**: `lib/server.mjs` 起一个 dependency-free 的 `node:http` 服务，默认 `http://127.0.0.1:4319`。看板（`lib/board-html.mjs`，单页 vanilla JS，3 秒轮询）展示所有并发 change（按 `nextAction` work/confirm/done 着色、显示 workflow/当前状态/缺失决策）、可从任一 workflow 启动新 run、点击切换 active。`ui`/`serve` 命令启动，`--port` 可改端口。
- **`board` 命令 + 聚合层**: `hikspine board [--json]` 输出看板数据（`{root, active, changes, workflows, skills}`），与 web 服务 `/api/state` 同源。聚合逻辑抽到 `lib/board.mjs`（`boardState` / `changeSummary` / `listChangeSummaries`），CLI 与服务器共用。
- **看板 HTTP 接口**: `GET /api/state`（聚合）、`POST /api/launch {change, workflow}`（创建并发 run，复用 `createState`，校验 change 名）、`POST /api/active {change}`（切换 active）。两份 spine skill 增加“启动本地看板”一行。

### Changed

- **`cmdChanges` 复用聚合层**: `bin/hikspine.mjs` 的 changes 命令改用 `lib/board.mjs` 的 `listChangeSummaries`，与看板逻辑单一来源。

### Tests

- 新增 `board --json` 聚合断言（changes + workflows + skills + active 全部就位、两个并发 change）。web 服务的 HTTP 层（`GET /`、`/api/state`、`/api/launch` 含非法 change 名拒绝、`/api/active`）已手动冒烟验证通过；因跨平台 file-URL 绑定脆弱未纳入自动套件。共 94 passed。

## What's Changed [0.3.0] - 2026-06-29

可视化编排（界面 + 多 workflow + 自动选流程）的 Phase 1：纯引擎/CLI 底座，可测试，UI 在后续 Phase 叠加。

### Added

- **真实 skill 名作为 capability + skill 发现**: `capabilities` 现在直接写真实的 Claude Code skill 名（如 `writing-plans`、`executing-plans`、`systematic-debugging`），不再是经 registry 映射的抽象 id。新增 `lib/skills.mjs` 的 `discoverSkills`，从 Claude Code 自己读取的同一批文件系统位置发现 skill——项目 `.claude/skills`、个人 `~/.claude/skills`、插件市场 `~/.claude/plugins/marketplaces/**/skills`、本插件 `skills/`——读 `SKILL.md` frontmatter 的 `name`/`description`，按 name 去重并标 source。`capabilities` 解析时从发现结果取 description；未安装的名字仍原样透传（标 `unknown`）。
- **`skills` 命令**: `hikspine skills [--json]` 列出所有可发现的 skill（name/description/source/path），是编排界面挑选器的数据源，也是合法 capability 名的来源。
- **`workflows` 命令 + workflow 级 `intent`**: `hikspine workflows [--json]` 列出所有可用 workflow（内置 + 项目，项目按 id 覆盖内置），每个带 `intent`（声明“何时该用这条流程”）。四个内置 workflow 都补了 `intent`。供 Agent 路由请求到正确流程，也供未来编排界面读取。
- **`changes` 命令（并发运行注册表）**: `hikspine changes [--json]` 扫描所有在跑的 change（两种存储），列出各自的 workflow、当前状态、`nextAction`、缺失决策和是否 active。只读，不会 auto-advance 或改动任何 change。让多个 workflow（new/fix/hotfix）以独立 change 共存，是后续看板的数据源。
- **自动选 workflow（skill 指令）**: 两份 spine skill 增加“选择 workflow”段——用户没指定且无 `defaultWorkflow` 时，读 `workflows --json` 的 `intent`，结合需求与项目现状（紧急度、影响范围、是否已有代码）匹配；两者旗鼓相当时用 `AskQuestion` 让用户拍板。路由判断在 Agent，引擎只提供候选 + intent，保持 skill-agnostic。
- **`lintWorkflow`（给编排界面用）**: `lib/store.mjs` 把 workflow 结构校验抽成不抛异常的 `lintWorkflow`（一次返回全部问题）与共享的 `workflowIssues`，供未来 UI 编辑器校验；`validateWorkflow` 复用同一套规则（仍 fail-fast）。

### Removed

- **registry 与 company 概念**: 删除 `lib/registry.mjs` 及 capability-id→skill 的抽象映射。开源与公司 skill 都只是 skill，不再区分；内置 workflow 的 `superpowers.*` / `openspec.*` 别名换成真实 skill 名，`company.*` 占位（本仓库无对应 skill）从内置 workflow 移除。“换 skill 不改 workflow”现在的含义是：states/transitions（大阶段）是稳定骨架，`capabilities`（每个阶段能用的真实 skill 集合）可自由增删替换。

### Changed

- **`summarize` 抽取（只读状态摘要）**: `lib/transitions.mjs` 抽出 `summarize(workflow, state)`——不 auto-advance、不存盘、不加载 registry，返回 `current/goal/missing/nextAction/rules` 等。`computeNext` 复用它，`changes` 列表也用它逐个汇总并发 change，`nextAction` 判定单一来源。
- **文档同步到无 registry 模型**: `docs/architecture.md`、`README.md`、`README.zh-CN.md` 仍在描述已删除的 Skill Registry 和 `company.*` 命名空间（registry 章节、`registries:` 配置、`company-registry.example.yaml`、`superpowers.*`/`openspec.*` 别名等），照此理解会误以为 capability 要经 registry 映射、公司 skill 与开源 skill 有别。改为：capabilities 是文件系统发现解析的真实 skill 名（项目 `.claude/skills`、个人 `~/.claude/skills`、marketplace、插件四处来源），states/transitions 是稳定骨架、各状态 `capabilities` 可自由增删替换；删除 `templates/company-registry.example.yaml`，并从 `templates/hikspine-config.example.yaml` 及各 `.hikspine/config.yaml` 示例移除 `registries:`；补充 `skills`/`workflows`/`changes` 三个只读命令与 workflow 级 `intent` 的文档。

### Tests

- 新增编排 registry 场景：`workflows` 列出内置且带 `intent`；两个不同 workflow 的 change 并发共存，`changes` 全部列出、逐个报 `nextAction`、正确标记 active。共 90 passed。

## What's Changed [0.2.1] - 2026-06-29

### Added

- **状态级 `rules`（自定义 workflow 声明规则）**: workflow 的状态可声明 `rules` 列表，`computeNext` 原样透传到输出的 `rules` 字段，`formatNextAction` 也打印出来。引擎只搬运、不解析、不强制——这是一个 skill 无关的透传通道，让自定义 workflow 声明本状态的硬性要求（例如“设计阶段必须用 brainstorming 探索备选与权衡”），而不需要把任何上游 skill 名写进引擎或 spine skill。通用纪律仍在 spine skill，具体规则在 workflow，职责分离。内置 `feature` / `new-project` 的 design 状态已示范一条 `rules`；两份 spine skill 和 `rules/hikspine-workflow.md` 增加“读取并遵守状态 `rules`”的通用指令。
- **确定性流转指令 `nextAction`**: `computeNext` 现在输出 `nextAction`（`work` / `confirm` / `done`），把“要不要续跑”从 Agent 推断变成引擎给出的确定性指令——`work` = 组合 capability、`decide`、再 `next`，不要停下来问是否继续；`confirm` = 先干活、再停下让用户确认后才 `decide` 确认类决策；`done` = 工作流完成。判定只来自引擎已有信息（`terminal` / `requires_user` / `missing`），不绑定任何上游 skill。借鉴自 comet 的 `NEXT: auto|manual|done`，但因 Hikspine 是“一个状态多 skill 自由组合 + 决策驱动”，指令指向循环动作而非具体 skill，保持 skill 无关。两份 spine skill 同步说明如何先读 `nextAction`。
- **流转纪律下沉到引擎（skill-agnostic）**: `computeNext` 现在在每次 `next`/`decide` 的返回里带 `transitionPolicy` 字段，`formatNextAction` 也输出同一句提示：阶段流转由 workflow 决定、不由组合的 skill 决定；任何组合 skill 结束或抛出“是否继续”都不是停止点，应记录该状态的 `needs` 再 `next`，唯一真正停下问用户的点是 `requiresUser`。提示是 skill 无关的，不绑定任何上游 skill，符合“引擎只编排、上游 skill 不可改”的设计理念。两份 spine skill 和 `rules/hikspine-workflow.md` 同步补充同一条 skill 无关的流转纪律。

### Fixed

- **入口 skill 与引擎脱钩**: `skills/hikspine/SKILL.md` 和 `skills/hikspine-engine-zh/SKILL.md` 仍在描述已删除的"观察引擎"（`next`-only、`exit.checks`、`nextSkill`/`requiredInputs`/`file.contains_headings`），完全没有 `decide`。照此执行的 Agent 做完一个阶段后只调 `next`、从不 `decide`，决策驱动的状态机停在原状态不动，退化成"要不要进入下一阶段"的临场提问——表现为"没有自动流转"。两份 skill 改写为真实的 `next → 干活 → decide → next` 循环，并明确"让流程前进的唯一动作是 `decide`，产出产物后不要停下来问用户是否进入下一阶段，除非 `requiresUser`"。
- **分发规则同步**: `rules/hikspine-workflow.md`（分发到 `.claude/rules`）原本同样写着 `next` 为唯一协议、`exit.checks` 驱动流转、`nextSkill`/`requiredSkills`/`requiredInputs`，会双重强化错误行为。改为 decide 驱动表述，并保留 `requiresUser`、valued 决策回退、write-source 守卫等规则。

### Changed

- **Skill 精简为操作指令**: 按"SKILL.md 只写 Agent 照着执行的操作指令、不写面向人的说明文档"重写两份 skill，剔除架构原理、引擎内部循环伪代码、状态文件内部结构、各源文件职责清单、守卫内部机制（这些归 `docs/architecture.md`）。`skills/hikspine-engine-zh/SKILL.md` 从约 200 行压到约 80 行，保留 runtime 加载、`next`/`decide` 主循环、字段如何行动、`requiresUser`、语言规则、内置工作流清单。

## What's Changed [0.2.0] - 2026-06-28

### Added

- **Composable state machine kernel**: Replaced the observation engine with a decision-driven state machine (`lib/transitions.mjs`). States declare skill-agnostic `needs` (decision keys) and `capabilities` (composable skills). Advancement is driven by recorded decisions, not by observing files on disk — skills can be freely swapped without changing the workflow graph.
- **Skill registry**: Capability IDs are bound to actual skills via a built-in registry (`lib/registry.mjs`) plus optional project-level overlays. Skills no longer need to know what state they belong to.
- **Cross-state rollback**: States can declare `fail_when` / `fail_to` edges. On failure, all downstream decisions between `fail_to` and the current state are cleared, forcing re-do instead of re-checking stale results.
- **User confirmation gates**: States can declare `requires_user: true` as a hard blocking point (e.g., design confirmation, archive). The engine stops until the user confirms.
- **Guard hook**: `PreToolUse` hook (`hooks/guard.mjs`) that blocks `Write|Edit|MultiEdit` calls when the current state's `forbid: [write-source]` matches the target file. Fail-open design: if no active change, all writes are allowed.
- **Rule sync**: Plugin-authored Markdown rules (`rules/`) are idempotently distributed to project `.claude/rules/` with SHA-256 tracking; locally-edited rules are preserved.
- **Next/decide protocol**: The agent protocol is reduced to exactly two verbs: `next` (show current state, missing decisions, composable capabilities) and `decide` (record a decision; engine auto-advances or rolls back).
- **Builtin workflows v5**: `feature`, `new-project`, `simple-fix`, `hotfix` — all migrated to the states-based YAML format with decision-driven transitions.
- **Project workflow support**: Custom workflows in `.hikspine/workflows/<id>.yaml` take precedence over builtins.
- **Dual storage modes**: OpenSpec-backed changes co-locate state at `openspec/changes/<change>/.hikspine.yaml`; lightweight standalone changes store at `.hikspine/changes/<change>.yaml`.
- **Architecture design document**: `docs/architecture.md` as the authoritative design reference for the engine.
- **Chinese documentation**: `README.zh-CN.md` and `skills/hikspine-engine-zh/SKILL.md`.
- **Company skill registry template**: `templates/company-registry.example.yaml` and `templates/hikspine-config.example.yaml`.

### Changed

- **`skills/hikspine/SKILL.md`**: Rewritten as skill-first entry point; `/hs` is a natural-language convention, not a command file.
- **`skills/hikspine/scripts/hikspine-env.sh`**: Runtime locator searches multiple fallback paths; no longer requires `CLAUDE_PLUGIN_ROOT`.
- **`lib/checks.mjs`**: Retained for guard decisions and optional secondary validation; no longer drives state transitions.
- **CLI**: Rewritten as `bin/hikspine.mjs` with `next` and `decide` subcommands, replacing the old `hikspine-preset.mjs` + `hikspine-state.sh` scripts.
- **Vendor config**: OpenSpec vendored to v1.4.1; `commands/opsx/` directory removed (skills replace slash commands).

### Removed

- **Preset system**: `skills/hikspine/presets/feature.json`, `hotfix.json`, `tweak.json` — replaced by YAML workflows.
- **Observation engine**: `skills/hikspine/scripts/hikspine-state.sh`, `hikspine-preset.mjs`, `hikspine-config.mjs`, `hikspine-hook-guard.sh` — replaced by the composable state machine and guard hook.
- **Old tests**: `test/state-machine.test.sh`, `test/hook-guard.test.sh` — replaced by `test/workflow-kernel.test.sh`.
- **`commands/` directory**: All `opsx/` and `hikspine.md`/`hs.md` command files removed; skills are the entry point.

### Tests

- Full rewrite of `test/workflow-kernel.test.sh`: 80 assertions covering the runtime locator, feature workflow E2E (decision-driven advancement through all states, cross-state rollback with decision clearing, re-do verification), simple-fix and hotfix workflows (standalone storage, rollback), new-project workflow (scaffold state), custom project workflows (states-based YAML format), guard hook (source-write blocking and non-source allow), and edge cases (invalid change names, missing active/change arg errors).

### Security

- Guard hook unifies write-source control: `open`, `design`, and `archive` states forbid writing to configured `sourceRoots`; `build`, `fix`, `patch`, `scaffold` states allow it. The guard is fail-open — if no active change exists or state resolution fails, writes proceed normally.
