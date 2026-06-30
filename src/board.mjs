// Board state: a read-only aggregate of everything the orchestration UI shows
// — in-flight changes (concurrent runs), available workflows, and discoverable
// skills. Reused by the `board`/`changes` CLI commands and the web server, so
// the UI and the agent see exactly the same truth.

import fs from 'node:fs';
import path from 'node:path';
import { getActive, listStates, listWorkflows, loadState, loadWorkflow } from './store.mjs';
import { summarize } from './transitions.mjs';
import { discoverSkills } from './skills.mjs';
import { rel, toPosix } from './utils.mjs';

function minutesBetween(start, end) {
  const a = new Date(start).getTime();
  const b = new Date(end).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) return 0;
  return Math.max(1, Math.round((b - a) / 60000));
}

function stageDurations(workflow, state) {
  const ids = (workflow.states || []).map((s) => s.id);
  const totals = Object.fromEntries(ids.map((id) => [id, 0]));
  const history = Array.isArray(state.history) ? state.history : [];
  if (!history.length) return totals;

  let current = history[0].state || state.current || workflow.start || ids[0];
  let startedAt = history[0].at;
  let finished = false;
  for (const event of history.slice(1)) {
    if ((event.type === 'transition' || event.type === 'rollback') && event.at) {
      if (current && totals[current] != null) totals[current] += minutesBetween(startedAt, event.at);
      current = event.to || current;
      startedAt = event.at;
      finished = false;
    } else if (event.type === 'complete' && event.at) {
      if (current && totals[current] != null) totals[current] += minutesBetween(startedAt, event.at);
      startedAt = event.at;
      finished = true;
    }
  }
  if (!finished && current && totals[current] != null && !state.decisions?.archived) {
    totals[current] += minutesBetween(startedAt, new Date().toISOString());
  }
  return totals;
}

function artifactStage(relPath) {
  const p = toPosix(relPath).toLowerCase();
  const name = path.posix.basename(p);
  if (name === 'proposal.md' || name === 'tasks.md' || p.includes('/specs/')) return 'openspec';
  if (name === 'design.md') return 'design';
  if (p.includes('/plans/') || name.includes('plan')) return 'build';
  if (name.includes('review')) return 'review';
  if (name.includes('verify') || name.includes('verification')) return 'verify';
  if (name.includes('brainstorm')) return 'brainstorm';
  return 'openspec';
}

function artifactLabel(relPath) {
  const p = toPosix(relPath);
  const name = path.posix.basename(p);
  if (name === 'proposal.md') return 'Proposal';
  if (name === 'design.md') return 'Design';
  if (name === 'tasks.md') return 'Tasks';
  if (p.includes('/specs/')) return `Spec: ${name}`;
  return name;
}

function listMarkdownFiles(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) listMarkdownFiles(full, out);
    else if (entry.isFile() && /\.md$/i.test(entry.name)) out.push(full);
  }
  return out;
}

function changeArtifacts(root, change) {
  const base = path.join(root, 'openspec', 'changes', change);
  return listMarkdownFiles(base)
    .map((file) => {
      const stat = fs.statSync(file);
      const relative = rel(root, file);
      return {
        path: relative,
        title: artifactLabel(path.relative(base, file)),
        stage: artifactStage(path.relative(base, file)),
        size: stat.size,
        updatedAt: stat.mtime.toISOString(),
      };
    })
    .sort((a, b) => a.stage.localeCompare(b.stage) || a.path.localeCompare(b.path));
}

function workflowDetails(root, summary) {
  try {
    const workflow = loadWorkflow(root, summary.id);
    return {
      ...summary,
      stages: workflow.states.map((state) => ({
        id: state.id,
        goal: state.goal || '',
        capabilities: state.capabilities || [],
        needs: state.needs || [],
        requiresUser: !!state.requires_user,
        terminal: !!state.terminal,
        next: state.next || '',
      })),
    };
  } catch (err) {
    return { ...summary, error: err.message, stages: [] };
  }
}

// One change's status. Read-only: never auto-advances or mutates the change.
export function changeSummary(root, change, active) {
  try {
    const state = loadState(root, change);
    const workflow = loadWorkflow(root, state.workflow);
    const sum = summarize(workflow, state);
    const stages = workflow.states.map((s) => s.id);
    const history = Array.isArray(state.history) ? state.history : [];
    return {
      change,
      workflow: state.workflow,
      active: change === active,
      current: sum.current,
      goal: sum.goal,
      nextAction: sum.nextAction,
      requiresUser: sum.requiresUser,
      needs: sum.needs,
      missing: sum.missing,
      complete: sum.complete,
      stages,
      stageIndex: stages.indexOf(sum.current),
      stageDurations: stageDurations(workflow, state),
      artifacts: changeArtifacts(root, change),
      decisions: state.decisions || {},
      history,
      startedAt: history.length ? history[0].at : null,
      updatedAt: history.length ? history[history.length - 1].at : null,
    };
  } catch (err) {
    return { change, active: change === active, error: err.message };
  }
}

export function listChangeSummaries(root, active = getActive(root)) {
  return listStates(root).map(({ change }) => changeSummary(root, change, active));
}

export function boardState(root) {
  const active = getActive(root);
  const workflows = listWorkflows(root);
  return {
    root,
    active,
    changes: listChangeSummaries(root, active),
    workflows: workflows.map((workflow) => workflowDetails(root, workflow)),
    skills: discoverSkills(root),
  };
}
