// Composable state machine: states + decision-driven transitions.
//
// Transitions look only at whether a state's `needs` (skill-agnostic decisions)
// are recorded — never at what files a particular skill produced. So skills can
// be swapped, added, or reordered (via a state's `capabilities`, which are
// real skill names) without touching the workflow graph. The states are the
// stable backbone; the skills a state may use are free to change.

import { firstStateId, saveState, stateById } from './store.mjs';
import { skillIndex, resolveCapability, capabilityTag } from './skills.mjs';
import { nowIso } from './utils.mjs';

const list = (v) => (Array.isArray(v) ? v : v == null ? [] : [v]);
const needKey = (need) => {
  const i = need.indexOf('=');
  return i < 0 ? need : need.slice(0, i);
};

// A need is a decision, in one of two forms:
//   "key"        → the decision is recorded
//   "key=value"  → the decision equals value
function needMet(decisions, need) {
  const i = need.indexOf('=');
  if (i < 0) {
    const v = decisions[need];
    return v !== undefined && v !== null;
  }
  return String(decisions[need.slice(0, i)] ?? '') === need.slice(i + 1);
}

const missingNeeds = (state, s) => list(s.needs).filter((n) => !needMet(state.decisions, n));

// States from fail_to to from (inclusive). On rollback their decisions are
// cleared, forcing the work between them to be redone (re-implement/review/verify).
function statesToReset(workflow, failToId, fromId) {
  const ids = workflow.states.map((s) => s.id);
  const a = ids.indexOf(failToId);
  const b = ids.indexOf(fromId);
  if (a < 0 || b < 0) return [];
  return workflow.states.slice(a, b + 1);
}

/** Record an agent decision. Who produced it (which skill) is irrelevant. */
export function recordDecision(state, key, value) {
  state.decisions ||= {};
  state.decisions[key] = value;
  (state.history ||= []).push({ at: nowIso(), type: 'decide', key, value });
  return state;
}

// Walk forward through every state whose decisions are complete, applying a
// rollback when a fail_when decision is present. Stops at the first state with
// unmet needs (the one the agent must act on) or a satisfied terminal state.
function autoAdvance(workflow, state) {
  const transitions = [];
  const cap = (workflow.states.length + 1) * 4;
  for (let i = 0; i < cap; i += 1) {
    const s = stateById(workflow, state.current);
    if (!s) {
      state.current = firstStateId(workflow);
      continue;
    }

    // 1) Failure rollback (cross-phase): e.g. review/verify result = fail.
    if (s.fail_when && needMet(state.decisions, s.fail_when) && s.fail_to) {
      const from = s.id;
      for (const ds of statesToReset(workflow, s.fail_to, from)) {
        for (const n of list(ds.needs)) delete state.decisions[needKey(n)];
      }
      state.rollback = { to: s.fail_to, from, reason: s.fail_reason || `${from} failed` };
      state.current = s.fail_to;
      transitions.push({ type: 'rollback', from, to: s.fail_to });
      (state.history ||= []).push({ at: nowIso(), type: 'rollback', from, to: s.fail_to });
      continue;
    }

    // 2) Stop where the agent still owes a decision.
    if (missingNeeds(state, s).length) return transitions;

    // 3) Satisfied terminal = workflow complete.
    if (s.terminal) {
      transitions.push({ type: 'complete', state: s.id });
      return transitions;
    }

    // 4) Decisions complete → move forward.
    const from = s.id;
    if (state.rollback) delete state.rollback;
    state.current = s.next;
    transitions.push({ type: 'transition', from, to: s.next });
    (state.history ||= []).push({ at: nowIso(), type: 'transition', from, to: s.next });
  }
  return transitions;
}

// Read-only summary of a resting state — no auto-advance, no save, no skill
// discovery. Shared by computeNext and by listing many changes for a board.
export function summarize(workflow, state) {
  const s = stateById(workflow, state.current);
  const missing = missingNeeds(state, s);

  // Deterministic, skill-agnostic directive so the agent never has to infer
  // whether to keep going. It points at the loop action, never a skill:
  //   done    — workflow finished
  //   confirm — this state has a user checkpoint; stop before the confirming decision
  //   work    — compose capabilities, record decisions, keep moving
  let nextAction;
  if (s.terminal && missing.length === 0) nextAction = 'done';
  else if (s.requires_user && missing.length) nextAction = 'confirm';
  else nextAction = 'work';

  return {
    current: s.id,
    goal: s.goal || '',
    forbid: list(s.forbid),
    requiresUser: !!s.requires_user,
    // Opaque, workflow-authored directives for this state (skill-agnostic
    // passthrough). The engine carries them to the agent; it does not parse
    // or enforce them. Use them to declare per-state requirements such as a
    // mandatory skill, without coupling the engine to any upstream skill.
    rules: list(s.rules),
    needs: list(s.needs),
    missing,
    terminal: !!s.terminal,
    complete: !!s.terminal && missing.length === 0,
    nextAction,
  };
}

export function computeNext(root, workflow, state) {
  const transitions = autoAdvance(workflow, state);
  saveState(state);

  const index = skillIndex(root);
  const s = stateById(workflow, state.current);

  return {
    change: state.change,
    workflow: state.workflow,
    ...summarize(workflow, state),
    capabilities: list(s.capabilities).map((raw) => resolveCapability(index, raw)),
    // Decisions recorded so far (key -> value). A capability's `when` condition
    // may reference an earlier decision (e.g. load test-driven-development only
    // when a tdd_mode=true decision was recorded in an earlier state), so the
    // agent needs to see them without re-reading the state file.
    decisions: { ...(state.decisions || {}) },
    rollback: state.rollback || null,
    transitions,
    // Skill-agnostic reminder: composed skills decide HOW to do the work;
    // the workflow decides WHEN to transition. A composed skill ending or
    // offering to proceed is never a phase boundary.
    transitionPolicy:
      "Transitions follow this workflow, not the composed skills. A composed skill ending or offering to proceed is not a stop — record this state's needs with decide, then call next. Stop for the user only when requiresUser is true.",
    // Skill-agnostic reminder that capabilities are not optional. The engine
    // names no specific skill; the workflow's capability list drives which to
    // load. This kills the "compose freely = may skip" reading.
    capabilityPolicy:
      "Capabilities are this state's skills, not optional suggestions. Load a skill with the Skill tool and follow its instructions rather than hand-rolling its work inline. Each capability carries a requirement tag telling you when to load it: `required` = must load; `one-of:<group>` = load exactly one skill from that group; `when <condition>` = load only if the condition holds; untagged = load whenever its purpose matches the work.",
  };
}

export function formatNextAction(action) {
  const lines = [];
  lines.push(`HIKSPINE ${action.change} — state: ${action.current}`);
  lines.push(`Workflow: ${action.workflow}`);
  if (action.goal) lines.push(`Goal: ${action.goal}`);

  if (action.rollback) {
    lines.push('');
    lines.push(`↩ Rolled back from ${action.rollback.from}: ${action.rollback.reason}`);
    lines.push('  Re-do this state onward; downstream decisions were cleared.');
  }

  if (action.complete) {
    lines.push('');
    lines.push('✓ Workflow complete.');
    return `${lines.join('\n')}\n`;
  }

  if (action.forbid?.length) {
    lines.push('');
    lines.push(`Forbidden here: ${action.forbid.join(', ')}`);
  }
  if (action.nextAction === 'confirm') {
    lines.push('');
    lines.push('Next [confirm]: do the work, then stop and ask the user before recording the confirming decision.');
  } else if (action.nextAction === 'work') {
    lines.push('');
    lines.push('Next [work]: compose the skills below, record the decisions with decide, then call next — do not stop to ask whether to proceed.');
  }
  if (action.rules?.length) {
    lines.push('');
    lines.push('Rules for this state (workflow-authored — follow them):');
    for (const r of action.rules) lines.push(`- ${r}`);
  }
  if (action.capabilities?.length) {
    lines.push('');
    lines.push('Skills for this state — load them with the Skill tool per each one\'s requirement tag (see policy below):');
    for (const c of action.capabilities) {
      const tag = capabilityTag(c);
      lines.push(`- ${c.id} -> ${c.ref || c.id}${tag ? ` [${tag}]` : ''}: ${c.description || ''}`);
    }
    if (action.capabilityPolicy) lines.push(action.capabilityPolicy);
  }

  lines.push('');
  lines.push('Decisions needed to leave this state:');
  if (!action.needs.length) lines.push('- none');
  for (const n of action.needs) lines.push(`- ${n} ${action.missing.includes(n) ? '[missing]' : '[recorded]'}`);

  if (action.transitionPolicy) {
    lines.push('');
    lines.push(action.transitionPolicy);
  }

  if (action.projectRules?.readNow?.length) {
    lines.push('');
    lines.push('Project rules synced; read these now:');
    for (const r of action.projectRules.readNow) lines.push(`- ${r}`);
  }

  lines.push('');
  lines.push('Record a decision, then ask for the next action:');
  lines.push('- node "$HIKSPINE_ENGINE" decide <key> <value> --json');
  lines.push('- node "$HIKSPINE_ENGINE" next --json');
  return `${lines.join('\n')}\n`;
}
