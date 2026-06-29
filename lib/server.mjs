// Local web server for the orchestration board. Dependency-free (node:http),
// reuses lib/ so the browser and the agent operate on the same .hikspine files
// — the UI is a view + launcher, never a parallel source of truth.

import http from 'node:http';
import { boardState, changeSummary } from './board.mjs';
import { createState, getActive, setActive } from './store.mjs';
import { validateChangeName } from './utils.mjs';
import { BOARD_HTML } from './board-html.mjs';

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
      if (req.method === 'GET' && url.pathname === '/api/state') {
        sendJson(res, 200, boardState(root));
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
