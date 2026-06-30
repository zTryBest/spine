#!/usr/bin/env node
// Claude Code SessionEnd hook: stop a Hikspine UI process started for this project.

import childProcess from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

function readStdin() {
  try {
    return fs.readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

function parsePayload(text) {
  if (!text.trim()) return {};
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

function gitToplevel(dir) {
  try {
    return childProcess.execFileSync('git', ['-C', dir, 'rev-parse', '--show-toplevel'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 3000,
    }).trim();
  } catch {
    return '';
  }
}

function candidatesFromPayload(payload) {
  const base = [
    process.env.HIKSPINE_PROJECT_ROOT,
    process.env.PROJECT_ROOT,
    payload.cwd,
    payload.project_root,
    payload.projectRoot,
    payload.workspace?.cwd,
    payload.workspace?.current_dir,
    process.cwd(),
  ].filter(Boolean);
  // The UI is started with --project-root = the git toplevel, so its pid file
  // lives at <repo-root>/.hikspine. If Claude is exited from a subdirectory,
  // cwd is the subdir — also resolve each candidate's git toplevel so we still
  // find the pid file at the repo root.
  const tops = base.map(gitToplevel).filter(Boolean);
  return [...base, ...tops];
}

function uniqueRoots(roots) {
  const out = [];
  const seen = new Set();
  for (const root of roots) {
    let resolved;
    try {
      resolved = fs.realpathSync(root);
    } catch {
      continue;
    }
    const key = process.platform === 'win32' ? resolved.toLowerCase() : resolved;
    if (!seen.has(key)) {
      seen.add(key);
      out.push(resolved);
    }
  }
  return out;
}

function readPid(pidFile) {
  try {
    const raw = fs.readFileSync(pidFile, 'utf8').trim();
    const pid = Number(raw);
    return Number.isInteger(pid) && pid > 0 ? pid : 0;
  } catch {
    return 0;
  }
}

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function powershellCommandLine(pid) {
  const script = [
    `$p = Get-CimInstance Win32_Process -Filter "ProcessId = ${pid}" -ErrorAction SilentlyContinue`,
    'if ($p) { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8; Write-Output $p.CommandLine }',
  ].join('; ');
  try {
    return childProcess.execFileSync('powershell.exe', ['-NoProfile', '-Command', script], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 3000,
    }).trim();
  } catch {
    try {
      const out = childProcess.execFileSync('wmic', ['process', 'where', `ProcessId=${pid}`, 'get', 'CommandLine', '/value'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: 3000,
      });
      return out.replace(/^CommandLine=/im, '').trim();
    } catch {
      return '';
    }
  }
}

function unixCommandLine(pid) {
  const procCmd = `/proc/${pid}/cmdline`;
  try {
    if (fs.existsSync(procCmd)) {
      return fs.readFileSync(procCmd).toString('utf8').replace(/\0/g, ' ').trim();
    }
  } catch {
    // Fall back to ps below.
  }
  try {
    return childProcess.execFileSync('ps', ['-p', String(pid), '-o', 'command='], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 3000,
    }).trim();
  } catch {
    return '';
  }
}

function commandLine(pid) {
  return process.platform === 'win32' ? powershellCommandLine(pid) : unixCommandLine(pid);
}

function isHikspineUiCommand(cmd) {
  if (!cmd) return false;
  const normalized = cmd.replace(/\\/g, '/').toLowerCase();
  return normalized.includes('hikspine.mjs') && /\bui\b/.test(normalized);
}

function freshPidFile(pidFile) {
  try {
    const ageMs = Date.now() - fs.statSync(pidFile).mtimeMs;
    return ageMs >= 0 && ageMs < 24 * 60 * 60 * 1000;
  } catch {
    return false;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function terminate(pid) {
  if (!alive(pid)) return true;
  try {
    process.kill(pid, 'SIGTERM');
  } catch {
    // Fall through to platform-specific termination below.
  }
  for (let i = 0; i < 10; i += 1) {
    await sleep(100);
    if (!alive(pid)) return true;
  }
  if (process.platform === 'win32') {
    try {
      childProcess.execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], {
        stdio: ['ignore', 'ignore', 'ignore'],
        timeout: 5000,
      });
    } catch {
      // The process may have exited between the alive check and taskkill.
    }
    await sleep(100);
    return !alive(pid);
  }
  try {
    process.kill(pid, 'SIGKILL');
  } catch {
    return !alive(pid);
  }
  await sleep(100);
  return !alive(pid);
}

async function cleanupRoot(root) {
  const pidFile = path.join(root, '.hikspine', 'hikspine-ui.pid');
  if (!fs.existsSync(pidFile)) return { root, status: 'missing' };
  const pid = readPid(pidFile);
  if (!pid || !alive(pid)) {
    fs.rmSync(pidFile, { force: true });
    return { root, status: 'stale', pid };
  }

  const cmd = commandLine(pid);
  if (cmd && !isHikspineUiCommand(cmd)) {
    fs.rmSync(pidFile, { force: true });
    return { root, status: 'pid_reused', pid };
  }
  if (!cmd && !freshPidFile(pidFile)) {
    fs.rmSync(pidFile, { force: true });
    return { root, status: 'unverified_stale', pid };
  }

  const stopped = await terminate(pid);
  if (stopped) fs.rmSync(pidFile, { force: true });
  return { root, status: stopped ? 'stopped' : 'still_running', pid };
}

const payload = parsePayload(readStdin());
const roots = uniqueRoots(candidatesFromPayload(payload));
const results = [];
for (const root of roots) results.push(await cleanupRoot(root));

const stopped = results.filter((r) => r.status === 'stopped');
if (stopped.length) {
  process.stderr.write(`[HIKSPINE-HOOK] stopped UI pid(s): ${stopped.map((r) => r.pid).join(', ')}${os.EOL}`);
}
process.exit(0);
