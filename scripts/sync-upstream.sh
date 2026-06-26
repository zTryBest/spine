#!/usr/bin/env bash
# sync-upstream.sh — vendor OpenSpec & Superpowers skills into hikspine.
#
# Both upstreams distribute through their own installers (not plain git
# subpaths), so we stage them into a throwaway .claude/ via the official
# installer, then snapshot the generated skill/command dirs into the repo.
# Re-running picks up upstream's latest. Pinned refs live in vendor.config.json.
#
# Usage:
#   scripts/sync-upstream.sh                # sync all vendors
#   scripts/sync-upstream.sh superpowers    # sync one vendor
#   scripts/sync-upstream.sh --check        # report drift, write nothing
#   scripts/sync-upstream.sh --check openspec
#
# Cross-platform: macOS / Linux / Windows Git Bash. No `sed -i`; optional
# greps guarded with `|| true` against `pipefail`.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
CONFIG="$REPO_ROOT/vendor.config.json"
LOCK="$REPO_ROOT/VENDOR.lock.json"

red() { printf '\033[31m%s\033[0m\n' "$1" >&2; }
green() { printf '\033[32m%s\033[0m\n' "$1" >&2; }
yellow() { printf '\033[33m%s\033[0m\n' "$1" >&2; }

# --- Args ---

CHECK_ONLY=0
ONLY_VENDOR=""
for arg in "$@"; do
  case "$arg" in
    --check) CHECK_ONLY=1 ;;
    --update) : ;; # ref is 'latest' by default; reserved for future pin bumping
    --*) red "Unknown flag: $arg"; exit 2 ;;
    *) ONLY_VENDOR="$arg" ;;
  esac
done

# --- Dependency checks ---

command -v node >/dev/null 2>&1 || { red "ERROR: node is required (JSON parsing)"; exit 1; }
command -v npx  >/dev/null 2>&1 || { red "ERROR: npx is required (upstream installers)"; exit 1; }
[ -f "$CONFIG" ] || { red "ERROR: $CONFIG not found"; exit 1; }

# --- JSON helpers (node, guaranteed present on Claude Code dev machines) ---

# cfg <vendorName> <jsExprOnVendorObject>  -> prints value or empty
cfg() {
  node -e '
    const c = require(process.argv[1]);
    const v = (c.vendors || []).find(x => x.name === process.argv[2]);
    if (!v) process.exit(3);
    const get = (o, expr) => Function("v", "return (" + expr + ")")(o);
    const out = get(v, process.argv[3]);
    process.stdout.write(out == null ? "" : (typeof out === "string" ? out : JSON.stringify(out)));
  ' "$CONFIG" "$1" "$2"
}

vendor_names() {
  # Trailing newline is required: `while read` skips a final line with no \n.
  node -e '
    const c = require(process.argv[1]);
    const out = (c.vendors || []).map(v => v.name).join("\n");
    process.stdout.write(out ? out + "\n" : "");
  ' "$CONFIG"
}

# capture_pairs <vendorName> -> lines of "from<TAB>to"
capture_pairs() {
  # Trailing newline is required: `while read` skips a final line with no \n.
  node -e '
    const c = require(process.argv[1]);
    const v = (c.vendors || []).find(x => x.name === process.argv[2]);
    const out = (v.capture || []).map(p => p.from + "\t" + p.to).join("\n");
    process.stdout.write(out ? out + "\n" : "");
  ' "$CONFIG" "$1"
}

# lock_paths <vendorName> -> newline-separated previously vendored paths
lock_paths() {
  [ -f "$LOCK" ] || return 0
  node -e '
    const fs = require("fs");
    const lock = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    const v = (lock.vendors || {})[process.argv[2]];
    if (v && Array.isArray(v.paths) && v.paths.length) process.stdout.write(v.paths.join("\n") + "\n");
  ' "$LOCK" "$1" 2>/dev/null || true
}

# record_lock <vendorName> <version> <newline-separated-paths>
record_lock() {
  local name="$1" version="$2" paths="$3"
  PATHS="$paths" node -e '
    const fs = require("fs");
    const lockPath = process.argv[1];
    const lock = fs.existsSync(lockPath) ? JSON.parse(fs.readFileSync(lockPath, "utf8")) : {};
    lock.vendors = lock.vendors || {};
    const paths = (process.env.PATHS || "").split("\n").filter(Boolean);
    lock.vendors[process.argv[2]] = {
      version: process.argv[3] || "unknown",
      syncedAt: new Date().toISOString(),
      paths,
    };
    fs.writeFileSync(lockPath, JSON.stringify(lock, null, 2) + "\n");
  ' "$LOCK" "$name" "$version"
}

# --- Staging ---

mk_stage() { mktemp -d 2>/dev/null || mktemp -d -t hikspine-vendor; }

# stage_vendor <vendorName> <stageDir>  -> populates stageDir/.claude/...
stage_vendor() {
  local name="$1" stage="$2" type
  type="$(cfg "$name" "v.type")"
  case "$type" in
    skills-cli)
      # e.g. npx skills add obra/superpowers -y --agent claude-code
      local cmdJson; cmdJson="$(cfg "$name" "v.stageCmd")"
      yellow "  staging $name via skills CLI ..."
      # </dev/null: keep installers non-interactive and stop them stealing the
      # caller's stdin (which can swallow the vendor list driving the loop).
      ( cd "$stage" && eval "npx $(node -e 'process.stdout.write(JSON.parse(process.argv[1]).join(" "))' "$cmdJson")" </dev/null ) >&2
      ;;
    openspec-init)
      local ref tools pkg profile workflows
      ref="$(cfg "$name" "v.ref")"; ref="${ref:-latest}"
      tools="$(cfg "$name" "v.tools")"; tools="${tools:-claude}"
      pkg="$(cfg "$name" "v.source")"
      profile="$(cfg "$name" "v.profile")"
      workflows="$(cfg "$name" "v.workflows")"   # JSON array string, or empty
      if [ -n "$workflows" ] && [ "$workflows" != "null" ]; then
        # Expanded profile: OpenSpec's "custom" profile generates skills from a
        # configured workflow list. Stage a throwaway openspec config and inject
        # it via XDG_CONFIG_HOME so init produces the full set (notably
        # openspec-new-change and openspec-verify-change).
        local cfghome="$stage/.osconfig"
        mkdir -p "$cfghome/openspec"
        node -e '
          const fs = require("fs");
          const wf = JSON.parse(process.argv[2]);
          fs.writeFileSync(process.argv[1], JSON.stringify(
            { featureFlags: {}, profile: process.argv[3] || "custom", delivery: "both", workflows: wf }, null, 2));
        ' "$cfghome/openspec/config.json" "$workflows" "${profile:-custom}"
        yellow "  staging $name via openspec init (${pkg}@${ref}, profile=${profile:-custom}, expanded workflows) ..."
        ( cd "$stage" && XDG_CONFIG_HOME="$cfghome" npx -y "${pkg}@${ref}" init "$stage" --tools "$tools" --profile "${profile:-custom}" </dev/null ) >&2
      else
        yellow "  staging $name via openspec init (${pkg}@${ref}, tools=${tools}) ..."
        ( cd "$stage" && npx -y "${pkg}@${ref}" init "$stage" --tools "$tools" </dev/null ) >&2
      fi
      ;;
    *)
      red "ERROR: unknown vendor type '$type' for '$name'"; return 1 ;;
  esac
}

# resolve_version <vendorName> <stageDir> -> best-effort version string
resolve_version() {
  local name="$1" stage="$2" type
  type="$(cfg "$name" "v.type")"
  if [ "$type" = "openspec-init" ]; then
    local pkg ref; pkg="$(cfg "$name" "v.source")"; ref="$(cfg "$name" "v.ref")"
    ( cd "$stage" && npx -y "${pkg}@${ref:-latest}" --version </dev/null 2>/dev/null ) | head -1 || echo "latest"
  else
    # skills CLI gives no clean version handle; record the source ref.
    cfg "$name" "v.ref" || echo "latest"
  fi
}

# --- Sync one vendor ---

sync_one() {
  local name="$1"
  green "==> $name"

  local stage; stage="$(mk_stage)"
  # NOTE: do not use `trap ... RETURN` here — a RETURN trap set inside a
  # function fires on the first nested function return (stage_vendor), which
  # would wipe the stage dir before we snapshot it. Clean up explicitly.

  if ! stage_vendor "$name" "$stage"; then
    red "  staging failed for $name"
    rm -rf "$stage"
    return 1
  fi

  local new_paths="" changed=0
  while IFS=$'\t' read -r from to; do
    [ -n "$from" ] || continue
    local src="$stage/$from"
    if [ ! -d "$src" ]; then
      yellow "  (upstream produced no $from)"
      continue
    fi
    local entry name_only dest
    for entry in "$src"/*/; do
      [ -d "$entry" ] || continue
      name_only="$(basename "$entry")"
      dest="$REPO_ROOT/$to/$name_only"
      if [ "$CHECK_ONLY" -eq 1 ]; then
        if [ ! -e "$dest" ]; then
          echo "  NEW    $to/$name_only"
          changed=1
        elif ! diff -rq "$entry" "$dest" >/dev/null 2>&1; then
          echo "  CHANGED $to/$name_only"
          changed=1
        else
          echo "  same   $to/$name_only"
        fi
      else
        rm -rf "$dest"
        mkdir -p "$REPO_ROOT/$to"
        cp -R "$entry" "$dest"
        echo "  +  $to/$name_only"
      fi
      new_paths="${new_paths}${to}/${name_only}"$'\n'
    done
  done < <(capture_pairs "$name")

  if [ "$CHECK_ONLY" -eq 1 ]; then
    if [ "$changed" -eq 1 ]; then
      yellow "  $name: upstream has updates (run without --check to apply)"
    else
      green "  $name: up to date"
    fi
    rm -rf "$stage"
    return 0
  fi

  # Remove stale paths that were vendored previously but are gone upstream.
  local prev
  while IFS= read -r prev; do
    [ -n "$prev" ] || continue
    case $'\n'"$new_paths" in
      *$'\n'"$prev"$'\n'*) : ;; # still present
      *)
        if [ -e "$REPO_ROOT/$prev" ]; then
          rm -rf "$REPO_ROOT/$prev"
          yellow "  -  $prev (removed; gone upstream)"
        fi
        ;;
    esac
  done < <(lock_paths "$name")

  local version; version="$(resolve_version "$name" "$stage" | tr -d '\r')"
  record_lock "$name" "$version" "$new_paths"
  rm -rf "$stage"
  green "  $name: synced (version=${version})"
}

# --- Main ---

if [ -n "$ONLY_VENDOR" ]; then
  if ! vendor_names | grep -qx "$ONLY_VENDOR"; then
    red "ERROR: vendor '$ONLY_VENDOR' not found in vendor.config.json"
    red "Available: $(vendor_names | tr '\n' ' ')"
    exit 1
  fi
  sync_one "$ONLY_VENDOR"
else
  # Collect names into an array FIRST so the sync loop doesn't depend on a live
  # stdin stream that staging installers could consume.
  names=()
  while IFS= read -r v; do
    [ -n "$v" ] && names+=("$v")
  done < <(vendor_names)
  for v in "${names[@]}"; do
    sync_one "$v"
  done
fi

if [ "$CHECK_ONLY" -eq 0 ]; then
  green "Done. Lock: $LOCK"
fi
