#!/usr/bin/env node
// Public CLI for the Hikspine workflow kernel.
//
// Agent-facing protocol is intentionally small: call `next`, produce the
// requested artifacts, then call `next` again. State transitions and guard
// decisions live in lib modules.

import process from 'node:process';
import { publicRuleSync, syncProjectRules } from '../lib/rules.mjs';
import { computeNext, formatNextAction } from '../lib/transitions.mjs';
import {
  cwd,
  die,
  parseOptions,
  UserError,
} from '../lib/utils.mjs';
import {
  loadOrCreatePair,
} from '../lib/store.mjs';

function printJson(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function cmdNext(args) {
  const opts = parseOptions(args);
  const root = cwd();
  const projectRules = publicRuleSync(syncProjectRules(root));
  const { state, workflow, created } = loadOrCreatePair(root, opts._[0], opts);
  const action = computeNext(root, workflow, state);
  action.projectRules = projectRules;
  if (created) action.created = true;
  if (opts.json) printJson(action);
  else process.stdout.write(formatNextAction(action));
}

function help() {
  process.stdout.write(`Usage: hikspine next [change] [--workflow <workflow-id>] [--storage openspec|standalone] [--json]

Agent protocol:
  next    Observe artifacts, advance completed nodes, and return the next action.

Examples:
  hikspine next entrance-monitor --workflow <workflow-id> --json
  hikspine next --json

Workflows resolve from .hikspine/workflows/<id>.yaml first, then builtin/workflows/<id>.yaml.
No project init is required. If --workflow is omitted for a new change, Hikspine uses .hikspine/config.yaml defaultWorkflow, then the builtin default.
`);
}

const commands = {
  next: cmdNext,
  help,
  '--help': help,
  '-h': help,
};

try {
  const [cmd = 'help', ...args] = process.argv.slice(2);
  const fn = commands[cmd];
  if (!fn) die(`Unknown command '${cmd}'. Use 'next'.`);
  fn(args);
} catch (err) {
  if (err instanceof UserError) {
    process.stderr.write(`ERROR: ${err.message}\n`);
    process.exit(err.code);
  }
  process.stderr.write(`${err.stack || err.message}\n`);
  process.exit(1);
}
