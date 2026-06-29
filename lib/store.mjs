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

export function readConfig(root) {
  const yaml = path.join(root, '.hikspine', 'config.yaml');
  if (fs.existsSync(yaml)) return readYamlFile(yaml);
  const json = path.join(root, '.hikspine', 'config.json');
  if (fs.existsSync(json)) return JSON.parse(readText(json));
  return {};
}

export function workflowFile(root, id) {
  const project = path.join(root, '.hikspine', 'workflows', `${id}.yaml`);
  if (fs.existsSync(project)) return project;
  const builtin = path.join(BUILTIN_WORKFLOWS_DIR, `${id}.yaml`);
  if (fs.existsSync(builtin)) return builtin;
  die(`Workflow '${id}' not found. Expected .hikspine/workflows/${id}.yaml or builtin/workflows/${id}.yaml.`);
}

export function loadWorkflow(root, id) {
  const file = workflowFile(root, id);
  const text = readText(file);
  const workflow = readYamlFile(file);
  workflow.id ||= workflow.name;
  workflow.version = workflow.version ?? 1;
  workflow.__file = file;
  workflow.__hash = sha256(text);
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

// List every available workflow (builtin + project), project overriding
// builtin by id. Used for the orchestration board and for auto-selection;
// each workflow may declare an `intent` describing when it applies.
export function listWorkflows(root) {
  const map = new Map();
  const add = (file, source) => {
    try {
      const w = readYamlFile(file);
      const id = w.id || path.basename(file).replace(/\.ya?ml$/, '');
      map.set(id, { id, name: w.name || id, intent: w.intent || '', source, file: rel(root, file) });
    } catch {
      // Skip unparseable files rather than failing the whole listing.
    }
  };
  if (fs.existsSync(BUILTIN_WORKFLOWS_DIR)) {
    for (const name of fs.readdirSync(BUILTIN_WORKFLOWS_DIR).sort()) {
      if (/\.ya?ml$/.test(name)) add(path.join(BUILTIN_WORKFLOWS_DIR, name), 'builtin');
    }
  }
  const projDir = path.join(root, '.hikspine', 'workflows');
  if (fs.existsSync(projDir)) {
    for (const name of fs.readdirSync(projDir).sort()) {
      if (/\.ya?ml$/.test(name)) add(path.join(projDir, name), 'project');
    }
  }
  return [...map.values()].sort((a, b) => a.id.localeCompare(b.id));
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

export function stateFileFor(root, change, workflowId = '') {
  const openSpec = openSpecStateFile(root, change);
  const standalone = standaloneStateFile(root, change);
  if (fs.existsSync(openSpec)) return openSpec;
  if (fs.existsSync(standalone)) return standalone;
  return workflowId === 'simple-fix' || workflowId === 'hotfix' ? standalone : openSpec;
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
    storage,
    current: start,
    decisions: {},
    history: [{ at: nowIso(), type: 'started', workflow: workflow.id, state: start }],
  };
  state.__file = storage === 'standalone' ? standaloneStateFile(root, change) : openSpecStateFile(root, change);
  return state;
}

export function createState(root, change, workflowId, storageArg) {
  validateChangeName(change);
  const workflow = loadWorkflow(root, workflowId);
  const storage = storageArg || (workflow.id === 'simple-fix' || workflow.id === 'hotfix' ? 'standalone' : 'openspec');
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
  const state = readYamlFile(file);
  state.version ||= 1;
  state.change ||= name;
  // tolerate legacy `current: { phase, node }` shape
  if (typeof state.current !== 'string') state.current = state.current?.phase || '';
  state.decisions ||= {};
  state.history ||= [];
  state.__file = file;
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
      const workflow = loadWorkflow(root, state.workflow);
      setActive(root, state.change);
      return { state, workflow, created: false };
    }
  }
  if (!change) die('No active change. Call next <change> --workflow <workflow>.');
  const workflowId = opts.workflow || readConfig(root).defaultWorkflow || 'feature';
  return createState(root, change, workflowId, opts.storage);
}

export function publicState(root, state) {
  return {
    change: state.change,
    workflow: state.workflow,
    current: state.current,
    decisions: state.decisions || {},
    stateFile: rel(root, state.__file),
  };
}
