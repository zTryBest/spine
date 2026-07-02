#!/usr/bin/env node
// Claude Code PreToolUse bridge for Hikspine guard.

import fs from 'node:fs';
import process from 'node:process';
import { checkGuard } from '../src/checks.mjs';
import { loadState, loadWorkflow } from '../src/store.mjs';

function readStdin() {
  try {
    return fs.readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

function extractPath(payload) {
  if (process.env.FILE_PATH) return process.env.FILE_PATH;
  if (!payload.trim()) return '';
  try {
    const data = JSON.parse(payload);
    const input = data.tool_input || data.input || {};
    return input.file_path || input.path || input.notebook_path || '';
  } catch {
    const m = payload.match(/"file_path"\s*:\s*"([^"]+)"/);
    return m ? m[1] : '';
  }
}

const target = extractPath(readStdin());
if (!target) process.exit(0);

let result;
try {
  const root = process.cwd();
  const state = loadState(root);
  const workflow = loadWorkflow(root, state.workflow, { locale: state.workflowLocale });
  result = checkGuard(root, state, workflow, target);
} catch {
  result = { allow: true, reason: 'no_active_change', target };
}

process.stdout.write(result.allow ? 'ALLOW\n' : `BLOCK write-source in ${result.state}: ${result.target}\n`);
process.exit(result.allow ? 0 : 2);
