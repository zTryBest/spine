// Skill discovery. Skills are real Claude Code skills, not abstract ids: a
// capability in a workflow is the skill's own `name` (what the agent passes
// to the Skill tool). We discover them from the same filesystem locations
// Claude Code itself reads — there is no separate registry, and no
// open-source/company distinction; every skill is just a skill.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { PLUGIN_ROOT, readText, rel } from './utils.mjs';
import { parseYaml } from './yaml.mjs';

function homeDir() {
  return process.env.HOME || process.env.USERPROFILE || os.homedir() || '';
}

// Parse a SKILL.md YAML frontmatter block.
function frontmatter(file) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(readText(file));
  if (!m) return {};
  try {
    return parseYaml(m[1]) || {};
  } catch {
    return {};
  }
}

function skillFromDir(dir, scope) {
  const file = path.join(dir, 'SKILL.md');
  if (!fs.existsSync(file)) return null;
  const fm = frontmatter(file);
  return { name: fm.name || path.basename(dir), description: fm.description || '', scope, source: scope, file };
}

// Direct children: <base>/<skill>/SKILL.md
function scanSkillsDir(base, scope) {
  const out = [];
  if (!base || !fs.existsSync(base)) return out;
  for (const d of fs.readdirSync(base, { withFileTypes: true })) {
    if (!d.isDirectory()) continue;
    const s = skillFromDir(path.join(base, d.name), scope);
    if (s) out.push(s);
  }
  return out;
}

// Find every `skills/` directory under a marketplace tree and scan it.
function scanMarketplaces(base, scope) {
  const out = [];
  if (!base || !fs.existsSync(base)) return out;
  const walk = (dir, depth) => {
    if (depth > 6) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const full = path.join(dir, e.name);
      if (e.name === 'skills') out.push(...scanSkillsDir(full, scope));
      else walk(full, depth + 1);
    }
  };
  walk(base, 0);
  return out;
}

// Every skill Claude Code can see, from the same sources it reads. Later
// sources override earlier ones by name, so project skills win.
export function discoverSkills(root) {
  const home = homeDir();
  const sources = [
    scanSkillsDir(path.join(PLUGIN_ROOT, 'skills'), 'local'),
    home ? scanMarketplaces(path.join(home, '.claude', 'plugins', 'marketplaces'), 'marketplace') : [],
    home ? scanSkillsDir(path.join(home, '.claude', 'skills'), 'user') : [],
    scanSkillsDir(path.join(root, '.claude', 'skills'), 'project'),
  ];
  const map = new Map();
  for (const list of sources) {
    for (const s of list) {
      if (!s.name) continue;
      map.set(s.name, { name: s.name, description: s.description, scope: s.scope, source: s.source, path: rel(root, s.file) });
    }
  }
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function skillIndex(root) {
  const map = new Map();
  for (const s of discoverSkills(root)) map.set(s.name, s);
  return map;
}

// Resolve a capability (a skill name) to display info. Unknown names still
// pass through — a workflow may reference a skill that is not installed here.
export function skillInfo(index, name) {
  const hit = index.get(name);
  if (hit) return { id: name, name, description: hit.description, source: hit.source };
  return { id: name, name, description: '', unknown: true };
}

// A workflow capability is either a bare skill name (string) or an object that
// tags the skill with a requirement the workflow author intends:
//   required: true   -> the skill is core to this state; it must be loaded
//   group: <name>    -> several skills are interchangeable; load exactly one
//   when: <text>     -> load only if that condition holds (conditional skill)
// A bare string is untagged: load it whenever its purpose matches the work.
// The engine stays skill-agnostic — it never interprets what a skill does,
// only carries the author's tags through to the agent.
export function normalizeCapability(raw) {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const id = raw.id ?? raw.ref ?? raw.name ?? '';
    const out = { id: String(id) };
    if (raw.ref) out.ref = String(raw.ref);
    if (raw.required === true) out.required = true;
    if (raw.group != null && raw.group !== '') out.group = String(raw.group);
    if (raw.when != null && raw.when !== '') out.when = String(raw.when);
    return out;
  }
  return { id: String(raw ?? '') };
}

// Resolve a workflow capability (string or tagged object) to full display info:
// discovered skill description/source merged with the requirement tags.
export function resolveCapability(index, raw) {
  const cap = normalizeCapability(raw);
  return { ...skillInfo(index, cap.id), ...cap };
}

// Short requirement label for a normalized/resolved capability, '' if untagged.
export function capabilityTag(cap) {
  if (!cap) return '';
  if (cap.required) return 'required';
  if (cap.group) return `one-of:${cap.group}`;
  if (cap.when) return `when ${cap.when}`;
  return '';
}
