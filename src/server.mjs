// Local web server for the status board. Dependency-free (node:http), reuses
// the engine modules so the browser and the agent read the same .hikspine
// files. The board is a read-only status view (plus switching the active
// task); it never creates or drives tasks — the Claude Code agent does that
// via next/decide.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { boardState } from './board.mjs';
import { setActive } from './store.mjs';
import { PLUGIN_ROOT, validateChangeName } from './utils.mjs';

const DASHBOARD_HTML = path.join(PLUGIN_ROOT, 'dashboard', 'index.html');

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
