// Local web server for the orchestration board. Dependency-free (node:http),
// reuses lib/ so the browser and the agent operate on the same .hikspine files
// — the UI is a view + launcher, never a parallel source of truth.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { boardState, changeSummary } from './board.mjs';
import { createState, getActive, lintWorkflow, setActive } from './store.mjs';
import { BUILTIN_WORKFLOWS_DIR, validateChangeName } from './utils.mjs';
import { readYamlFile, writeYamlFile } from './yaml.mjs';
import { BOARD_HTML } from './board-html.mjs';
import { EDITOR_HTML } from './editor-html.mjs';

const ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

// Load a workflow definition for editing (project overrides builtin). Returns
// the raw parsed YAML, or null for a new workflow.
function loadWorkflowDef(root, id) {
  const project = path.join(root, '.hikspine', 'workflows', `${id}.yaml`);
  const builtin = path.join(BUILTIN_WORKFLOWS_DIR, `${id}.yaml`);
  const file = fs.existsSync(project) ? project : fs.existsSync(builtin) ? builtin : null;
  return file ? readYamlFile(file) : null;
}

// Drop empty fields so saved YAML stays clean and matches the engine schema.
function cleanState(s) {
  const o = { id: s.id };
  if (s.goal) o.goal = s.goal;
  if (Array.isArray(s.forbid) && s.forbid.length) o.forbid = s.forbid;
  if (s.requires_user) o.requires_user = true;
  if (Array.isArray(s.capabilities) && s.capabilities.length) o.capabilities = s.capabilities;
  if (Array.isArray(s.rules) && s.rules.length) o.rules = s.rules;
  if (Array.isArray(s.needs) && s.needs.length) o.needs = s.needs;
  if (s.fail_when) o.fail_when = s.fail_when;
  if (s.fail_to) o.fail_to = s.fail_to;
  if (s.fail_reason) o.fail_reason = s.fail_reason;
  if (s.terminal) o.terminal = true;
  else if (s.next) o.next = s.next;
  return o;
}

function cleanWorkflow(w) {
  const o = { id: w.id, version: w.version || 1 };
  if (w.name) o.name = w.name;
  if (w.intent) o.intent = w.intent;
  if (w.start) o.start = w.start;
  o.states = Array.isArray(w.states) ? w.states.map(cleanState) : [];
  return o;
}

function sendJson(res, code, value) {
  const body = JSON.stringify(value);
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve) => {
    let s = '';
    req.on('data', (d) => { s += d; });
    req.on('end', () => {
      try { resolve(s ? JSON.parse(s) : {}); } catch { resolve({}); }
    });
  });
}

export function createBoardServer(root) {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    try {
      if (req.method === 'GET' && url.pathname === '/') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end(BOARD_HTML);
        return;
      }
      if (req.method === 'GET' && url.pathname === '/editor') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end(EDITOR_HTML);
        return;
      }
      if (req.method === 'GET' && url.pathname === '/api/state') {
        sendJson(res, 200, boardState(root));
        return;
      }
      // Load a workflow definition into the editor (null = new).
      if (req.method === 'GET' && url.pathname === '/api/workflow') {
        const id = url.searchParams.get('id') || '';
        sendJson(res, 200, { workflow: id ? loadWorkflowDef(root, id) : null });
        return;
      }
      // Lint a workflow without saving (live validation in the editor).
      if (req.method === 'POST' && url.pathname === '/api/workflow/validate') {
        const { workflow } = await readBody(req);
        sendJson(res, 200, lintWorkflow(cleanWorkflow(workflow || {})));
        return;
      }
      // Validate and write a project workflow to .hikspine/workflows/<id>.yaml.
      if (req.method === 'POST' && url.pathname === '/api/workflow/save') {
        const { workflow } = await readBody(req);
        const clean = cleanWorkflow(workflow || {});
        if (!ID_RE.test(clean.id || '')) {
          sendJson(res, 400, { ok: false, issues: ['Workflow id must be letters, numbers, dash, or underscore.'] });
          return;
        }
        const lint = lintWorkflow(clean);
        if (!lint.ok) { sendJson(res, 200, { ok: false, issues: lint.issues }); return; }
        const file = path.join(root, '.hikspine', 'workflows', `${clean.id}.yaml`);
        writeYamlFile(file, clean);
        sendJson(res, 200, { ok: true, id: clean.id, file: path.relative(root, file) });
        return;
      }
      // Launch a new run: create a change on the chosen workflow.
      if (req.method === 'POST' && url.pathname === '/api/launch') {
        const { change, workflow } = await readBody(req);
        try {
          validateChangeName(change);
          createState(root, change, workflow);
          sendJson(res, 200, changeSummary(root, change, getActive(root)));
        } catch (err) {
          sendJson(res, 400, { error: err.message });
        }
        return;
      }
      // Switch the active run (focus), without touching its state.
      if (req.method === 'POST' && url.pathname === '/api/active') {
        const { change } = await readBody(req);
        try {
          validateChangeName(change);
          setActive(root, change);
          sendJson(res, 200, { active: change });
        } catch (err) {
          sendJson(res, 400, { error: err.message });
        }
        return;
      }
      sendJson(res, 404, { error: 'Not found' });
    } catch (err) {
      sendJson(res, 500, { error: err.message });
    }
  });
}

export function startBoard(root, { port = 4319, host = '127.0.0.1' } = {}) {
  const server = createBoardServer(root);
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      const addr = server.address();
      const url = `http://${host}:${addr.port}`;
      process.stdout.write(`Hikspine board: ${url}\n(serving ${root} — Ctrl+C to stop)\n`);
      resolve({ server, url });
    });
  });
}
