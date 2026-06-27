import {
  currentPhase,
  ensureNodeState,
  firstRequiredNode,
  nextRequiredNode,
  nodeById,
  phaseById,
  phaseIndex,
  saveState,
  startNode,
} from './store.mjs';
import { evaluateCheck, evaluateChecks } from './checks.mjs';
import { loadRegistry, skillInfo } from './registry.mjs';
import { die, nowIso } from './utils.mjs';

function nodeExitChecks(node) {
  return node.exit?.checks || [];
}

function stepExitChecks(step) {
  return step.exit?.checks || [];
}

function phaseIsComplete(phase, state) {
  return (phase.nodes || [])
    .filter((node) => node.required !== false)
    .every((node) => state.nodes?.[node.id]?.status === 'done' || state.nodes?.[node.id]?.status === 'skipped');
}

function evaluateNode(root, state, node) {
  const nodeChecks = evaluateChecks(root, state, nodeExitChecks(node));
  const stepResults = [];
  let currentStep = null;

  if (node.type === 'skill-sequence') {
    for (let i = 0; i < (node.steps || []).length; i += 1) {
      const step = node.steps[i];
      const checks = evaluateChecks(root, state, stepExitChecks(step));
      stepResults.push({ index: i, skill: step.skill, ok: checks.ok, results: checks.results, missing: checks.missing });
      if (!checks.ok && currentStep == null) currentStep = i;
    }
    if (currentStep == null && !nodeChecks.ok && node.steps?.length) currentStep = 0;
  }

  const stepMissing = stepResults.flatMap((step) => step.missing.map((item) => ({ ...item, step: step.index, skill: step.skill })));
  const missing = [...stepMissing, ...nodeChecks.missing];
  const hasChecks = nodeExitChecks(node).length > 0 || stepResults.some((step) => step.results.length > 0);
  if (!hasChecks) {
    missing.push({
      ok: false,
      kind: 'workflow',
      key: 'no_exit_checks',
      message: `Node '${node.id}' has no machine-checkable exit checks.`,
    });
  }

  return {
    ok: missing.length === 0,
    hasChecks,
    currentStep,
    stepResults,
    checks: nodeChecks.results,
    missing,
  };
}

function markNodeDone(state, node, evaluation) {
  const ns = ensureNodeState(state, node.id);
  if (ns.status === 'done') return;
  ns.status = 'done';
  ns.result = 'pass';
  ns.completedAt = nowIso();
  if (node.type === 'skill-sequence') ns.step = node.steps?.length || 0;
  state.history ||= [];
  state.history.push({
    at: nowIso(),
    type: 'node.completed',
    node: node.id,
    result: 'pass',
    checks: evaluation.checks?.map((item) => item.key) || [],
  });
}

function targetFirstNode(workflow, state, phaseId) {
  const phase = phaseById(workflow, phaseId);
  if (!phase) die(`Phase '${phaseId}' not found.`);
  const node = firstRequiredNode(phase);
  state.current.phase = phase.id;
  state.current.node = node?.id || null;
  state.current.step = node?.type === 'skill-sequence' ? 0 : null;
  if (node) {
    const ns = ensureNodeState(state, node.id);
    if (ns.status === 'done' || ns.status === 'failed') {
      ns.status = 'doing';
      ns.step = 0;
      ns.reopenedAt = nowIso();
    } else startNode(state, node);
  }
}

function fallbackMatches(root, state, fallback) {
  if (!fallback.when) return false;
  const checks = Array.isArray(fallback.when) ? fallback.when : [fallback.when];
  return checks.every((check) => evaluateCheck(root, state, check).ok);
}

function advanceAfterDone(root, workflow, state, phase, node) {
  const nextNode = nextRequiredNode(phase, node.id);
  if (nextNode) {
    startNode(state, nextNode);
    state.history.push({ at: nowIso(), type: 'node.started', phase: phase.id, node: nextNode.id });
    return { stop: false };
  }

  if (phaseIsComplete(phase, state)) {
    for (const fb of workflow.fallbacks || []) {
      if (fb.from === phase.id && fallbackMatches(root, state, fb)) {
        const from = phase.id;
        targetFirstNode(workflow, state, fb.to);
        state.history.push({ at: nowIso(), type: 'rollback', from, to: fb.to });
        return { stop: true, reason: 'rollback', from, to: fb.to };
      }
    }
  }

  const idx = phaseIndex(workflow, phase.id);
  const nextPhase = workflow.phases[idx + 1];
  if (!nextPhase) {
    state.current.node = null;
    state.current.step = null;
    state.history.push({ at: nowIso(), type: 'workflow.completed', phase: phase.id });
    return { stop: true, reason: 'complete' };
  }

  const from = phase.id;
  targetFirstNode(workflow, state, nextPhase.id);
  state.history.push({ at: nowIso(), type: 'phase.changed', from, to: nextPhase.id, node: state.current.node });
  return { stop: false };
}

function autoAdvance(root, workflow, state) {
  const transitions = [];
  for (let i = 0; i < 50; i += 1) {
    const phase = currentPhase(workflow, state);
    const pair = state.current.node ? nodeById(workflow, state.current.node) : null;
    const node = pair?.node || firstRequiredNode(phase);
    if (!node) break;
    startNode(state, node);
    const evaluation = evaluateNode(root, state, node);
    if (!evaluation.ok) {
      const ns = ensureNodeState(state, node.id);
      if (node.type === 'skill-sequence') {
        ns.step = evaluation.currentStep ?? Number(ns.step || 0);
        state.current.step = ns.step;
      }
      return { transitions, phase, node, evaluation };
    }
    markNodeDone(state, node, evaluation);
    transitions.push({ type: 'node.completed', node: node.id });
    const advanced = advanceAfterDone(root, workflow, state, phase, node);
    if (advanced?.reason === 'rollback') {
      transitions.push({ type: 'rollback', from: advanced.from, to: advanced.to });
      const rollbackPhase = currentPhase(workflow, state);
      const rollbackNode = nodeById(workflow, state.current.node)?.node || firstRequiredNode(rollbackPhase);
      const rollbackEvaluation = {
        ok: false,
        checks: [],
        stepResults: [],
        missing: [{
          ok: false,
          kind: 'workflow',
          key: 'rolled_back',
          message: `Workflow rolled back from ${advanced.from} to ${advanced.to}; rerun this phase and update its artifacts.`,
        }],
      };
      return { transitions, phase: rollbackPhase, node: rollbackNode, evaluation: rollbackEvaluation };
    }
    if (!state.current.node) break;
  }
  return { transitions, complete: true };
}

function skillSet(node, key) {
  const raw = node.skills?.[key] || [];
  return Array.isArray(raw) ? raw : [raw].filter(Boolean);
}

function nextSkillFor(node, evaluation) {
  if (node.type === 'skill-sequence') {
    const index = evaluation.currentStep ?? 0;
    const step = node.steps?.[index] || null;
    return step ? { id: step.skill, task: step.task || '' } : null;
  }
  if (node.type === 'skill' && node.skill) return { id: node.skill, task: node.task || '' };
  return null;
}

function renderValue(value, state) {
  return typeof value === 'string' ? value.replaceAll('{change}', state.change) : value;
}

function renderItem(item, state) {
  if (Array.isArray(item)) return item.map((value) => renderItem(value, state));
  if (item && typeof item === 'object') {
    return Object.fromEntries(Object.entries(item).map(([key, value]) => [key, renderItem(value, state)]));
  }
  return renderValue(item, state);
}

function inputsFor(node, state) {
  const required = node.inputs?.required || [];
  return Array.isArray(required) ? required.map((input) => renderItem(input, state)) : [];
}

function outputsFor(node, state) {
  return (node.outputs || []).map((output) => renderItem(output, state));
}

function formatSkillList(registry, ids) {
  return ids.map((id) => skillInfo(registry, id));
}

export function computeNext(root, workflow, state) {
  const advance = autoAdvance(root, workflow, state);
  saveState(state);

  if (advance.complete || !state.current.node) {
    return {
      change: state.change,
      workflow: state.workflow,
      complete: true,
      transitions: advance.transitions,
      message: 'Workflow complete.',
    };
  }

  const registry = loadRegistry(root);
  const phase = currentPhase(workflow, state);
  const pair = nodeById(workflow, state.current.node);
  const node = pair?.node || firstRequiredNode(phase);
  const ns = ensureNodeState(state, node.id);
  const evaluation = advance.evaluation || evaluateNode(root, state, node);
  const requiredSkills = skillSet(node, 'required');
  const recommendedSkills = skillSet(node, 'recommended');
  const outputSkills = skillSet(node, 'output');
  const nextSkill = nextSkillFor(node, evaluation);

  return {
    change: state.change,
    workflow: state.workflow,
    phase: phase.id,
    phaseGoal: phase.goal || '',
    node: node.id,
    nodeType: node.type,
    required: node.required !== false,
    status: ns.status,
    guard: phase.guard || {},
    objective: node.objective || node.task || '',
    agent: node.agent || {},
    requiredSkills: formatSkillList(registry, requiredSkills),
    recommendedSkills: formatSkillList(registry, recommendedSkills),
    outputSkills: formatSkillList(registry, outputSkills),
    nextSkill: nextSkill ? { ...skillInfo(registry, nextSkill.id), task: nextSkill.task } : null,
    currentStep: node.type === 'skill-sequence' ? ns.step || 0 : null,
    totalSteps: node.type === 'skill-sequence' ? node.steps.length : null,
    requiredInputs: inputsFor(node, state),
    outputs: outputsFor(node, state),
    checks: evaluation.checks,
    stepChecks: evaluation.stepResults,
    missing: evaluation.missing,
    transitions: advance.transitions,
  };
}

export function formatNextAction(action) {
  if (action.complete) return `${action.message}\n`;
  const lines = [];
  lines.push(`HIKSPINE NEXT ${action.change}`);
  lines.push(`Workflow: ${action.workflow}`);
  lines.push(`Phase: ${action.phase}`);
  lines.push(`Node: ${action.node} (${action.nodeType})`);
  if (action.phaseGoal) lines.push(`Phase goal: ${action.phaseGoal}`);
  if (action.objective) lines.push(`Objective: ${action.objective}`);
  if (action.nextSkill) {
    lines.push('');
    lines.push('Next skill:');
    lines.push(`- ${action.nextSkill.id} -> ${action.nextSkill.ref || action.nextSkill.id}`);
    if (action.nextSkill.task) lines.push(`  task: ${action.nextSkill.task}`);
    if (action.nextSkill.description) lines.push(`  description: ${action.nextSkill.description}`);
  }
  if (action.agent?.requiresUser) {
    lines.push('');
    lines.push('User checkpoint:');
    lines.push('- Stop and ask the user before producing the confirmation artifact.');
  }
  if (action.requiredSkills?.length) {
    lines.push('');
    lines.push('Required skills:');
    for (const s of action.requiredSkills) lines.push(`- ${s.id} -> ${s.ref || s.id}: ${s.description || ''}`);
  }
  if (action.recommendedSkills?.length) {
    lines.push('');
    lines.push('Recommended skills:');
    for (const s of action.recommendedSkills) lines.push(`- ${s.id} -> ${s.ref || s.id}: ${s.description || ''}`);
  }
  if (action.agent?.rules?.length) {
    lines.push('');
    lines.push('Rules:');
    for (const rule of action.agent.rules) lines.push(`- ${rule}`);
  }
  if (action.requiredInputs?.length) {
    lines.push('');
    lines.push('Required inputs:');
    for (const input of action.requiredInputs) {
      const before = input.useBefore?.length ? ` before ${input.useBefore.join(', ')}` : '';
      lines.push(`- ${input.key || input.path}: ${input.path || ''}${before}`);
    }
  }
  if (action.outputs?.length) {
    lines.push('');
    lines.push('Expected outputs:');
    for (const output of action.outputs) lines.push(`- ${output.key || output.path}: ${output.path || ''}`);
  }
  if (action.projectRules?.readNow?.length) {
    lines.push('');
    lines.push('Project rules synced; read these now for the current session:');
    for (const rule of action.projectRules.readNow) lines.push(`- ${rule}`);
  }
  lines.push('');
  lines.push('Missing machine checks:');
  if (!action.missing.length) lines.push('- none');
  for (const item of action.missing) lines.push(`- ${item.key}: ${item.message || item.path || ''}`);
  lines.push('');
  lines.push('Run again after producing the expected artifacts:');
  lines.push('- node "$HIKSPINE_ENGINE" next <change> --json');
  return `${lines.join('\n')}\n`;
}
