#!/usr/bin/env node
// Public CLI for the Hikspine workflow kernel.
//
// Agent-facing protocol is small: call `next` to see the current state (its
// missing decisions and the skills you may compose), do the work, then
// `decide <key> <value>` to record an outcome. The engine advances the state
// machine and rolls back on failure. State and guard logic live in lib modules.

import process from 'node:process';
import { publicRuleSync, syncProjectRules } from '../lib/rules.mjs';
import { computeNext, formatNextAction, recordDecision } from '../lib/transitions.mjs';
import {
  cwd,
  die,
  parseJsonish,
  parseOptions,
  UserError,
} from '../lib/utils.mjs';
import {
  loadOrCreatePair,
  loadState,
  loadWorkflow,
} from '../lib/store.mjs';

function printJson(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function emit(action, opts) {
  if (opts.json) printJson(action);
  else process.stdout.write(formatNextAction(action));
}

function cmdNext(args) {
  const opts = parseOptions(args);
  const root = cwd();
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
  const root = cwd();
  const projectRules = publicRuleSync(syncProjectRules(root));
  const state = loadState(root, opts.change);
  const workflow = loadWorkflow(root, state.workflow);
  recordDecision(state, key, value);
  const action = computeNext(root, workflow, state);
  action.projectRules = projectRules;
  action.decided = { key, value };
  emit(action, opts);
}

function help() {
  process.stdout.write(`Usage:
  hikspine next [change] [--workflow <id>] [--storage openspec|standalone] [--json]
  hikspine decide <key> [value] [--change <change>] [--json]

Agent protocol:
  next      Show the current state: its missing decisions and the skills you may compose.
  decide    Record a decision (an outcome). The engine advances or rolls back, then
            returns the next state to act on. Value defaults to true; pass pass/fail/etc.

Examples:
  hikspine next entrance-monitor --workflow feature --json
  hikspine decide proposal_ready --json
  hikspine decide review_result pass --json
  hikspine decide verify_result fail --json    # triggers cross-state rollback

Workflows resolve from .hikspine/workflows/<id>.yaml first, then builtin/workflows/<id>.yaml.
If --workflow is omitted for a new change, Hikspine uses .hikspine/config.yaml defaultWorkflow,
then the builtin default.
`);
}

const commands = {
  next: cmdNext,
  decide: cmdDecide,
  help,
  '--help': help,
  '-h': help,
};

try {
  const [cmd = 'help', ...args] = process.argv.slice(2);
  const fn = commands[cmd];
  if (!fn) die(`Unknown command '${cmd}'. Use 'next' or 'decide'.`);
  fn(args);
} catch (err) {
  if (err instanceof UserError) {
    process.stderr.write(`ERROR: ${err.message}\n`);
    process.exit(err.code);
  }
  process.stderr.write(`${err.stack || err.message}\n`);
  process.exit(1);
}
