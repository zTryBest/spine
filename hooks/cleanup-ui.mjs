#!/usr/bin/env node
// Claude Code SessionEnd hook: stop a Hikspine UI process started for this project.

import childProcess from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { findProjectRoot } from '../src/utils.mjs';

const UI_PID_NAME = 'hikspine-ui.pid';
const UI_PID_REGISTRY_NAME = 'hikspine-ui-pids.json';
const HOOK_LOG_NAME = 'hook-events.log';
const TEMP_HOOK_LOG_NAME = 'hikspine-hook-events.log';

function tempHookLogFile() {
  return path.join(os.tmpdir(), TEMP_HOOK_LOG_NAME);
}

function writeJsonLine(file, entry) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, `${JSON.stringify(entry)}${os.EOL}`, 'utf8');
    return true;
  } catch {
    return false;
  }
}

function logEvent(roots, event) {
  const entry = {
    at: new Date().toISOString(),
    hook: 'SessionEnd',
    ...event,
  };
  let wrote = false;
  for (const root of roots || []) {
    try {
      wrote = writeJsonLine(path.join(root, '.hikspine', HOOK_LOG_NAME), entry) || wrote;
    } catch {
      // Fall back below.
    }
  }
  if (!wrote) writeJsonLine(tempHookLogFile(), entry);
}

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
  // The pid file lives at the Hikspine project root's .hikspine. If Claude is
  // exited from a subdirectory, cwd is the subdir — resolve each candidate up
  // to the project root (nearest ancestor with .hikspine/openspec) so we still
  // find the pid file, and anchor to the same root the engine/notify use.
  const roots = base.map(findProjectRoot).filter(Boolean);
  return [...base, ...roots];
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

function readPidRegistry(root) {
  try {
    const file = path.join(root, '.hikspine', UI_PID_REGISTRY_NAME);
    const value = JSON.parse(fs.readFileSync(file, 'utf8'));
    return Array.isArray(value) ? value.filter((item) => Number.isInteger(item?.pid) && item.pid > 0) : [];
  } catch {
    return [];
  }
}

function writePidRegistry(root, records) {
  const file = path.join(root, '.hikspine', UI_PID_REGISTRY_NAME);
  const list = (Array.isArray(records) ? records : [])
    .filter((item) => Number.isInteger(item?.pid) && item.pid > 0);
  try {
    if (list.length) fs.writeFileSync(file, JSON.stringify(list, null, 2));
    else fs.rmSync(file, { force: true });
  } catch {
    // Best-effort cleanup should never fail the hook.
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

function normalizePathText(value) {
  return String(value || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

function isHikspineUiCommand(cmd) {
  if (!cmd) return false;
  const normalized = cmd.replace(/\\/g, '/').toLowerCase();
  return normalized.includes('hikspine.mjs') && /\bui\b/.test(normalized);
}

function commandTargetsRoot(cmd, root) {
  const normalized = normalizePathText(cmd);
  const target = normalizePathText(root);
  return !!target && normalized.includes(target);
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

function registryFresh(record) {
  try {
    const at = new Date(record.startedAt).getTime();
    const ageMs = Date.now() - at;
    return Number.isFinite(ageMs) && ageMs >= 0 && ageMs < 24 * 60 * 60 * 1000;
  } catch {
    return false;
  }
}

function windowsUiProcessesForRoot(root) {
  const script = [
    '$ErrorActionPreference = "SilentlyContinue"',
    '$items = Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and $_.CommandLine -match "hikspine\\.mjs" -and $_.CommandLine -match "\\sui(\\s|$)" }',
    '$items | ForEach-Object { [PSCustomObject]@{ pid = $_.ProcessId; commandLine = $_.CommandLine } } | ConvertTo-Json -Compress',
  ].join('; ');
  try {
    const out = childProcess.execFileSync('powershell.exe', ['-NoProfile', '-Command', script], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 5000,
    }).trim();
    if (!out) return [];
    const value = JSON.parse(out);
    const list = Array.isArray(value) ? value : [value];
    return list
      .filter((item) => Number.isInteger(item?.pid) && isHikspineUiCommand(item.commandLine) && commandTargetsRoot(item.commandLine, root))
      .map((item) => ({ pid: item.pid, source: 'scan', fresh: true }));
  } catch {
    return [];
  }
}

function unixUiProcessesForRoot(root) {
  try {
    const out = childProcess.execFileSync('ps', ['-eo', 'pid=,command='], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 5000,
    });
    return out.split(/\r?\n/)
      .map((line) => {
        const match = line.trim().match(/^(\d+)\s+(.+)$/);
        return match ? { pid: Number(match[1]), commandLine: match[2] } : null;
      })
      .filter((item) => item && isHikspineUiCommand(item.commandLine) && commandTargetsRoot(item.commandLine, root))
      .map((item) => ({ pid: item.pid, source: 'scan', fresh: true }));
  } catch {
    return [];
  }
}

function uiProcessesForRoot(root) {
  return process.platform === 'win32' ? windowsUiProcessesForRoot(root) : unixUiProcessesForRoot(root);
}

function pidCandidates(root) {
  const out = [];
  const seen = new Set();
  const add = (item) => {
    if (!item?.pid || seen.has(item.pid)) return;
    seen.add(item.pid);
    out.push(item);
  };

  const pidFile = path.join(root, '.hikspine', UI_PID_NAME);
  const legacyPid = readPid(pidFile);
  if (legacyPid) add({ pid: legacyPid, source: 'legacy', fresh: freshPidFile(pidFile) });

  for (const record of readPidRegistry(root)) {
    add({ pid: record.pid, source: 'registry', fresh: registryFresh(record), record });
  }

  for (const item of uiProcessesForRoot(root)) add(item);
  return out;
}

async function cleanupCandidate(root, candidate) {
  const { pid } = candidate;
  if (!pid || !alive(pid)) {
    logEvent([root], { event: 'candidate', root, pid, source: candidate.source, status: 'stale' });
    return { root, status: 'stale', pid };
  }

  const cmd = commandLine(pid);
  if (cmd && !isHikspineUiCommand(cmd)) {
    logEvent([root], { event: 'candidate', root, pid, source: candidate.source, status: 'pid_reused', hasCommandLine: true });
    return { root, status: 'pid_reused', pid };
  }
  if (candidate.source === 'scan' && cmd && !commandTargetsRoot(cmd, root)) {
    logEvent([root], { event: 'candidate', root, pid, source: candidate.source, status: 'other_project', hasCommandLine: true });
    return { root, status: 'other_project', pid };
  }
  if (!cmd && !candidate.fresh) {
    logEvent([root], { event: 'candidate', root, pid, source: candidate.source, status: 'unverified_stale', hasCommandLine: false });
    return { root, status: 'unverified_stale', pid };
  }

  logEvent([root], {
    event: 'candidate',
    root,
    pid,
    source: candidate.source,
    status: 'terminating',
    hasCommandLine: !!cmd,
    commandMatchesRoot: cmd ? commandTargetsRoot(cmd, root) : null,
  });
  const stopped = await terminate(pid);
  logEvent([root], { event: 'terminate', root, pid, source: candidate.source, status: stopped ? 'stopped' : 'still_running' });
  return { root, status: stopped ? 'stopped' : 'still_running', pid };
}

async function cleanupRoot(root) {
  const candidates = pidCandidates(root);
  logEvent([root], {
    event: 'root_scan',
    root,
    candidateCount: candidates.length,
    candidates: candidates.map((item) => ({ pid: item.pid, source: item.source, fresh: !!item.fresh })),
  });
  if (!candidates.length) return { root, status: 'missing' };

  const results = [];
  for (const candidate of candidates) results.push(await cleanupCandidate(root, candidate));

  const stillRunning = new Set(results.filter((r) => r.status === 'still_running').map((r) => r.pid));
  const records = readPidRegistry(root).filter((record) => stillRunning.has(record.pid));
  writePidRegistry(root, records);

  const pidFile = path.join(root, '.hikspine', UI_PID_NAME);
  const legacyPid = readPid(pidFile);
  if (legacyPid && !stillRunning.has(legacyPid)) {
    try { fs.rmSync(pidFile, { force: true }); } catch {}
  }

  const stopped = results.filter((r) => r.status === 'stopped');
  if (stopped.length) return { root, status: 'stopped', pid: stopped.map((r) => r.pid).join(',') };
  return results[0] || { root, status: 'missing' };
}

const payload = parsePayload(readStdin());
const roots = uniqueRoots(candidatesFromPayload(payload));
logEvent(roots, {
  event: 'start',
  cwd: payload.cwd || process.cwd(),
  roots,
  payloadKeys: Object.keys(payload),
});
const results = [];
for (const root of roots) results.push(await cleanupRoot(root));
logEvent(roots, {
  event: 'done',
  roots,
  results: results.map((item) => ({ root: item.root, status: item.status, pid: item.pid || null })),
});

const stopped = results.filter((r) => r.status === 'stopped');
if (stopped.length) {
  process.stderr.write(`[HIKSPINE-HOOK] stopped UI pid(s): ${stopped.map((r) => r.pid).join(', ')}${os.EOL}`);
}
process.exit(0);
