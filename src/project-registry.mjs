import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ensureDir, PLUGIN_ROOT } from './utils.mjs';

const REGISTRY_VERSION = 1;

export function hikspineHome() {
  return path.resolve(process.env.HIKSPINE_HOME || path.join(os.homedir(), '.hikspine'));
}

export function projectRegistryFile() {
  return path.join(hikspineHome(), 'projects.json');
}

function projectId(root) {
  const normalized = path.resolve(root).replace(/\\/g, '/').toLowerCase();
  return crypto.createHash('sha256').update(normalized).digest('hex').slice(0, 16);
}

function pluginVersion() {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(PLUGIN_ROOT, 'package.json'), 'utf8'));
    return String(pkg.version || '');
  } catch {
    return '';
  }
}

function projectName(root) {
  return path.basename(path.resolve(root)) || path.resolve(root);
}

function readRawRegistry() {
  try {
    const value = JSON.parse(fs.readFileSync(projectRegistryFile(), 'utf8'));
    const projects = Array.isArray(value.projects) ? value.projects : [];
    return { version: value.version || REGISTRY_VERSION, projects };
  } catch {
    return { version: REGISTRY_VERSION, projects: [] };
  }
}

function writeRegistry(value) {
  const file = projectRegistryFile();
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, JSON.stringify(value, null, 2));
}

function normalizeProject(record) {
  if (!record || typeof record !== 'object' || !record.root) return null;
  let root;
  try {
    root = path.resolve(record.root);
  } catch {
    return null;
  }
  return {
    id: record.id || projectId(root),
    name: record.name || projectName(root),
    root,
    lastSeenAt: record.lastSeenAt || null,
    pluginVersion: record.pluginVersion || '',
  };
}

export function readRegisteredProjects({ includeMissing = false } = {}) {
  const seen = new Set();
  const out = [];
  for (const item of readRawRegistry().projects) {
    const record = normalizeProject(item);
    if (!record || seen.has(record.id)) continue;
    seen.add(record.id);
    const exists = fs.existsSync(record.root) && fs.statSync(record.root).isDirectory();
    if (!exists && !includeMissing) continue;
    out.push({ ...record, missing: !exists });
  }
  return out.sort((a, b) => String(b.lastSeenAt || '').localeCompare(String(a.lastSeenAt || '')));
}

export function findRegisteredProject(id) {
  return readRegisteredProjects({ includeMissing: true }).find((p) => p.id === id) || null;
}

export function registerProject(root, extra = {}) {
  const resolved = path.resolve(root);
  const now = new Date().toISOString();
  const id = projectId(resolved);
  const registry = readRawRegistry();
  const current = {
    id,
    name: extra.name || projectName(resolved),
    root: resolved,
    lastSeenAt: now,
    pluginVersion: pluginVersion(),
  };
  const projects = registry.projects
    .map(normalizeProject)
    .filter(Boolean)
    .filter((p) => p.id !== id);
  projects.unshift(current);
  writeRegistry({ version: REGISTRY_VERSION, updatedAt: now, projects });
  return current;
}
