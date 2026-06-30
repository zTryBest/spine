#!/usr/bin/env node
// Claude Code Notification hook: when Claude needs the user's attention
// (permission prompt, idle waiting for input, MCP elicitation), record it into
// the project's .hikspine/notifications.json so the board can surface it live.

import fs from 'node:fs';
import process from 'node:process';
import { appendNotification } from '../src/notifications.mjs';
import { findProjectRoot } from '../src/utils.mjs';

// Notification types that mean "Claude is waiting on the user".
const NEEDS_USER = new Set(['permission_prompt', 'idle_prompt', 'elicitation_dialog']);

function readStdin() {
  try { return fs.readFileSync(0, 'utf8'); } catch { return ''; }
}
function parse(text) {
  if (!text.trim()) return {};
  try { return JSON.parse(text); } catch { return {}; }
}

const payload = parse(readStdin());
const type = payload.notification_type || payload.type || '';
if (!NEEDS_USER.has(type)) process.exit(0);

// Anchor to the same project root the engine writes state into (the nearest
// ancestor with .hikspine/openspec), not the git toplevel of the current
// subdirectory — otherwise notifications scatter into a code-path .hikspine.
const cwd = payload.cwd || process.env.HIKSPINE_PROJECT_ROOT || process.cwd();
const root = findProjectRoot(cwd);

try {
  appendNotification(root, {
    type,
    message: payload.message || '',
    session: payload.session_id || '',
  });
} catch {
  // Best-effort; never block the session.
}
process.exit(0);
