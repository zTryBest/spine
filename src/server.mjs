// Local web server for the status board. Dependency-free (node:http), reuses
// the engine modules so the browser and the agent read the same .hikspine
// files. The board is a read-only status view (plus switching the active
// task); it never creates or drives tasks — the Claude Code agent does that
// via next/decide.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { boardState } from './board.mjs';
import { markAllNotificationsHandled, markNotificationsHandled } from './notifications.mjs';
import { setActive } from './store.mjs';
import { PLUGIN_ROOT, rel, validateChangeName } from './utils.mjs';

const DASHBOARD_HTML = path.join(PLUGIN_ROOT, 'dashboard', 'index.html');
const DASHBOARD_LABELS = path.join(PLUGIN_ROOT, 'dashboard', 'ui-labels.json');
const UI_PID_NAME = 'hikspine-ui.pid';
const UI_PID_REGISTRY_NAME = 'hikspine-ui-pids.json';

function artifactType(filePath) {
  const p = String(filePath || '').replace(/\\/g, '/').toLowerCase();
  const name = path.posix.basename(p);
  if (name === 'proposal.md') return 'proposal';
  if (name === 'design.md') return 'design';
  if (name === 'tasks.md') return 'tasks';
  if (p.startsWith('specs/') || p.includes('/specs/')) return 'spec';
  if (name.includes('review')) return 'review';
  if (name.includes('verify') || name.includes('verification')) return 'verification';
  if (name.includes('brainstorm')) return 'brainstorm';
  if (p.includes('/plans/') || name.includes('plan')) return 'plan';
  return 'markdown';
}

function sendJson(res, code, value) {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(value));
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

function readJsonFile(file) {
  try {
    const value = JSON.parse(fs.readFileSync(file, 'utf8'));
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

function mergeUiLabels(base, override) {
  return {
    ...base,
    ...override,
    stages: {
      ...(base.stages && typeof base.stages === 'object' ? base.stages : {}),
      ...(override.stages && typeof override.stages === 'object' ? override.stages : {}),
    },
  };
}

function readUiLabels(root) {
  const defaults = readJsonFile(DASHBOARD_LABELS);
  const project = readJsonFile(path.join(root, '.hikspine', 'ui-labels.json'));
  return mergeUiLabels(defaults, project);
}

function uiStateDir(root) {
  return path.join(root, '.hikspine');
}

function uiPidFile(root) {
  return path.join(uiStateDir(root), UI_PID_NAME);
}

function uiPidRegistryFile(root) {
  return path.join(uiStateDir(root), UI_PID_REGISTRY_NAME);
}

function readUiPidRegistry(root) {
  try {
    const value = JSON.parse(fs.readFileSync(uiPidRegistryFile(root), 'utf8'));
    return Array.isArray(value) ? value.filter((item) => Number.isInteger(item?.pid) && item.pid > 0) : [];
  } catch {
    return [];
  }
}

function writeUiPidRegistry(root, records) {
  const file = uiPidRegistryFile(root);
  const list = (Array.isArray(records) ? records : [])
    .filter((item) => Number.isInteger(item?.pid) && item.pid > 0);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (list.length) fs.writeFileSync(file, JSON.stringify(list, null, 2));
  else fs.rmSync(file, { force: true });
}

function registerUiPid(root, { host, port }) {
  fs.mkdirSync(uiStateDir(root), { recursive: true });
  fs.writeFileSync(uiPidFile(root), String(process.pid));
  const current = {
    pid: process.pid,
    host,
    port,
    root,
    startedAt: new Date().toISOString(),
  };
  const records = readUiPidRegistry(root).filter((item) => item.pid !== process.pid);
  records.push(current);
  writeUiPidRegistry(root, records);
}

function unregisterUiPid(root) {
  try {
    const records = readUiPidRegistry(root).filter((item) => item.pid !== process.pid);
    writeUiPidRegistry(root, records);
  } catch {}
  try {
    const file = uiPidFile(root);
    const raw = fs.readFileSync(file, 'utf8').trim();
    if (Number(raw) === process.pid) fs.rmSync(file, { force: true });
  } catch {}
}

export function createBoardServer(root) {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    try {
      if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end(fs.readFileSync(DASHBOARD_HTML));
        return;
      }
      if (req.method === 'GET' && url.pathname === '/api/state') {
        sendJson(res, 200, boardState(root));
        return;
      }
      if (req.method === 'GET' && url.pathname === '/api/ui-labels') {
        sendJson(res, 200, readUiLabels(root));
        return;
      }
      if (req.method === 'GET' && url.pathname === '/api/artifact') {
        const requested = url.searchParams.get('path') || '';
        const abs = path.resolve(root, requested);
        const rootAbs = path.resolve(root);
        if (abs !== rootAbs && !abs.startsWith(rootAbs + path.sep)) {
          sendJson(res, 400, { error: 'Artifact path must stay inside the project root.' });
          return;
        }
        if (!/\.md$/i.test(abs)) {
          sendJson(res, 400, { error: 'Only Markdown artifacts can be previewed.' });
          return;
        }
        if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
          sendJson(res, 404, { error: 'Artifact not found.' });
          return;
        }
        const stat = fs.statSync(abs);
        if (stat.size > 1024 * 1024) {
          sendJson(res, 413, { error: 'Artifact is too large to preview.' });
          return;
        }
        sendJson(res, 200, {
          path: rel(rootAbs, abs),
          type: artifactType(requested || abs),
          content: fs.readFileSync(abs, 'utf8'),
          size: stat.size,
          updatedAt: stat.mtime.toISOString(),
        });
        return;
      }
      // Switch the active task (focus), without touching its state.
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
      if (req.method === 'POST' && url.pathname === '/api/notifications/handled') {
        const body = await readBody(req);
        const result = body.all
          ? markAllNotificationsHandled(root)
          : markNotificationsHandled(root, body.ids || body.id);
        sendJson(res, 200, result);
        return;
      }
      // Manual failsafe for when the SessionEnd cleanup hook does not fire (or
      // fails) and the UI process is left running: let the board stop itself.
      if (req.method === 'POST' && url.pathname === '/api/shutdown') {
        sendJson(res, 200, { stopping: true, pid: process.pid });
        res.on('finish', () => {
          try { unregisterUiPid(root); } catch {}
          setTimeout(() => process.exit(0), 50);
        });
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
  // The engine writes its OWN pid (process.pid = the real OS pid) so the
  // SessionEnd cleanup hook can terminate it. Do NOT rely on a shell's `$!`:
  // in Git Bash on Windows that is the MSYS pid, not the node.exe Windows pid,
  // so `process.kill` never matches it and the UI is never stopped.
  // A registry is kept as well as the legacy single-pid file so SessionEnd can
  // clean up multiple UI instances and old instances cannot delete a newer pid.
  const removePid = () => unregisterUiPid(root);
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      try { registerUiPid(root, { host, port }); } catch {}
      process.on('exit', removePid);
      for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
        process.on(sig, () => { removePid(); process.exit(0); });
      }
      const addr = server.address();
      const url = `http://${host}:${addr.port}`;
      process.stdout.write(`Hikspine board: ${url}\n(serving ${root} — Ctrl+C to stop)\n`);
      resolve({ server, url });
    });
  });
}
