import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { readConfig } from './store.mjs';
import { isPlainObject, readText, rel, toPosix } from './utils.mjs';

function template(value, state) {
  return String(value || '').replaceAll('{change}', state.change);
}

function repoPath(root, state, value) {
  const p = template(value, state);
  if (!p) return '';
  return path.isAbsolute(p) ? p : path.join(root, p);
}

function displayPath(root, state, value) {
  const p = repoPath(root, state, value);
  return p ? rel(root, p) : '';
}

function artifactPath(root, state, key) {
  const value = state.artifacts?.[key];
  if (!value) return '';
  return repoPath(root, state, value);
}

function existsNonEmpty(file) {
  if (!file || !fs.existsSync(file)) return false;
  const st = fs.statSync(file);
  return st.isDirectory() ? true : st.size > 0;
}

function hasHeading(text, heading) {
  const escaped = String(heading).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^#{1,6}\\s+${escaped}\\s*$`, 'im').test(text);
}

function normalizeCheck(check) {
  if (typeof check === 'string') return { type: check, params: true };
  if (isPlainObject(check)) {
    const entries = Object.entries(check);
    if (entries.length === 1) return { type: entries[0][0], params: entries[0][1] };
  }
  return { type: 'invalid', params: check };
}

function fail(check, message, extra = {}) {
  return { ok: false, kind: 'check', key: check.type, message, ...extra };
}

function pass(check, extra = {}) {
  return { ok: true, kind: 'check', key: check.type, ...extra };
}

function gitChangedFiles(root) {
  try {
    const out = execFileSync('git', ['diff', '--name-only', '--', '.'], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return out.split(/\r?\n/).filter(Boolean).map(toPosix);
  } catch {
    return [];
  }
}

function sourceRoots(root) {
  const config = readConfig(root);
  const roots = config.guard?.sourceRoots;
  return Array.isArray(roots) && roots.length ? roots.map(toPosix) : ['src/', 'app/', 'lib/', 'packages/'];
}

export function normalizeTarget(root, target) {
  if (!target) return '';
  const raw = toPosix(target);
  if (path.isAbsolute(target)) return rel(root, target);
  return raw.replace(/^\.\//, '');
}

export function isSourcePath(root, target) {
  const n = normalizeTarget(root, target);
  if (!n) return false;
  if (n.startsWith('openspec/changes/')) return false;
  if (n.startsWith('.hikspine/')) return false;
  if (n.includes('/.hikspine/')) return false;
  if (sourceRoots(root).some((prefix) => n.startsWith(prefix.replace(/\*.*$/, '')))) return true;
  return /\.(js|jsx|ts|tsx|java|kt|go|rs|py|cs|cpp|c|h|css|scss|html|vue|svelte)$/.test(n);
}

export function evaluateCheck(root, state, rawCheck) {
  const check = normalizeCheck(rawCheck);
  const params = check.params;

  if (check.type === 'file.exists') {
    const file = repoPath(root, state, params);
    return existsNonEmpty(file) ? pass(check, { path: displayPath(root, state, params) }) : fail(check, `Missing file ${displayPath(root, state, params)}`, { path: displayPath(root, state, params) });
  }

  if (check.type === 'dir.exists') {
    const dir = repoPath(root, state, params);
    const ok = !!dir && fs.existsSync(dir) && fs.statSync(dir).isDirectory();
    return ok ? pass(check, { path: displayPath(root, state, params) }) : fail(check, `Missing directory ${displayPath(root, state, params)}`, { path: displayPath(root, state, params) });
  }

  if (check.type === 'artifact.exists') {
    const file = artifactPath(root, state, params);
    const key = String(params || '');
    return existsNonEmpty(file) ? pass(check, { artifact: key, path: rel(root, file) }) : fail(check, `Missing artifact ${key}`, { artifact: key });
  }

  if (check.type === 'file.contains') {
    const file = repoPath(root, state, params?.path);
    if (!existsNonEmpty(file)) return fail(check, `Missing file ${displayPath(root, state, params?.path)}`, { path: displayPath(root, state, params?.path) });
    const needle = template(params?.text || params?.contains || '', state);
    return readText(file).includes(needle) ? pass(check, { path: rel(root, file) }) : fail(check, `File does not contain '${needle}'`, { path: rel(root, file) });
  }

  if (check.type === 'file.contains_regex') {
    const file = repoPath(root, state, params?.path);
    if (!existsNonEmpty(file)) return fail(check, `Missing file ${displayPath(root, state, params?.path)}`, { path: displayPath(root, state, params?.path) });
    const pattern = template(params?.pattern || '', state);
    return new RegExp(pattern, 'im').test(readText(file)) ? pass(check, { path: rel(root, file) }) : fail(check, `File does not match /${pattern}/`, { path: rel(root, file) });
  }

  if (check.type === 'file.contains_heading') {
    const file = repoPath(root, state, params?.path);
    if (!existsNonEmpty(file)) return fail(check, `Missing file ${displayPath(root, state, params?.path)}`, { path: displayPath(root, state, params?.path) });
    const heading = params?.heading || params?.text || params;
    return hasHeading(readText(file), heading) ? pass(check, { path: rel(root, file), heading }) : fail(check, `Missing heading '${heading}'`, { path: rel(root, file), heading });
  }

  if (check.type === 'file.contains_headings') {
    const file = repoPath(root, state, params?.path);
    if (!existsNonEmpty(file)) return fail(check, `Missing file ${displayPath(root, state, params?.path)}`, { path: displayPath(root, state, params?.path) });
    const text = readText(file);
    const missing = (params?.headings || []).filter((heading) => !hasHeading(text, heading));
    return missing.length ? fail(check, `Missing headings: ${missing.join(', ')}`, { path: rel(root, file), missingHeadings: missing }) : pass(check, { path: rel(root, file) });
  }

  if (check.type === 'git.has_changes') {
    const scope = params === true ? '' : String(params || '');
    const files = gitChangedFiles(root).filter((name) => !scope || name.startsWith(toPosix(scope)));
    return files.length ? pass(check, { files }) : fail(check, scope ? `No git changes under ${scope}` : 'No git changes found');
  }

  if (check.type === 'git.has_source_changes') {
    const files = gitChangedFiles(root).filter((name) => isSourcePath(root, name));
    return files.length ? pass(check, { files }) : fail(check, 'No source changes found');
  }

  if (check.type === 'always.false') return fail(check, String(params || 'Blocked by workflow.'));

  return fail(check, `Unknown check '${check.type}'`);
}

export function evaluateChecks(root, state, checks = []) {
  const results = checks.map((check) => evaluateCheck(root, state, check));
  const missing = results.filter((item) => !item.ok);
  return { ok: missing.length === 0, results, missing };
}

export function checkGuard(root, state, workflow, target) {
  const current = typeof state?.current === 'string' ? state.current : state?.current?.phase;
  const s = (workflow.states || []).find((item) => item.id === current) || null;
  const forbid = Array.isArray(s?.forbid) ? s.forbid : s?.forbid ? [s.forbid] : [];
  const blocked = forbid.includes('write-source') && isSourcePath(root, target);
  return {
    allow: !blocked,
    state: s?.id || '',
    target: normalizeTarget(root, target),
    rule: blocked ? 'write-source' : null,
  };
}
