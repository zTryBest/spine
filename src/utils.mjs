import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

export const SRC_DIR = path.dirname(fileURLToPath(import.meta.url));
export const PLUGIN_ROOT = path.resolve(SRC_DIR, '..');
export const BUILTIN_WORKFLOWS_DIR = path.join(SRC_DIR, 'workflows');

export class UserError extends Error {
  constructor(message, code = 1) {
    super(message);
    this.code = code;
  }
}

export function die(message, code = 1) {
  throw new UserError(message, code);
}

export function cwd() {
  return process.cwd();
}

function normalizeProjectRootInput(value) {
  let raw = String(value || '');
  if (process.platform !== 'win32') return raw;
  raw = raw.replace(/\\/g, '/');
  const wsl = raw.match(/^\/mnt\/([a-z])\/(.*)$/i);
  if (wsl) return `${wsl[1].toUpperCase()}:/${wsl[2]}`;
  const gitBash = raw.match(/^\/([a-z])\/(.*)$/i);
  if (gitBash) return `${gitBash[1].toUpperCase()}:/${gitBash[2]}`;
  const gitBashNoLeadingSlash = raw.match(/^([a-z])\/(.*)$/i);
  if (gitBashNoLeadingSlash) return `${gitBashNoLeadingSlash[1].toUpperCase()}:/${gitBashNoLeadingSlash[2]}`;
  const driveRelative = raw.match(/^([a-z]):([^/].*)$/i);
  if (driveRelative) return `${driveRelative[1].toUpperCase()}:/${driveRelative[2]}`;
  return raw;
}

export function resolveProjectRoot(opts = {}) {
  const raw = normalizeProjectRootInput(opts['project-root'] || process.env.HIKSPINE_PROJECT_ROOT || cwd());
  const root = path.resolve(raw);
  if (!fs.existsSync(root)) die(`Project root does not exist: ${root}`);
  if (!fs.statSync(root).isDirectory()) die(`Project root is not a directory: ${root}`);
  return root;
}

export function nowIso() {
  return new Date().toISOString();
}

export function toPosix(value) {
  return String(value || '').replace(/\\/g, '/');
}

export function rel(root, abs) {
  return toPosix(path.relative(root, abs));
}

export function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

export function readText(file) {
  return fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
}

export function writeText(file, text) {
  ensureDir(path.dirname(file));
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, text, 'utf8');
  fs.renameSync(tmp, file);
}

export function sha256(text) {
  return `sha256:${crypto.createHash('sha256').update(text).digest('hex')}`;
}

export function isPlainObject(value) {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

export function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

export function validateChangeName(name) {
  if (!name) die('Change name is required.');
  if (!/^[A-Za-z0-9_-]+$/.test(name) || name.includes('..')) {
    die(`Invalid change name '${name}'. Use letters, numbers, dash, or underscore.`);
  }
}

export function parseJsonish(input) {
  if (input === undefined) return true;
  try {
    return JSON.parse(input);
  } catch {
    if (input === 'true') return true;
    if (input === 'false') return false;
    if (input === 'null') return null;
    return input;
  }
}

export function parseOptions(args) {
  const out = { _: [] };
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--json') out.json = true;
    else if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = args[i + 1];
      if (next == null || next.startsWith('--')) out[key] = true;
      else {
        out[key] = next;
        i += 1;
      }
    } else {
      out._.push(arg);
    }
  }
  return out;
}
