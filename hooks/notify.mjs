#!/usr/bin/env node
// Claude Code Notification hook: when Claude needs the user's attention
// (permission prompt, idle waiting for input, MCP elicitation), record it into
// the project's .hikspine/notifications.json so the board can surface it live.

import childProcess from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

// Notification types that mean "Claude is waiting on the user".
const NEEDS_USER = new Set(['permission_prompt', 'idle_prompt', 'elicitation_dialog']);
const MAX = 20;

function readStdin() {
  try { return fs.readFileSync(0, 'utf8'); } catch { return ''; }
}
function parse(text) {
  if (!text.trim()) return {};
  try { return JSON.parse(text); } catch { return {}; }
}
function gitToplevel(dir) {
  try {
    return childProcess.execFileSync('git', ['-C', dir, 'rev-parse', '--show-toplevel'], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 3000,
    }).trim();
  } catch { return ''; }
}

const payload = parse(readStdin());
const type = payload.notification_type || payload.type || '';
if (!NEEDS_USER.has(type)) process.exit(0);

const cwd = payload.cwd || process.env.HIKSPINE_PROJECT_ROOT || process.cwd();
const root = gitToplevel(cwd) || cwd;
const dir = path.join(root, '.hikspine');
const file = path.join(dir, 'notifications.json');

try {
  fs.mkdirSync(dir, { recursive: true });
  let list = [];
  try { list = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { list = []; }
  if (!Array.isArray(list)) list = [];
  list.push({
    at: new Date().toISOString(),
    type,
    message: payload.message || '',
    session: payload.session_id || '',
  });
  fs.writeFileSync(file, JSON.stringify(list.slice(-MAX)));
} catch {
  // Best-effort; never block the session.
}
process.exit(0);
