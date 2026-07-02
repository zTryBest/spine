import fs from 'node:fs';
import path from 'node:path';
import {
  BUILTIN_WORKFLOWS_DIR,
  clone,
  die,
  ensureDir,
  nowIso,
  readText,
  rel,
  sha256,
  validateChangeName,
  writeText,
} from './utils.mjs';
import { readYamlFile, writeYamlFile } from './yaml.mjs';
import { hikspineHome } from './project-registry.mjs';

export function readConfig(root) {
  const yaml = path.join(root, '.hikspine', 'config.yaml');
  if (fs.existsSync(yaml)) return readYamlFile(yaml);
  const json = path.join(root, '.hikspine', 'config.json');
  if (fs.existsSync(json)) return JSON.parse(readText(json));
  return {};
}

export function normalizeWorkflowLocale(value = '') {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'zh' || raw === 'zh-cn' || raw === 'zh_cn') return 'zh';
  return '';
}

export function workflowLocale(opts = {}) {
  return normalizeWorkflowLocale(opts.locale || process.env.HIKSPINE_WORKFLOW_LOCALE || readConfig(opts.root || '')?.workflowLocale);
}

export function workflowSource(opts = {}) {
  const raw = String(opts.source || opts['workflow-source'] || '').trim().toLowerCase();
  if (raw === 'project') return 'local';
  return ['local', 'user', 'builtin'].includes(raw) ? raw : '';
}

function workflowDisplayPath(root, file, source) {
  return rel(root, file);
}

export function projectWorkflowsDir(root) {
  return path.join(root, '.hikspine', 'workflows');
}

export function userWorkflowsDir() {
  return path.join(hikspineHome(), 'workflows');
}

function addWorkflowCandidates(out, root, id, opts, source, baseDir) {
  const locale = workflowLocale({ ...opts, root });
  if (locale) out.push({ file: path.join(baseDir, locale, `${id}.yaml`), locale, source });
  out.push({ file: path.join(baseDir, `${id}.yaml`), locale: '', source });
}

function workflowFileCandidates(root, id, opts = {}) {
  const source = workflowSource(opts);
  const all = [];
  if (!source || source === 'local') addWorkflowCandidates(all, root, id, opts, 'local', projectWorkflowsDir(root));
  if (!source || source === 'user') addWorkflowCandidates(all, root, id, opts, 'user', userWorkflowsDir());
  if (!source || source === 'builtin') addWorkflowCandidates(all, root, id, opts, 'builtin', BUILTIN_WORKFLOWS_DIR);
  const seen = new Set();
  return all.filter((candidate) => {
    if (!fs.existsSync(candidate.file)) return false;
    const key = path.resolve(candidate.file).toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function workflowFile(root, id, opts = {}) {
  const candidates = workflowFileCandidates(root, id, opts);
  if (opts.hash) {
    const byHash = candidates.find((candidate) => sha256(readText(candidate.file)) === opts.hash);
    if (byHash) return byHash;
    if (workflowSource(opts)) {
      const fallback = workflowFileCandidates(root, id, { ...opts, source: '', 'workflow-source': '' })
        .find((candidate) => sha256(readText(candidate.file)) === opts.hash);
      if (fallback) return fallback;
    }
  }
  if (!candidates.length) die(`Workflow '${id}' not found. Expected user ~/.hikspine/workflows/${id}.yaml, local .hikspine/workflows/${id}.yaml, or builtin workflows/${id}.yaml.`);
  const sources = [...new Set(candidates.map((candidate) => candidate.source))];
  const requestedSource = workflowSource(opts);
  if (!requestedSource && sources.length > 1) {
    die(`Workflow '${id}' exists in multiple scopes (${sources.join(', ')}). Ask the user which one to use, then pass --workflow-source <${sources.join('|')}>.`);
  }
  return candidates[0];
}

export function loadWorkflow(root, id, opts = {}) {
  const found = workflowFile(root, id, opts);
  const file = found.file;
  const text = readText(file);
  const workflow = readYamlFile(file);
  workflow.id ||= workflow.name;
  workflow.version = workflow.version ?? 1;
  workflow.__file = file;
  workflow.__hash = sha256(text);
  workflow.__locale = found.locale || '';
  workflow.__source = found.source || '';
  validateWorkflow(workflow);
  return workflow;
}

// A workflow is a state machine: states + transitions. Each state declares
// `needs` (skill-agnostic decisions), `capabilities` (skills the agent may
// compose), `next`, and optional `fail_when`/`fail_to` rollback edges.

// Collect every structural problem with a workflow without throwing. Shared
// by validateWorkflow (engine, fail-fast) and lintWorkflow (UI, report-all).
export function workflowIssues(workflow) {
  const issues = [];
  if (!workflow || !workflow.id) issues.push('Workflow is missing id.');
  const states = Array.isArray(workflow?.states) ? workflow.states : [];
  if (states.length === 0) {
    issues.push(`Workflow '${workflow?.id || '?'}' has no states.`);
    return issues;
  }
  const ids = new Set();
  for (const s of states) {
    if (!s.id) { issues.push(`Workflow '${workflow.id}' has a state without id.`); continue; }
    if (ids.has(s.id)) issues.push(`Workflow '${workflow.id}' has duplicate state '${s.id}'.`);
    ids.add(s.id);
  }
  const start = workflow.start || states[0].id;
  if (!ids.has(start)) issues.push(`Workflow '${workflow.id}' start '${start}' is not a state.`);
  for (const s of states) {
    if (!s.id) continue;
    if (s.next && !ids.has(s.next)) issues.push(`State '${s.id}' next '${s.next}' is not a state.`);
    if (s.fail_to && !ids.has(s.fail_to)) issues.push(`State '${s.id}' fail_to '${s.fail_to}' is not a state.`);
    if (s.fail_when && !s.fail_to) issues.push(`State '${s.id}' has fail_when but no fail_to.`);
    if (!s.terminal && !s.next) issues.push(`State '${s.id}' is not terminal but has no next.`);
  }
  return issues;
}

// Non-throwing validation for tools (e.g. the workflow editor): report every
// issue at once instead of dying on the first.
export function lintWorkflow(workflow) {
  return { ok: workflowIssues(workflow).length === 0, issues: workflowIssues(workflow) };
}

export function validateWorkflow(workflow) {
  const issues = workflowIssues(workflow);
  if (issues.length) die(issues[0]);
  // Defaults the engine relies on.
  workflow.start = workflow.start || workflow.states[0].id;
  for (const s of workflow.states) if (s.needs == null) s.needs = [];
}

// List every available workflow. Builtins are read-only templates; user and
// local scopes are editable custom workflows. Duplicated ids are intentionally
// returned as separate entries so the agent/UI can surface scope conflicts
// instead of silently choosing one.
export function listWorkflows(root, opts = {}) {
  const locale = workflowLocale({ ...opts, root });
  const map = new Map();
  const add = (file, source, sourceLocale = '') => {
    try {
      const w = readYamlFile(file);
      const id = w.id || path.basename(file).replace(/\.ya?ml$/, '');
      const key = `${source}:${id}`;
      map.set(key, {
        id,
        name: w.name || id,
        intent: w.intent || '',
        source,
        scope: source,
        locale: sourceLocale,
        file: workflowDisplayPath(root, file, source),
        editable: source !== 'builtin',
        readonly: source === 'builtin',
      });
    } catch {
      // Skip unparseable files rather than failing the whole listing.
    }
  };
  if (fs.existsSync(BUILTIN_WORKFLOWS_DIR)) {
    for (const name of fs.readdirSync(BUILTIN_WORKFLOWS_DIR).sort()) {
      if (/\.ya?ml$/.test(name)) add(path.join(BUILTIN_WORKFLOWS_DIR, name), 'builtin');
    }
    if (locale) {
      const dir = path.join(BUILTIN_WORKFLOWS_DIR, locale);
      if (fs.existsSync(dir)) {
        for (const name of fs.readdirSync(dir).sort()) {
          if (/\.ya?ml$/.test(name)) add(path.join(dir, name), 'builtin', locale);
        }
      }
    }
  }
  const userDir = userWorkflowsDir();
  if (fs.existsSync(userDir)) {
    for (const name of fs.readdirSync(userDir).sort()) {
      if (/\.ya?ml$/.test(name)) add(path.join(userDir, name), 'user');
    }
    if (locale) {
      const dir = path.join(userDir, locale);
      if (fs.existsSync(dir)) {
        for (const name of fs.readdirSync(dir).sort()) {
          if (/\.ya?ml$/.test(name)) add(path.join(dir, name), 'user', locale);
        }
      }
    }
  }
  const projDir = projectWorkflowsDir(root);
  if (fs.existsSync(projDir)) {
    for (const name of fs.readdirSync(projDir).sort()) {
      if (/\.ya?ml$/.test(name)) add(path.join(projDir, name), 'local');
    }
    if (locale) {
      const dir = path.join(projDir, locale);
      if (fs.existsSync(dir)) {
        for (const name of fs.readdirSync(dir).sort()) {
          if (/\.ya?ml$/.test(name)) add(path.join(dir, name), 'local', locale);
        }
      }
    }
  }
  const byId = new Map();
  for (const workflow of map.values()) {
    const sources = byId.get(workflow.id) || new Set();
    sources.add(workflow.source);
    byId.set(workflow.id, sources);
  }
  const order = { builtin: 0, user: 1, local: 2 };
  return [...map.values()].map((workflow) => {
    const sources = [...(byId.get(workflow.id) || [])];
    return { ...workflow, conflictSources: sources.length > 1 ? sources : [] };
  }).sort((a, b) => a.id.localeCompare(b.id) || (order[a.source] ?? 9) - (order[b.source] ?? 9));
}

export function saveWorkflow(root, workflow, opts = {}) {
  const id = String(workflow?.id || '').trim();
  if (!/^[A-Za-z0-9_-]+$/.test(id)) die('Workflow id must use letters, numbers, dash, or underscore.');
  const source = workflowSource({ source: opts.scope || opts.source || 'local' }) || 'local';
  if (source === 'builtin') die('Built-in workflows are read-only templates. Copy one into user or local scope before editing.');
  const locale = workflowLocale({ ...opts, root });
  const copy = clone(workflow);
  copy.id = id;
  copy.version = Number(copy.version || 1);
  validateWorkflow(copy);
  const baseDir = source === 'user' ? userWorkflowsDir() : projectWorkflowsDir(root);
  const file = locale
    ? path.join(baseDir, locale, `${id}.yaml`)
    : path.join(baseDir, `${id}.yaml`);
  writeYamlFile(file, copy);
  return {
    id,
    locale,
    source,
    scope: source,
    file: rel(root, file),
    workflow: loadWorkflow(root, id, { locale, source }),
  };
}

export function saveProjectWorkflow(root, workflow, opts = {}) {
  return saveWorkflow(root, workflow, { ...opts, source: 'local' });
}

export function stateById(workflow, id) {
  return (workflow.states || []).find((s) => s.id === id) || null;
}

export function firstStateId(workflow) {
  return workflow.start || workflow.states[0].id;
}

export function openSpecStateFile(root, change) {
  return path.join(root, 'openspec', 'changes', change, '.hikspine.yaml');
}

export function standaloneStateFile(root, change) {
  return path.join(root, '.hikspine', 'changes', `${change}.yaml`);
}

function archivedOpenSpecStates(root) {
  const out = [];
  const archiveBase = path.join(root, 'openspec', 'changes', 'archive');
  if (!fs.existsSync(archiveBase)) return out;
  for (const dirent of fs.readdirSync(archiveBase, { withFileTypes: true })) {
    if (!dirent.isDirectory()) continue;
    const dir = path.join(archiveBase, dirent.name);
    const file = path.join(dir, '.hikspine.yaml');
    if (!fs.existsSync(file)) continue;
    let change = dirent.name.replace(/^\d{4}-\d{2}-\d{2}-/, '');
    try {
      const state = readYamlFile(file);
      if (state.change) change = state.change;
    } catch {
      // Keep the date-stripped directory name as a best-effort label.
    }
    out.push({ change, file, archived: true, archivedName: dirent.name, archivePath: rel(root, dir) });
  }
  return out;
}

function stateCandidates(root, change) {
  const openSpec = openSpecStateFile(root, change);
  const standalone = standaloneStateFile(root, change);
  const archived = archivedOpenSpecStates(root).find((entry) => entry.change === change) || null;
  return {
    openSpec,
    standalone,
    archived: archived?.file || '',
    archivedEntry: archived,
    hasOpenSpec: fs.existsSync(openSpec),
    hasStandalone: fs.existsSync(standalone),
    hasArchived: !!archived,
  };
}

export function stateFileFor(root, change, workflowId = '') {
  const c = stateCandidates(root, change);
  const locations = [c.hasOpenSpec, c.hasStandalone, c.hasArchived].filter(Boolean).length;
  if (locations > 1) {
    die(`Change '${change}' exists in multiple Hikspine storage locations. Rename or archive one before continuing.`);
  }
  if (c.hasOpenSpec) return c.openSpec;
  if (c.hasStandalone) return c.standalone;
  if (c.hasArchived) return c.archived;
  // Every workflow is OpenSpec-backed by default — one storage location for all
  // changes, so the folder layout and the board's spec data source are uniform.
  // Legacy standalone changes are still read above for backward compatibility.
  return c.openSpec;
}

export function activeFile(root) {
  return path.join(root, '.hikspine', 'active');
}

export function getActive(root) {
  const file = activeFile(root);
  return fs.existsSync(file) ? readText(file).trim() : '';
}

export function setActive(root, change) {
  ensureDir(path.join(root, '.hikspine'));
  writeText(activeFile(root), `${change}\n`);
}

export function listStates(root) {
  const out = [];
  const openBase = path.join(root, 'openspec', 'changes');
  if (fs.existsSync(openBase)) {
    for (const dirent of fs.readdirSync(openBase, { withFileTypes: true })) {
      if (!dirent.isDirectory() || dirent.name === 'archive') continue;
      const file = openSpecStateFile(root, dirent.name);
      if (fs.existsSync(file)) out.push({ change: dirent.name, file });
    }
    out.push(...archivedOpenSpecStates(root));
  }
  const simpleBase = path.join(root, '.hikspine', 'changes');
  if (fs.existsSync(simpleBase)) {
    for (const dirent of fs.readdirSync(simpleBase, { withFileTypes: true })) {
      if (!dirent.isFile() || !dirent.name.endsWith('.yaml')) continue;
      const change = dirent.name.replace(/\.yaml$/, '');
      out.push({ change, file: path.join(simpleBase, dirent.name) });
    }
  }
  return out.sort((a, b) => a.change.localeCompare(b.change));
}

export function resolveChange(root, change) {
  if (change) {
    validateChangeName(change);
    return change;
  }
  const active = getActive(root);
  if (active) {
    validateChangeName(active);
    return active;
  }
  const states = listStates(root);
  if (states.length === 1) return states[0].change;
  if (states.length === 0) die('No Hikspine change exists yet. Call next <change> --workflow <workflow>.');
  die(`Multiple Hikspine changes exist: ${states.map((s) => s.change).join(', ')}. Pass a change name.`);
}

export function initializeState(root, change, workflow, storage) {
  const start = firstStateId(workflow);
  const state = {
    version: 1,
    change,
    workflow: workflow.id,
    workflowVersion: String(workflow.version ?? ''),
    workflowHash: workflow.__hash,
    workflowLocale: workflow.__locale || '',
    workflowSource: workflow.__source || '',
    storage,
    current: start,
    decisions: {},
    history: [{ at: nowIso(), type: 'started', workflow: workflow.id, state: start }],
  };
  state.__file = storage === 'standalone' ? standaloneStateFile(root, change) : openSpecStateFile(root, change);
  return state;
}

export function createState(root, change, workflowId, storageArg, opts = {}) {
  validateChangeName(change);
  const workflow = loadWorkflow(root, workflowId, opts);
  const c = stateCandidates(root, change);
  if (c.hasOpenSpec || c.hasStandalone || c.hasArchived) {
    die(`Change '${change}' already exists. Use a different change name or resume it without changing workflow.`);
  }
  // OpenSpec is the universal default. A workflow no longer chooses storage by
  // id; standalone is only reachable via an explicit --storage override.
  const storage = storageArg || 'openspec';
  if (storage === 'openspec') ensureDir(path.join(root, 'openspec', 'changes', change, 'specs'));
  else ensureDir(path.join(root, '.hikspine', 'changes'));
  const state = initializeState(root, change, workflow, storage);
  saveState(state);
  setActive(root, change);
  return { state, workflow, created: true };
}

export function loadState(root, change) {
  const name = resolveChange(root, change);
  const file = stateFileFor(root, name);
  if (!fs.existsSync(file)) die(`Change state not found for '${name}'.`);
  const archivedEntry = stateCandidates(root, name).archivedEntry;
  return loadStateEntry(root, { change: name, file, ...(file === archivedEntry?.file ? archivedEntry : {}) });
}

export function loadStateEntry(root, entry) {
  const file = entry.file;
  const state = readYamlFile(file);
  state.version ||= 1;
  state.change ||= entry.change;
  // Legacy state files created before localized workflows did not record a
  // locale. The Chinese entry existed first for most users, so treat missing
  // workflowLocale as zh while preserving explicit default/English states.
  if (state.workflowLocale == null) state.workflowLocale = 'zh';
  // tolerate legacy `current: { phase, node }` shape
  if (typeof state.current !== 'string') state.current = state.current?.phase || '';
  state.decisions ||= {};
  state.history ||= [];
  state.__file = file;
  state.__dir = path.dirname(file);
  if (entry.archived) {
    state.__archived = true;
    state.__archivePath = entry.archivePath || rel(root, path.dirname(file));
    state.__archivedName = entry.archivedName || path.basename(path.dirname(file));
  }
  return state;
}

export function saveState(state) {
  const copy = clone(state);
  delete copy.__file;
  writeYamlFile(state.__file, copy);
}

export function loadOrCreatePair(root, changeArg, opts = {}) {
  const change = changeArg || getActive(root);
  if (change) validateChangeName(change);
  if (change) {
    const existingFile = stateFileFor(root, change, opts.workflow || '');
    if (fs.existsSync(existingFile)) {
      const state = loadState(root, change);
      if (opts.workflow && state.workflow !== opts.workflow) {
        die(`Change '${change}' already uses workflow '${state.workflow}', not '${opts.workflow}'. Use a different change name or resume without --workflow.`);
      }
      const workflow = loadWorkflow(root, state.workflow, { locale: state.workflowLocale || opts.locale, source: state.workflowSource, hash: state.workflowHash });
      setActive(root, state.change);
      return { state, workflow, created: false };
    }
  }
  if (!change) die('No active change. Call next <change> --workflow <workflow>.');
  const workflowId = opts.workflow || readConfig(root).defaultWorkflow || 'feature';
  return createState(root, change, workflowId, opts.storage, opts);
}

export function publicState(root, state) {
  return {
    change: state.change,
    workflow: state.workflow,
    workflowLocale: state.workflowLocale || '',
    workflowSource: state.workflowSource || '',
    current: state.current,
    decisions: state.decisions || {},
    stateFile: rel(root, state.__file),
  };
}
