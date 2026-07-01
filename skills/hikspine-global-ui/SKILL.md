---
name: hikspine-global-ui
description: "Use when the user asks to start, open, launch, run, or view the Hikspine global UI / all-project board / multi-project dashboard in Claude Code. Use this for all locally registered projects, not just the current project. 启动 Hikspine 全局多项目看板时使用。"
---

# Hikspine Global UI

Use this skill to start the local Hikspine board for all projects registered on this machine. This is the first-stage local aggregation view, not a shared server dashboard.

## Project Scope

Use the current repository as the launch context only. The board itself reads all registered projects from the user's Hikspine home registry.

- If the user gives a project path, use it as `PROJECT_ROOT`.
- Otherwise prefer `git rev-parse --show-toplevel`.
- If the current directory is not a Git repository, use `pwd -P`.
- Do not treat the Hikspine plugin install directory as the target project unless the user explicitly wants to inspect Hikspine itself.
- Do not pass the literal example string `/path/to/your/project`.

## Start The Global Board

Run the locator and the engine command in the same Bash call. Start in the background so Claude Code is not blocked. Default port is `4319`; replace `PORT` when the user asks for another port.

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
LOG_FILE="$PROJECT_ROOT/.hikspine/hikspine-global-ui.log"
PID_FILE="$PROJECT_ROOT/.hikspine/hikspine-ui.pid"

node "${HIKSPINE_ENGINE:?source the locator block in this same Bash call}" ui --all --project-root "$PROJECT_ROOT" --port "$PORT" > "$LOG_FILE" 2>&1 &
sleep 1
cat "$LOG_FILE"
printf 'Hikspine global UI pid: %s\n' "$(cat "$PID_FILE" 2>/dev/null || echo '?')"
printf 'Hikspine global UI log: %s\n' "$LOG_FILE"
```

If the port is occupied, retry with another port:

```bash
PORT=4320
PROJECT_ROOT="/path/to/project"
# then rerun the startup block above
```

## Reply To The User

After a successful start, report the URL, launch project root, registry behavior, log file, and pid file:

```text
Hikspine global UI: http://127.0.0.1:<port>
Launch project root: <project-root>
Scope: all locally registered projects
Log: <project-root>/.hikspine/hikspine-global-ui.log
PID: <project-root>/.hikspine/hikspine-ui.pid
```

If no projects appear, explain that the global board only shows projects that have already run Hikspine once on this machine.
