#!/bin/bash
# hikspine-state.sh — generic, preset-driven state machine for .hikspine.yaml
#
# Unlike comet (which hardcoded the 5 phases and named transition events), the
# phase graph, exit guards, and transition side effects all come from a preset
# definition under presets/<workflow>.json. Adding a workflow = adding a preset
# file; no code change here.
#
# Usage: hikspine-state.sh <subcommand> <change-name> [args...]
#   init <name> <preset>      Initialize .hikspine.yaml from a preset
#   get <name> <field>        Read a field
#   set <name> <field> <val>  Update a field (enum/path validated)
#   guard <name>              Report current phase exit-guard (no advance)
#   transition <name> <event> Advance via 'complete' or 'fail' (guard-checked)
#   next <name>               Resolve next skill (auto/manual/done)
#   phase <name>              Print current phase id
#
# State file: openspec/changes/<name>/.hikspine.yaml (flat, grep-parseable).

set -euo pipefail

red() { echo -e "\033[31m$1\033[0m" >&2; }
green() { echo -e "\033[32m$1\033[0m" >&2; }
yellow() { echo -e "\033[33m$1\033[0m" >&2; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd -P)"
PRESETS_DIR="${HIKSPINE_PRESETS_DIR:-$(cd "$SCRIPT_DIR/.." && pwd -P)/presets}"
PRESET_JS="${HIKSPINE_PRESET_JS:-$SCRIPT_DIR/hikspine-preset.mjs}"
CONFIG_JS="${HIKSPINE_CONFIG_JS:-$SCRIPT_DIR/hikspine-config.mjs}"

# --- Input validation ---

validate_change_name() {
  local name="$1"
  if [ -z "$name" ]; then red "ERROR: Change name cannot be empty"; exit 1; fi
  if [[ ! "$name" =~ ^[a-zA-Z0-9_-]+$ ]]; then
    red "ERROR: Invalid change name: '$name' (allowed: a-z A-Z 0-9 - _)"; exit 1
  fi
  if [[ "$name" =~ \.\. ]]; then red "ERROR: Change name cannot contain '..'"; exit 1; fi
}

validate_enum() {
  local value="$1"; shift
  local v
  for v in "$@"; do [ "$value" = "$v" ] && return 0; done
  red "ERROR: Invalid value: '$value' (valid: $*)"; exit 1
}

validate_path_field() {
  local value="$1" field="$2"
  if [ -z "$value" ] || [ "$value" = "null" ]; then return 0; fi
  case "$value" in
    /*|~*|[A-Za-z]:*|\\*) red "ERROR: $field must be a relative path within the repo: '$value'"; exit 1 ;;
  esac
  if [[ "$value" =~ \.\. ]]; then red "ERROR: $field cannot contain '..': '$value'"; exit 1; fi
}

# --- Flat YAML helpers (same approach as comet) ---

strip_inline_comment() {
  printf '%s\n' "$1" | awk -v squote="'" '
    { out=""; quote=""
      for (i=1;i<=length($0);i++){ c=substr($0,i,1)
        if(quote==""){ if(c=="\""||c==squote){quote=c}
          else if(c=="#"&&(i==1||substr($0,i-1,1)~/[[:space:]]/)){sub(/[[:space:]]+$/,"",out);print out;next} }
        else if(c==quote){quote=""}
        out=out c }
      print out }'
}

strip_wrapping_quotes() {
  case "$1" in
    \"*\") printf '%s\n' "${1:1:${#1}-2}" ;;
    \'*\') printf '%s\n' "${1:1:${#1}-2}" ;;
    *) printf '%s\n' "$1" ;;
  esac
}

yaml_field() {
  local field="$1" file="$2" value
  if [ -f "$file" ]; then
    value=$(grep "^${field}:" "$file" 2>/dev/null | sed "s/^${field}: *//" || true)
    value=$(strip_inline_comment "$value")
    strip_wrapping_quotes "$value"
  fi
}

replace_yaml_field() {
  local file="$1" field="$2" value="$3" tmp
  tmp=$(mktemp); chmod 600 "$tmp"
  awk -v field="$field" -v value="$value" '
    index($0, field ":")==1 { $0 = field ": " value }
    { buf[NR]=$0; keys[NR]=$0; sub(/:.*$/,"",keys[NR]); n=NR }
    END { for(i=1;i<=n;i++) last[keys[i]]=i
          for(i=1;i<=n;i++) if(last[keys[i]]==i) print buf[i] }
  ' "$file" > "$tmp"
  mv "$tmp" "$file"
}

file_nonempty() { [ -f "$1" ] && [ -s "$1" ]; }

change_dir_for() {
  local n="$1"
  if [ -d "openspec/changes/$n" ]; then echo "openspec/changes/$n"
  elif [ -d "openspec/changes/archive/$n" ]; then echo "openspec/changes/archive/$n"
  else echo "openspec/changes/$n"; fi
}

yaml_file_for() { echo "$(change_dir_for "$1")/.hikspine.yaml"; }

# --- Preset access (via node helper) ---

preset_file_for() {
  local wf; wf=$(cmd_get "$1" workflow)
  echo "$PRESETS_DIR/${wf}.json"
}

preset_q() {
  # preset_q <change> <command> [args...]
  local change="$1"; shift
  local pf; pf=$(preset_file_for "$change")
  if [ ! -f "$pf" ]; then red "ERROR: preset not found: $pf"; exit 1; fi
  node "$PRESET_JS" "$pf" "$@"
}

today_utc() { date -u +%Y-%m-%d; }

# --- init ---

cmd_init() {
  local change_name="$1" preset="$2"
  validate_change_name "$change_name"
  local pf="$PRESETS_DIR/${preset}.json"
  if [ ! -f "$pf" ]; then
    red "ERROR: unknown preset '$preset' (looked for $pf)"
    red "Available: $(ls "$PRESETS_DIR" 2>/dev/null | sed 's/\.json$//' | tr '\n' ' ')"
    exit 1
  fi

  local change_dir yaml_file
  change_dir=$(change_dir_for "$change_name")
  yaml_file=$(yaml_file_for "$change_name")
  if [ -f "$yaml_file" ]; then red "ERROR: .hikspine.yaml already exists at $yaml_file"; exit 1; fi
  mkdir -p "$change_dir"

  local first_phase base_ref="null"
  first_phase=$(node "$PRESET_JS" "$pf" first-phase)
  if git rev-parse --verify HEAD >/dev/null 2>&1; then
    base_ref=$(git rev-parse HEAD 2>/dev/null || echo "null")
  fi

  {
    echo "workflow: $preset"
    echo "phase: $first_phase"
    # Preset-declared defaults
    node "$PRESET_JS" "$pf" defaults | while IFS=$'\t' read -r k v; do
      [ -n "$k" ] && echo "$k: $v"
    done
    # Standard runtime fields
    echo "auto_transition: true"
    echo "base_ref: $base_ref"
    echo "verify_result: pending"
    echo "verification_report: null"
    echo "branch_status: pending"
    echo "created_at: $(today_utc)"
    echo "verified_at: null"
    echo "archived: false"
  } > "$yaml_file"

  green "Initialized: $yaml_file (preset=$preset, phase=$first_phase)"
}

# --- get / set ---

cmd_get() {
  local change_name="$1" field="$2"
  validate_change_name "$change_name"
  local yaml_file; yaml_file=$(yaml_file_for "$change_name")
  if [ ! -f "$yaml_file" ]; then red "ERROR: .hikspine.yaml not found at $yaml_file"; exit 1; fi
  local value; value=$(yaml_field "$field" "$yaml_file")
  if [ "$field" = "auto_transition" ] && { [ -z "$value" ] || [ "$value" = "null" ]; }; then value="true"; fi
  echo "${value:-}"
}

cmd_set() {
  local change_name="$1" field="$2" value="$3"
  validate_change_name "$change_name"
  local yaml_file; yaml_file=$(yaml_file_for "$change_name")
  if [ ! -f "$yaml_file" ]; then red "ERROR: .hikspine.yaml not found at $yaml_file"; exit 1; fi

  case "$field" in
    phase)
      if [ "${_HS_IN_TRANSITION:-}" != "1" ] && [ "${HIKSPINE_FORCE_PHASE:-}" != "1" ]; then
        red "ERROR: Setting 'phase' directly is not allowed; it bypasses guard checks."
        red "  Use: hikspine-state.sh transition <name> complete|fail"
        red "  Repair-only: HIKSPINE_FORCE_PHASE=1 hikspine-state.sh set <name> phase <value>"
        exit 1
      fi
      # phase must be a valid phase of this change's preset
      local valid_phases; valid_phases=$(preset_q "$change_name" phases | tr '\n' ' ')
      validate_enum "$value" $valid_phases
      ;;
    workflow)
      [ -f "$PRESETS_DIR/${value}.json" ] || { red "ERROR: no preset '$value' under $PRESETS_DIR"; exit 1; } ;;
    build_mode)        validate_enum "$value" "subagent-driven-development" "executing-plans" "direct" "null" ;;
    build_pause)       validate_enum "$value" "null" "plan-ready" ;;
    subagent_dispatch) validate_enum "$value" "null" "confirmed" ;;
    tdd_mode)          validate_enum "$value" "tdd" "direct" "null" ;;
    review_mode)       validate_enum "$value" "off" "standard" "thorough" "null" ;;
    isolation)         validate_enum "$value" "branch" "worktree" "null" ;;
    verify_mode)       validate_enum "$value" "light" "full" "null" ;;
    auto_transition)   validate_enum "$value" "true" "false" ;;
    verify_result)     validate_enum "$value" "pending" "pass" "fail" ;;
    branch_status)     validate_enum "$value" "pending" "handled" ;;
    archived)          validate_enum "$value" "true" "false" ;;
    direct_override)   validate_enum "$value" "true" "false" ;;
    design_doc|plan|verification_report|handoff_context|handoff_hash)
      validate_path_field "$value" "$field" ;;
    verified_at|created_at|base_ref|build_command|verify_command)
      : ;;
    *)
      red "ERROR: Unknown field: '$field'"; exit 1 ;;
  esac

  if grep -q "^${field}:" "$yaml_file"; then
    replace_yaml_field "$yaml_file" "$field" "$value"
  else
    echo "${field}: ${value}" >> "$yaml_file"
  fi
  green "[SET] ${field}=${value}"
}

# --- Generic guard evaluator ---

# Reads phase-info GUARD lines for the current phase and checks each primitive
# against the flat .hikspine.yaml + change dir. Prints failures to stderr.
# Returns 0 if all pass, 1 otherwise.
eval_guard() {
  local change_name="$1" phase="$2"
  local change_dir info block=0
  change_dir=$(change_dir_for "$change_name")
  info=$(preset_q "$change_name" phase-info "$phase")

  local line kind field op rest val
  while IFS= read -r line; do
    [ -n "$line" ] || continue
    kind=$(printf '%s' "$line" | cut -f1)
    case "$kind" in
      ARTIFACT)
        field=$(printf '%s' "$line" | cut -f2)
        if file_nonempty "$change_dir/$field"; then
          green "  [PASS] artifact $field"
        else
          red "  [FAIL] artifact missing/empty: $field"; block=1
        fi
        ;;
      STATE)
        field=$(printf '%s' "$line" | cut -f2)
        op=$(printf '%s' "$line" | cut -f3)
        val=$(cmd_get "$change_name" "$field")
        case "$op" in
          exists)
            if [ -n "$val" ] && [ "$val" != "null" ] && [ -f "$val" ]; then
              green "  [PASS] $field exists ($val)"
            else
              red "  [FAIL] $field must point to an existing file (got '${val:-null}')"; block=1
            fi
            ;;
          set)
            if [ -n "$val" ] && [ "$val" != "null" ]; then
              green "  [PASS] $field set ($val)"
            else
              red "  [FAIL] $field must be set (got '${val:-null}')"; block=1
            fi
            ;;
          eq)
            rest=$(printf '%s' "$line" | cut -f4)
            if [ "$val" = "$rest" ]; then
              green "  [PASS] $field=$val"
            else
              red "  [FAIL] $field must be '$rest' (got '${val:-null}')"; block=1
            fi
            ;;
          in)
            rest=$(printf '%s' "$line" | cut -f4-)
            local found=0 opt
            while IFS= read -r opt; do [ "$val" = "$opt" ] && found=1; done < <(printf '%s' "$rest" | tr '\t' '\n')
            if [ "$found" = "1" ]; then
              green "  [PASS] $field=$val (allowed)"
            else
              red "  [FAIL] $field must be one of [$(printf '%s' "$rest" | tr '\t' ',')] (got '${val:-null}')"; block=1
            fi
            ;;
        esac
        ;;
    esac
  done <<< "$info"

  return "$block"
}

cmd_guard() {
  local change_name="$1"
  validate_change_name "$change_name"
  local phase; phase=$(cmd_get "$change_name" phase)
  echo "=== Guard: $change_name (phase=$phase) ===" >&2
  if eval_guard "$change_name" "$phase"; then
    green "ALL CHECKS PASSED — ready to advance"
    return 0
  else
    red "BLOCKED — fix failing checks before advancing"
    return 1
  fi
}

# --- Transition ---

# info_field <info> <KEY> -> first value column for a single-row key
info_field() {
  printf '%s\n' "$1" | awk -F'\t' -v k="$2" '$1==k {print $2; exit}'
}

apply_sets() {
  # apply_sets <change> <info> <SET_COMPLETE|SET_FAIL>
  local change="$1" info="$2" tag="$3" field value
  while IFS=$'\t' read -r _ field value; do
    [ -n "$field" ] || continue
    [ "$value" = "@date" ] && value="$(today_utc)"
    cmd_set "$change" "$field" "$value" >/dev/null
  done < <(printf '%s\n' "$info" | awk -F'\t' -v t="$tag" '$1==t')
}

cmd_transition() {
  local change_name="$1" event="$2"
  local _HS_IN_TRANSITION=1
  validate_change_name "$change_name"
  validate_enum "$event" "complete" "fail"

  local phase info terminal on_complete on_fail target
  phase=$(cmd_get "$change_name" phase)
  info=$(preset_q "$change_name" phase-info "$phase")
  terminal=$(info_field "$info" TERMINAL)
  on_complete=$(info_field "$info" ON_COMPLETE)
  on_fail=$(info_field "$info" ON_FAIL)

  if [ "$event" = "complete" ]; then
    echo "=== Transition: $change_name $phase --complete--> ===" >&2
    if ! eval_guard "$change_name" "$phase"; then
      red "BLOCKED — guard failed; cannot complete phase '$phase'"
      exit 1
    fi
    if [ "$terminal" = "1" ]; then
      apply_sets "$change_name" "$info" SET_COMPLETE
      green "[TRANSITION] $phase complete (terminal)"
      return 0
    fi
    if [ -z "$on_complete" ]; then
      red "ERROR: phase '$phase' has no onComplete target and is not terminal"; exit 1
    fi
    target="$on_complete"
    cmd_set "$change_name" phase "$target" >/dev/null
    apply_sets "$change_name" "$info" SET_COMPLETE
    green "[TRANSITION] $phase --complete--> $target"
  else
    echo "=== Transition: $change_name $phase --fail--> ===" >&2
    if [ -z "$on_fail" ]; then
      red "ERROR: phase '$phase' has no onFail target"; exit 1
    fi
    target="$on_fail"
    cmd_set "$change_name" phase "$target" >/dev/null
    apply_sets "$change_name" "$info" SET_FAIL
    green "[TRANSITION] $phase --fail--> $target"
  fi
}

# --- next ---

cmd_next() {
  local change_name="$1"
  validate_change_name "$change_name"
  local phase archived auto skill
  phase=$(cmd_get "$change_name" phase)
  archived=$(cmd_get "$change_name" archived)
  auto=$(cmd_get "$change_name" auto_transition)

  if [ "$archived" = "true" ]; then echo "NEXT: done"; return 0; fi
  skill=$(preset_q "$change_name" skill "$phase")
  if [ -z "$skill" ]; then red "ERROR: no skill mapped for phase '$phase'"; exit 1; fi

  if [ "$auto" = "false" ]; then
    echo "NEXT: manual"; echo "SKILL: $skill"; echo "HINT: phase is '$phase'; run /$skill manually to continue"
  else
    echo "NEXT: auto"; echo "SKILL: $skill"
  fi
}

cmd_phase() { cmd_get "$1" phase; }

# --- Provider resolution + step composition ---
#
# Each preset phase declares ordered "steps" (role + default skill). A project's
# .hikspine/config.json can, WITHOUT forking the plugin or editing presets:
#   - override a step's skill   (config.providers, priority below)
#   - insert new steps          (config.extra_steps, at named positions)
# All resolution/merging is done in hikspine-config.mjs (JSON, structured).
#
# Override priority (most specific wins):
#   providers["<workflow>.<phase>.<role>"] > ["<phase>.<role>"] > ["<role>"]

# steps <change> <phase>  -> resolved "role<TAB>skill<TAB>note" lines
cmd_steps() {
  local change_name="$1" phase="$2"
  validate_change_name "$change_name"
  local wf pf
  wf=$(cmd_get "$change_name" workflow)
  pf=$(preset_file_for "$change_name")
  node "$CONFIG_JS" resolve-steps "$pf" "$phase" "$wf" ".hikspine/config.json"
}

# provider <change> <phase> <role>  -> resolved skill for one role
cmd_provider() {
  local change_name="$1" phase="$2" role="$3"
  cmd_steps "$change_name" "$phase" | awk -F'\t' -v r="$role" '$1==r {print $2; exit}'
}

# config-get <key>  -> scalar from project .hikspine/config.json (empty if absent)
cmd_config_get() {
  node "$CONFIG_JS" get ".hikspine/config.json" "$1"
}

# --- Step execution status (resume / audit) ---
#
# Records per-step outcomes to openspec/changes/<name>/.hikspine/steps.json so
# resume after compaction/interruption is reliable and the run is auditable.

# step-record <change> <phase> <role> <status> [evidence] [reason]
cmd_step_record() {
  local change_name="$1" phase="$2" role="$3" status="$4" evidence="${5:-}" reason="${6:-}"
  validate_change_name "$change_name"
  validate_enum "$status" "pending" "done" "failed" "skipped"
  local dir file skill
  dir="$(change_dir_for "$change_name")/.hikspine"
  file="$dir/steps.json"
  mkdir -p "$dir"
  skill=$(cmd_provider "$change_name" "$phase" "$role" 2>/dev/null || true)
  SKILL="$skill" STATUS="$status" EVID="$evidence" REASON="$reason" node -e '
    const fs = require("fs");
    const f = process.argv[1], phase = process.argv[2], role = process.argv[3];
    const j = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) : { steps: [] };
    j.steps = j.steps || [];
    let e = j.steps.find((s) => s.phase === phase && s.role === role);
    if (!e) { e = { phase, role }; j.steps.push(e); }
    if (process.env.SKILL) e.skill = process.env.SKILL;
    e.status = process.env.STATUS;
    if (process.env.EVID) e.evidence = process.env.EVID;
    if (process.env.REASON) e.reason = process.env.REASON;
    e.updated_at = new Date().toISOString();
    if (process.env.STATUS === "done" || process.env.STATUS === "skipped") e.completed_at = e.updated_at;
    fs.writeFileSync(f, JSON.stringify(j, null, 2) + "\n");
  ' "$file" "$phase" "$role"
  green "[STEP] ${phase}/${role} = ${status}${skill:+ ($skill)}"
}

# step-list <change>  -> "phase\trole\tskill\tstatus\tevidence\tcompleted_at\treason"
cmd_step_list() {
  local change_name="$1"
  validate_change_name "$change_name"
  local file; file="$(change_dir_for "$change_name")/.hikspine/steps.json"
  if [ ! -f "$file" ]; then echo "(no steps recorded)"; return 0; fi
  node -e '
    const j = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
    for (const s of (j.steps || []))
      console.log([s.phase, s.role, s.skill || "", s.status || "", s.evidence || "", s.completed_at || "", s.reason || ""].join("\t"));
  ' "$file"
}

# Entry check: confirm .hikspine.yaml exists and current phase matches expected.
cmd_check() {
  local change_name="$1" expected="$2"
  validate_change_name "$change_name"
  local yaml_file; yaml_file=$(yaml_file_for "$change_name")
  if [ ! -f "$yaml_file" ]; then red "ERROR: .hikspine.yaml not found at $yaml_file"; exit 1; fi
  local valid_phases; valid_phases=$(preset_q "$change_name" phases | tr '\n' ' ')
  validate_enum "$expected" $valid_phases
  local phase; phase=$(cmd_get "$change_name" phase)
  echo "=== Entry Check: $change_name (expect phase=$expected) ===" >&2
  if [ "$phase" = "$expected" ]; then
    green "[PASS] phase=$phase"
    return 0
  else
    red "[FAIL] phase=$phase (expected $expected) — 该阶段尚未就绪或需先推进"
    return 1
  fi
}

# --- Main ---

SUB="${1:-}"; shift || true
case "$SUB" in
  init)       [ $# -ge 2 ] || { red "Usage: init <name> <preset>"; exit 1; }; cmd_init "$@" ;;
  get)        [ $# -ge 2 ] || { red "Usage: get <name> <field>"; exit 1; }; cmd_get "$@" ;;
  set)        [ $# -ge 3 ] || { red "Usage: set <name> <field> <value>"; exit 1; }; cmd_set "$@" ;;
  guard)      [ $# -ge 1 ] || { red "Usage: guard <name>"; exit 1; }; cmd_guard "$@" ;;
  check)      [ $# -ge 2 ] || { red "Usage: check <name> <phase>"; exit 1; }; cmd_check "$@" ;;
  transition) [ $# -ge 2 ] || { red "Usage: transition <name> complete|fail"; exit 1; }; cmd_transition "$@" ;;
  next)       [ $# -ge 1 ] || { red "Usage: next <name>"; exit 1; }; cmd_next "$@" ;;
  phase)      [ $# -ge 1 ] || { red "Usage: phase <name>"; exit 1; }; cmd_phase "$@" ;;
  steps)      [ $# -ge 2 ] || { red "Usage: steps <name> <phase>"; exit 1; }; cmd_steps "$@" ;;
  provider)   [ $# -ge 3 ] || { red "Usage: provider <name> <phase> <role>"; exit 1; }; cmd_provider "$@" ;;
  config-get) [ $# -ge 1 ] || { red "Usage: config-get <key>"; exit 1; }; cmd_config_get "$@" ;;
  step-record) [ $# -ge 4 ] || { red "Usage: step-record <name> <phase> <role> <status> [evidence] [reason]"; exit 1; }; cmd_step_record "$@" ;;
  step-list)  [ $# -ge 1 ] || { red "Usage: step-list <name>"; exit 1; }; cmd_step_list "$@" ;;
  *)
    red "Unknown subcommand: $SUB"
    echo "Subcommands: init, get, set, guard, transition, next, phase" >&2
    exit 1 ;;
esac
