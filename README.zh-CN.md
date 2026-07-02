# Hikspine

English docs: [README.md](README.md)

## 项目介绍

Hikspine 是面向 Claude Code 的 skill-first 工作流内核。它把 AI 编程过程变成明确、可恢复、可观察的 workflow：当前阶段、待记录决策、需要加载的能力 skill、用户确认点、阶段产物和看板状态，都由数据驱动，而不是依赖 Agent 记忆。

项目以 Claude Code plugin 形式分发。用户通常通过 `hikspine`、`hikspine-zh`、`hikspine-ui`、`hikspine-global-ui` 这些 skill 入口使用；底层引擎在目标项目里维护状态，并提供很小的 `next` / `decide` 协议。

## 使用场景

- 从零到一创建新项目，先拉真实脚手架，再进入需求、OpenSpec、设计和实现。
- 在已有代码库里开发较大的 feature，覆盖需求澄清、设计、实现、评审、验证和归档。
- 修复 bug 或轻量改动，同时保留精简 OpenSpec 记录，方便看板追踪。
- 同一项目内并行多个 change，避免 active task 和阶段状态混乱。
- 打开单项目或全局多项目看板，查看进行中任务、通知、阶段耗时和产物。
- 团队按自己的流程自定义 workflow 和 capability skill 组合，而不改引擎代码。

## 项目亮点

- **Skill-first 执行**: workflow 的 `capabilities` 是真实 Claude Code skill。Agent 必须加载引擎返回的 skill，不能用手写内联流程替代。
- **决策驱动流转**: `next` 读取状态，`decide` 记录结果，workflow 根据决策确定前进或回退。
- **OpenSpec-backed 状态**: change 默认写到 `openspec/changes/<change>/.hikspine.yaml`，spec、产物和看板数据源保持统一。
- **中英文 workflow**: 内置 workflow 同时提供默认版本和中文版本。`hikspine-zh` 会设置 `HIKSPINE_WORKFLOW_LOCALE=zh`；旧状态文件没有 `workflowLocale` 时默认按中文兼容。
- **本地和全局看板**: `hikspine-ui` 打开当前项目看板，`hikspine-global-ui` 打开本机已登记项目的全局看板。
- **Workflow 编排画布**: 看板可编辑并保存项目 workflow，路径为 `.hikspine/workflows/` 或 `.hikspine/workflows/zh/`。
- **安全 hooks**: Claude Code hooks 可以在禁止写源码的阶段拦截写入、记录待用户处理通知、在 session 结束时清理 UI 进程。
- **项目规则同步**: 引擎会把插件规则同步到 `.claude/rules`，并在本次 session 需要读取新规则时返回 `projectRules.readNow`。

## 如何使用

通过团队的 Claude Code plugin marketplace 或本地 plugin source 安装本仓库。如果 workflow 使用 OpenSpec 产物，需要确保 OpenSpec CLI 在 `PATH` 中可用。

英文入口使用默认 workflow：

```text
Use hikspine to start <change-name>
```

中文入口使用中文 workflow 名称、目标和规则：

```text
使用 hikspine-zh 启动 <change-name>
```

Agent 加载 skill 后，会定位 runtime 并运行引擎：

```bash
node "${HIKSPINE_ENGINE:?source the locator block in this same Bash call}" next <change-name> --workflow <workflow-id> --json
```

当前阶段完成后，记录每个需要的决策：

```bash
node "${HIKSPINE_ENGINE:?source the locator block in this same Bash call}" decide <decision-key> <value> --change <change-name> --json
node "${HIKSPINE_ENGINE:?source the locator block in this same Bash call}" next <change-name> --json
```

常用 workflow id：

- `new`: 从零到一的新项目。
- `feature`: 已有代码库中的较大需求或功能变更。
- `fix`: bug 修复或轻量改动。

项目配置是可选的：

```yaml
# .hikspine/config.yaml
version: 1
defaultWorkflow: feature
guard:
  sourceRoots:
    - src/
    - app/
```

自定义 workflow 可以保存到：

```text
.hikspine/workflows/<workflow-id>.yaml
.hikspine/workflows/zh/<workflow-id>.yaml
```

常用引擎命令：

```bash
node "$HIKSPINE_ENGINE" workflows --json
node "$HIKSPINE_ENGINE" skills --json
node "$HIKSPINE_ENGINE" changes --json
node "$HIKSPINE_ENGINE" board --json
node "$HIKSPINE_ENGINE" ui --project-root /path/to/project
node "$HIKSPINE_ENGINE" ui --all --project-root /path/to/project
```

## 快速开始

1. 在 Claude Code 中安装 Hikspine plugin。
2. 在目标项目根目录打开 Claude Code。
3. 让 Agent 启动一个 workflow：

```text
使用 hikspine-zh 为“登录页接入企业 SSO”启动 feature 工作流
```

4. Agent 运行 `next --json`，读取返回的 `goal`、`rules`、`capabilities` 和 `missing` 决策，并加载所需 capability skill。
5. 当前阶段完成后，Agent 用 `decide` 记录决策，再继续调用 `next`。
6. 需要查看状态时打开看板：

```text
使用 hikspine-ui 打开当前项目看板
```

查看本机所有已登记项目：

```text
使用 hikspine-global-ui 打开全局看板
```

## 后续计划

- 支持 locale-aware project rules，让 `.claude/rules` 能按中文或默认语言同步，避免中英文规则同时出现造成冲突。
- 增强面向服务器的多项目汇总能力，用于团队级使用效果评估。
- 提升 workflow 编排画布校验能力，尤其是 capability 标签和 decision 断言编辑。
- 增强看板中的产物预览、阶段耗时和任务分析能力。
- 优化与 codegraph 等代码探索工具的集成路径。

## 验证

```bash
npm test
```
