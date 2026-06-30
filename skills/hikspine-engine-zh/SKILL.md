---
name: hikspine-engine-zh
description: "Hikspine 引擎中文操作说明。Use when the user wants Chinese guidance on driving Hikspine: the next/decide protocol, decision-driven transitions, acting on a workflow state, user-confirmation checkpoints, or the cross-platform runtime locator."
---

# Hikspine 引擎中文操作说明

`hikspine` 主 skill 的中文版。执行工作流时按本文操作。`/hs ...` 当作自然语言触发，不是 command。引擎设计原理见 `docs/architecture.md`，本文只讲怎么驱动。

## 加载 Runtime

Bash 工具每次调用都是新 shell。定位 runtime 和执行 `node "$HIKSPINE_ENGINE" ...` 必须放在同一次 Bash 调用里。

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

启动或恢复 change：

```bash
node "$HIKSPINE_ENGINE" next <change> --workflow <workflow-id> --json   # 新 change 指定 workflow
node "$HIKSPINE_ENGINE" next <change> --json                            # 已存在则省略 --workflow
```

用户/项目指定了 workflow 就用那个 id；项目配了 `.hikspine/config.yaml` 的 `defaultWorkflow` 时可省略 `--workflow`。

## 选择 workflow

用户没指定、项目也没 `defaultWorkflow` 时，自己选：

```bash
node "$HIKSPINE_ENGINE" workflows --json
```

每个 workflow 声明了 `intent`。选之前**必须先真实检查项目里有没有代码——不要凭感觉判定为空项目**。先探一下项目根目录：

```bash
git -C <项目根目录> ls-files | head        # 已跟踪文件（输出为空 ≈ 全新仓库）
ls -A <项目根目录>                          # 或直接看目录
```

再把需求 + 真实项目现状对照 `intent`：

- **`new`** —— 仅用于几乎没有源码的全新/空仓库（从 0 到 1，含脚手架）。**项目里已经有源码时，绝不选 `new`。**
- **`feature`** —— 已有代码库里的新需求或较大变更。
- **`fix`** —— bug 或小的轻量变动（含线上紧急修复）。

权衡真实信号：是否已有代码（这是 `new` 与其它两者的决定性区别）、影响范围、是否需要设计。两个 workflow 旗鼓相当时用 `AskQuestion` 让用户拍板，不要乱猜。然后用选中的 `--workflow` 启动 change。

多个 change 可以同时在跑，各自一条 workflow：

```bash
node "$HIKSPINE_ENGINE" changes --json
```

`changes` 列出每个运行的 workflow、当前状态和 `nextAction`，用于恢复或在并行 change 间切换；`next <change>` / `decide --change <change>` 指定某一个。想在浏览器里看所有运行的流水线进度，启动本地看板：`node "$HIKSPINE_ENGINE" ui`（默认 `http://127.0.0.1:4319`）。如果从插件目录、用户目录或不在目标项目里的终端启动看板，传 `--project-root <项目根目录>`，或设置 `HIKSPINE_PROJECT_ROOT`；这个全局选项也适用于 `next`、`decide`、`changes`、`workflows`、`skills` 和 `board`。

## 主循环：next → 干活 → decide → next

只有两个动词：

```bash
node "$HIKSPINE_ENGINE" next [change] [--json]
node "$HIKSPINE_ENGINE" decide <key> [value] [--change <change>] [--json]   # value 默认 true，可传 pass/fail
```

```text
调 next         → 看当前状态缺哪些决策（missing）、可组合哪些 skill（capabilities）
用 skill 干活并产出
对每个满足的 needs 调 decide → 引擎自动流转/回退，返回下一个状态
继续，直到 complete: true
```

**让流程前进的唯一动作是 `decide`。** `next` 只读决策、不读文件，单调 `next` 不会前进。干完一个状态的活，必须把它 `needs` 里的每个决策键都 `decide` 一遍。**产出产物后不要停下来问用户“要不要进入下一阶段”**——除非该状态 `requiresUser: true`。决策没记录就停，会卡死整条流程。

## 流转只由 workflow 决定，不由组合的 skill 决定

组合进来的 skill 各有自己的 stance，可能在结束时提供选择、或问“要不要继续 / 要不要落地产物”。**那是该 skill 自身的边界，不是工作流的阶段边界。** 阶段流转只看 workflow：一个状态的 `needs` 决策记齐了就该走。所以任何组合 skill 结束、或抛出“是否继续”时，回到工作流——把该状态的 `needs` 用 `decide` 记下，再 `next`。唯一真正停下来等用户的点是 `requiresUser: true`。组合的 skill 决定“怎么干”，workflow 决定“何时流转”。

## 根据 next 返回行动

```text
nextAction            确定性指令：work | confirm | done（见下）
current/goal/forbid   当前状态、目标、禁止的副作用（如 write-source）
capabilities          可自由组合的 skill（{ id, ref, description }）
rules                 该状态的 workflow 作者声明的硬性要求——必须遵守
needs / missing       离开该状态要记录的决策键 / 其中还没记录的
requiresUser          true = 必须先停下征询用户
rollback/transitions  回退标记 / 本次发生的流转事件
```

**先看 `nextAction`**——它直接告诉你该做什么，不用自己推断：

```text
work     组合 capabilities，把该状态的 needs 用 decide 记下，再 next。不要停下来问“要不要继续”。
confirm  先把活干完，再停下问用户，得到确认后才 decide 那个确认类决策。
done     工作流已完成，无需再做。
```

1. 按 `goal`、`forbid` 明确做什么、禁止什么。读 `rules`，把每一条当作本状态的硬性要求遵守——workflow 可能借此强制使用某个 skill。引擎不强制 `rules`，遵守与否由你负责。
2. 从 `capabilities` 选并加载 skill 去完成。每个 capability 都是真实的 Claude Code skill 名，带 description；挑契合该状态 `goal` 和 `rules` 的加载。明显该用的 skill（如设计阶段 `brainstorming`）不要用手写内容近似替代。
3. 每满足一个决策就 `decide <key> <value>`；带值决策传真实结果（`review_result pass` / `verify_result fail`）。`fail` 会按 `fail_when` 触发跨状态回退并清空下游决策，需重做。
4. 看 `decide` 返回的下一个状态继续循环。

若 `next --json` 返回 `projectRules.readNow`，立刻读取列出的规则文件，让本次 session 吃到规则。

## 用户确认点（requiresUser）

`requiresUser: true`（如 `design` 确认、`archive` 归档）时，**先停下征询用户，得到明确答复后才能 `decide` 那个确认类决策（`design_confirmed`、`archived`）**，不能替用户确认。征询用 `AskQuestion` 逐项问，不要一次性批量丢给用户。技术栈、架构/集成、数据/实时链路必须由用户拍板。

## 语言

按用户当前触发工作流的语言执行：解释、澄清、阶段总结、工作流产物默认同一语言；用户显式切换则跟最新。代码标识符、命令、路径、API 名、引用原文保持原样。

## 内置工作流

```text
new       brainstorm -> openspec -> design -> build -> review -> verify   (从 0 到 1)
feature   open -> design -> build -> review -> verify -> archive    (新需求)
fix       inspect -> fix -> verify                                  (bug / 轻量变动)
```

新增 workflow 放 `.hikspine/workflows/<id>.yaml`，传 `--workflow <id>`，不改本 skill。状态文件由引擎维护，不要手改。
