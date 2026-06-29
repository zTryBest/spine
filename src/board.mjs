// Board state: a read-only aggregate of everything the orchestration UI shows
// — in-flight changes (concurrent runs), available workflows, and discoverable
// skills. Reused by the `board`/`changes` CLI commands and the web server, so
// the UI and the agent see exactly the same truth.

import { getActive, listStates, listWorkflows, loadState, loadWorkflow } from './store.mjs';
import { summarize } from './transitions.mjs';
import { discoverSkills } from './skills.mjs';

// One change's status. Read-only: never auto-advances or mutates the change.
export function changeSummary(root, change, active) {
  try {
    const state = loadState(root, change);
    const workflow = loadWorkflow(root, state.workflow);
    const sum = summarize(workflow, state);
    return {
      change,
      workflow: state.workflow,
      active: change === active,
      current: sum.current,
      goal: sum.goal,
      nextAction: sum.nextAction,
      requiresUser: sum.requiresUser,
      missing: sum.missing,
      complete: sum.complete,
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
  return {
    root,
    active,
    changes: listChangeSummaries(root, active),
    workflows: listWorkflows(root),
    skills: discoverSkills(root),
  };
}
