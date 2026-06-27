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
  toPosix,
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

export function validateWorkflow(workflow) {
  if (!workflow.id) die('Workflow is missing id.');
  if (!Array.isArray(workflow.phases) || workflow.phases.length === 0) die(`Workflow '${workflow.id}' has no phases.`);
  const phases = new Set();
  const nodes = new Set();
  for (const phase of workflow.phases) {
    if (!phase.id) die(`Workflow '${workflow.id}' has a phase without id.`);
    if (phases.has(phase.id)) die(`Workflow '${workflow.id}' has duplicate phase '${phase.id}'.`);
    phases.add(phase.id);
    if (!Array.isArray(phase.nodes)) phase.nodes = [];
    for (const node of phase.nodes) {
      if (!node.id) die(`Phase '${phase.id}' has a node without id.`);
      if (nodes.has(node.id)) die(`Workflow '${workflow.id}' has duplicate node '${node.id}'.`);
      nodes.add(node.id);
      node.type ||= 'skill';
      if (node.required === undefined) node.required = true;
      if (node.type === 'skill-sequence' && !Array.isArray(node.steps)) {
        die(`Node '${node.id}' is skill-sequence but has no steps.`);
      }
    }
  }
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

export function defaultArtifactPath(change, key, storage) {
  if (storage === 'standalone') {
    const base = path.join('.hikspine', 'changes', change);
    const map = {
      inspect_notes: `${base}.inspect.md`,
      patch_notes: `${base}.patch.md`,
      verify_report: `${base}.verify.md`,
      report: `${base}.report.md`,
    };
    return toPosix(map[key] || '');
  }
  const base = path.join('openspec', 'changes', change);
  const map = {
    proposal: path.join(base, 'proposal.md'),
    tasks: path.join(base, 'tasks.md'),
    specs: path.join(base, 'specs'),
    design_doc: path.join(base, 'design.md'),
    review_report: path.join(base, 'review.md'),
    verification_report: path.join(base, 'verification.md'),
  };
  return toPosix(map[key] || '');
}

function renderOutputPath(change, value) {
  return toPosix(String(value || '').replaceAll('{change}', change));
}

function collectArtifactPaths(workflow, change, storage) {
  const artifacts = {};
  for (const phase of workflow.phases || []) {
    for (const node of phase.nodes || []) {
      for (const output of node.outputs || []) {
        if (output.key && output.path) artifacts[output.key] = renderOutputPath(change, output.path);
      }
      for (const check of node.exit?.checks || []) {
        if (typeof check === 'object' && check['artifact.exists']) {
          const key = check['artifact.exists'];
          if (!artifacts[key]) artifacts[key] = defaultArtifactPath(change, key, storage);
        }
      }
      for (const step of node.steps || []) {
        for (const output of step.outputs || []) {
          if (output.key && output.path) artifacts[output.key] = renderOutputPath(change, output.path);
        }
      }
    }
  }
  return Object.fromEntries(Object.entries(artifacts).filter(([, value]) => value));
}

export function firstPhase(workflow) {
  return workflow.phases[0];
}

export function phaseIndex(workflow, phaseId) {
  return workflow.phases.findIndex((phase) => phase.id === phaseId);
}

export function phaseById(workflow, phaseId) {
  return workflow.phases.find((phase) => phase.id === phaseId);
}

export function currentPhase(workflow, state) {
  const phase = phaseById(workflow, state.current?.phase);
  if (!phase) die(`Current phase '${state.current?.phase}' not found in workflow '${workflow.id}'.`);
  return phase;
}

export function nodeById(workflow, nodeId) {
  for (const phase of workflow.phases) {
    for (const node of phase.nodes || []) if (node.id === nodeId) return { phase, node };
  }
  return null;
}

export function firstRequiredNode(phase) {
  return (phase.nodes || []).find((node) => node.required !== false) || (phase.nodes || [])[0] || null;
}

export function nextRequiredNode(phase, currentNodeId) {
  const nodes = (phase.nodes || []).filter((node) => node.required !== false);
  const idx = nodes.findIndex((node) => node.id === currentNodeId);
  return idx >= 0 ? nodes[idx + 1] || null : nodes[0] || null;
}

export function ensureNodeState(state, nodeId) {
  state.nodes ||= {};
  state.nodes[nodeId] ||= { status: 'todo' };
  return state.nodes[nodeId];
}

export function startNode(state, node) {
  const ns = ensureNodeState(state, node.id);
  if (ns.status === 'todo') {
    ns.status = 'doing';
    ns.startedAt = nowIso();
  }
  state.current.node = node.id;
  state.current.step = node.type === 'skill-sequence' ? Number(ns.step || 0) : null;
}

export function initializeState(root, change, workflow, storage) {
  const phase = firstPhase(workflow);
  const node = firstRequiredNode(phase);
  const artifacts = collectArtifactPaths(workflow, change, storage);
  const state = {
    version: 1,
    change,
    workflow: workflow.id,
    workflowVersion: String(workflow.version ?? ''),
    workflowHash: workflow.__hash,
    storage,
    current: {
      phase: phase.id,
      node: node?.id || null,
      step: node?.type === 'skill-sequence' ? 0 : null,
    },
    nodes: {},
    artifacts,
    history: [{ at: nowIso(), type: 'started', workflow: workflow.id, phase: phase.id, node: node?.id || null }],
  };
  if (node) state.nodes[node.id] = { status: 'doing', startedAt: nowIso(), step: 0 };
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
  state.current ||= {};
  state.nodes ||= {};
  state.artifacts ||= {};
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
    stateFile: rel(root, state.__file),
  };
}
