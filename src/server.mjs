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
  const pidFile = path.join(root, '.hikspine', 'hikspine-ui.pid');
  const removePid = () => { try { fs.rmSync(pidFile, { force: true }); } catch {} };
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      try {
        fs.mkdirSync(path.dirname(pidFile), { recursive: true });
        fs.writeFileSync(pidFile, String(process.pid));
      } catch {}
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
