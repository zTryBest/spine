---
name: hikspine-ui
description: "Use when the user asks to start, open, launch, run, or view the Hikspine UI / board / dashboard in Claude Code, especially when Hikspine is installed as a plugin and the board must read the current project via --project-root. 启动 Hikspine 看板、UI、dashboard 时使用。"
---

# Hikspine UI

启动 Hikspine 本地看板时使用本 skill。目标是让用户不需要切换到插件目录或手写 `node "${HIKSPINE_ENGINE:?source the locator block in this same Bash call}" ui --project-root ...`。

## 选择项目根目录

先确定看板要读取哪个项目：

- 用户明确给了项目路径时，使用用户给的路径。
- 否则优先使用当前仓库根目录：`git rev-parse --show-toplevel`。
- 如果当前目录不是 Git 仓库，使用 `pwd -P`。
- 不要把 Hikspine 插件安装目录当作项目根，除非用户明确是在看 Hikspine 插件仓库本身。
- 不要把示例字符串 `/path/to/your/project` 原样传给命令。

## 启动看板

在 Claude Code 里默认后台启动，避免 Bash 工具被长时间占住。端口默认 `4319`；用户指定端口时替换 `PORT`。

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

_hs_project_root() {
  local r="${PROJECT_ROOT:-}"
  if [ -z "$r" ]; then r="$(git rev-parse --show-toplevel 2>/dev/null || pwd -P)"; fi
  if command -v cygpath >/dev/null 2>&1; then
    cygpath -aw "$r" 2>/dev/null && return 0
  fi
  printf '%s\n' "$r"
}

PROJECT_ROOT="$(_hs_project_root)"
PORT="${PORT:-4319}"
mkdir -p "$PROJECT_ROOT/.hikspine"
LOG_FILE="$PROJECT_ROOT/.hikspine/hikspine-ui.log"
PID_FILE="$PROJECT_ROOT/.hikspine/hikspine-ui.pid"

# Do NOT write "$!" to the pid file. In Git Bash on Windows "$!" is the MSYS
# pid, not node.exe's Windows pid, so the SessionEnd cleanup hook can never
# kill it. The engine writes its own real pid to "$PID_FILE" on startup.
node "${HIKSPINE_ENGINE:?source the locator block in this same Bash call}" ui --project-root "$PROJECT_ROOT" --port "$PORT" > "$LOG_FILE" 2>&1 &
sleep 1
cat "$LOG_FILE"
printf 'Hikspine UI pid: %s\n' "$(cat "$PID_FILE" 2>/dev/null || echo '?')"
printf 'Hikspine UI log: %s\n' "$LOG_FILE"
```

如果端口被占用，用另一个端口重试：

```bash
PORT=4320
PROJECT_ROOT="/path/to/project"
# 然后重新运行上面的启动块。
```

## 回复用户

启动成功后，把 URL、项目根目录、日志文件和 pid 文件告诉用户：

```text
Hikspine UI: http://127.0.0.1:<port>
Project root: <project-root>
Log: <project-root>/.hikspine/hikspine-ui.log
PID: <project-root>/.hikspine/hikspine-ui.pid
```

如果启动失败，读取日志并说明失败原因。常见原因是端口被占用，建议换端口重试。
