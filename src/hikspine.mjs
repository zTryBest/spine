#!/usr/bin/env node
// Public CLI for the Hikspine workflow kernel.
//
// Agent-facing protocol is small: call `next` to see the current state (its
// missing decisions and the skills you may compose), do the work, then
// `decide <key> <value>` to record an outcome. The engine advances the state
// machine and rolls back on failure. State and guard logic live in lib modules.

import process from 'node:process';
import { publicRuleSync, syncProjectRules } from './rules.mjs';
import { computeNext, formatNextAction, recordDecision } from './transitions.mjs';
import {
  die,
  parseJsonish,
  parseOptions,
  resolveProjectRoot,
  UserError,
} from './utils.mjs';
import {
  getActive,
  listWorkflows,
  loadOrCreatePair,
  loadState,
  loadWorkflow,
} from './store.mjs';
import { discoverSkills } from './skills.mjs';
import { allProjectsBoardState, boardState, listChangeSummaries } from './board.mjs';
import { startBoard } from './server.mjs';
import { registerProject } from './project-registry.mjs';

function printJson(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function emit(action, opts) {
  if (opts.json) printJson(action);
  else process.stdout.write(formatNextAction(action));
}

function resolveRegisteredProjectRoot(opts) {
  const root = resolveProjectRoot(opts);
  try { registerProject(root); } catch {}
  return root;
}

function cmdNext(args) {
  const opts = parseOptions(args);
  const root = resolveRegisteredProjectRoot(opts);
  const projectRules = publicRuleSync(syncProjectRules(root));
  const { state, workflow, created } = loadOrCreatePair(root, opts._[0], opts);
  const action = computeNext(root, workflow, state);
  action.projectRules = projectRules;
  if (created) action.created = true;
  emit(action, opts);
}

function cmdDecide(args) {
  const opts = parseOptions(args);
  const key = opts._[0];
  if (!key) die('Usage: hikspine decide <key> [value] [--change <change>] [--json]');
  const value = opts._.length > 1 ? parseJsonish(opts._[1]) : true;
  const root = resolveRegisteredProjectRoot(opts);
  const projectRules = publicRuleSync(syncProjectRules(root));
  const state = loadState(root, opts.change);
  const workflow = loadWorkflow(root, state.workflow, { locale: state.workflowLocale || opts.locale, source: state.workflowSource, hash: state.workflowHash });
  recordDecision(state, key, value);
  const action = computeNext(root, workflow, state);
  action.projectRules = projectRules;
  action.decided = { key, value };
  emit(action, opts);
}

// Registry of all in-flight changes (each its own workflow + state), so a
// board can show and switch between concurrent runs. Read-only: it never
// auto-advances or mutates any change.
function cmdChanges(args) {
  const opts = parseOptions(args);
  const root = resolveRegisteredProjectRoot(opts);
  const active = getActive(root);
  const changes = listChangeSummaries(root, active, opts);
  if (opts.json) { printJson({ active, changes }); return; }
  if (!changes.length) { process.stdout.write('No Hikspine changes yet. Start one with: next <change> --workflow <id>\n'); return; }
  const lines = ['HIKSPINE changes:'];
  for (const c of changes) {
    if (c.error) { lines.push(`- ${c.change}  [error: ${c.error}]`); continue; }
    const mark = c.active ? '*' : ' ';
    const tail = c.complete ? 'done' : `${c.nextAction} (${c.current})`;
    lines.push(`${mark} ${c.change}  [${c.workflow}]  ${tail}`);
  }
  process.stdout.write(`${lines.join('\n')}\n`);
}

// List available workflows with their selection intent, so the agent can route
// a request and detect duplicate ids across scopes.
function cmdWorkflows(args) {
  const opts = parseOptions(args);
  const root = resolveRegisteredProjectRoot(opts);
  const workflows = listWorkflows(root, opts);
  if (opts.json) { printJson({ workflows }); return; }
  const lines = ['HIKSPINE workflows:'];
  for (const w of workflows) {
    const conflict = w.conflictSources?.length ? ` conflict:${w.conflictSources.join('|')}` : '';
    lines.push(`- ${w.id} [${w.source}${conflict}]: ${w.intent || w.name}`);
  }
  process.stdout.write(`${lines.join('\n')}\n`);
}

// Every skill Claude Code can see, from the same filesystem sources it reads.
// This is the data source for picking capabilities (in a workflow editor) and
// the set of valid capability names.
function cmdSkills(args) {
  const opts = parseOptions(args);
  const root = resolveRegisteredProjectRoot(opts);
  const skills = discoverSkills(root);
  if (opts.json) { printJson({ skills }); return; }
  const lines = ['HIKSPINE skills:'];
  for (const s of skills) lines.push(`- ${s.name} [${s.source}]: ${s.description || ''}`);
  process.stdout.write(`${lines.join('\n')}\n`);
}

// Aggregate everything the orchestration board shows: changes, workflows,
// skills. Same data the web UI serves at /api/state.
function cmdBoard(args) {
  const opts = parseOptions(args);
  if (opts.all) {
    try { resolveRegisteredProjectRoot(opts); } catch {}
    const state = allProjectsBoardState(opts);
    if (opts.json) { printJson(state); return; }
    const lines = [`HIKSPINE all-project board`, `projects: ${(state.projects || []).length}`, `changes: ${(state.changes || []).length}`];
    process.stdout.write(`${lines.join('\n')}\n`);
    return;
  }
  const root = resolveRegisteredProjectRoot(opts);
  const state = boardState(root, opts);
  if (opts.json) { printJson(state); return; }
  const lines = [`HIKSPINE board — ${state.root}`, `active: ${state.active || '—'}`, '', `changes (${state.changes.length}):`];
  for (const c of state.changes) {
    if (c.error) { lines.push(`  ${c.change}  [error: ${c.error}]`); continue; }
    const mark = c.active ? '*' : ' ';
    const tail = c.complete ? 'done' : `${c.nextAction} (${c.current})`;
    lines.push(`${mark} ${c.change}  [${c.workflow}]  ${tail}`);
  }
  lines.push('', `workflows (${state.workflows.length}): ${state.workflows.map((w) => w.id).join(', ')}`);
  lines.push(`skills: ${state.skills.length} discoverable`);
  process.stdout.write(`${lines.join('\n')}\n`);
}

// Launch the local web board. Long-running; the user runs this in a terminal.
function cmdUi(args) {
  const opts = parseOptions(args);
  const root = resolveRegisteredProjectRoot(opts);
  const port = opts.port ? Number(opts.port) : 4319;
  startBoard(root, { port, all: !!opts.all, locale: opts.locale || '' }).catch((err) => die(`Cannot start board: ${err.message}`));
}

function help() {
  process.stdout.write(`Usage:
  hikspine next [change] [--workflow <id>] [--workflow-source user|local|builtin] [--storage openspec|standalone] [--locale zh] [--json]
  hikspine decide <key> [value] [--change <change>] [--locale zh] [--json]
  hikspine changes [--json]
  hikspine workflows [--json]
  hikspine skills [--json]
  hikspine board [--all] [--json]
  hikspine ui [--all] [--port <n>]

Global options:
  --project-root <dir>  Read/write Hikspine state for this project instead of the current directory.
  HIKSPINE_PROJECT_ROOT may also be set in the environment.
  --locale zh           Use localized workflow YAML when available. Existing changes keep their recorded workflowLocale.
  --workflow-source     Choose a workflow scope when the same workflow id exists in multiple scopes.
  HIKSPINE_WORKFLOW_LOCALE may also be set in the environment.

Agent protocol:
  next       Show the current state: its missing decisions and the skills you may compose.
  decide     Record a decision (an outcome). The engine advances or rolls back, then
             returns the next state to act on. Value defaults to true; pass pass/fail/etc.
  changes    List every in-flight change (concurrent runs) with its workflow and next step.
  workflows  List available workflows with their selection intent (for routing a request).
  skills     List every Claude Code skill discoverable here (valid capability names).
  board      Aggregate changes + workflows + skills (the web board's data).
  ui         Start the local web board (default http://127.0.0.1:4319). Pass --all for all registered projects.

Examples:
  hikspine next entrance-monitor --workflow feature --json
  hikspine decide proposal_ready --json
  hikspine decide review_result pass --json
  hikspine decide verify_result fail --json    # triggers cross-state rollback
  hikspine changes --json
  hikspine workflows --json
  hikspine ui --project-root /path/to/project
  hikspine ui --all

Workflows resolve from local .hikspine/workflows, user ~/.hikspine/workflows, and read-only builtin templates.
If the same workflow id exists in multiple scopes, ask the user which one to use and pass --workflow-source.
If --workflow is omitted for a new change, Hikspine uses .hikspine/config.yaml defaultWorkflow,
then the builtin default.
`);
}

const commands = {
  next: cmdNext,
  decide: cmdDecide,
  changes: cmdChanges,
  workflows: cmdWorkflows,
  skills: cmdSkills,
  board: cmdBoard,
  ui: cmdUi,
  serve: cmdUi,
  help,
  '--help': help,
  '-h': help,
};

try {
  const [cmd = 'help', ...args] = process.argv.slice(2);
  const fn = commands[cmd];
  if (!fn) die(`Unknown command '${cmd}'. Use next, decide, changes, or workflows.`);
  fn(args);
} catch (err) {
  if (err instanceof UserError) {
    process.stderr.write(`ERROR: ${err.message}\n`);
    process.exit(err.code);
  }
  process.stderr.write(`${err.stack || err.message}\n`);
  process.exit(1);
}
