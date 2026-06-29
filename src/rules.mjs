import fs from 'node:fs';
import path from 'node:path';
import {
  PLUGIN_ROOT,
  ensureDir,
  readText,
  sha256,
  toPosix,
  writeText,
} from './utils.mjs';

export const PLUGIN_RULES_DIR = path.join(PLUGIN_ROOT, 'rules');

const MANAGED_RE = /^<!-- hikspine:managed source="([^"]+)" bodySha="(sha256:[a-f0-9]+)" -->\n/;

function normalizeText(value) {
  const text = String(value || '').replace(/\r\n/g, '\n');
  return text.endsWith('\n') ? text : `${text}\n`;
}

function escapeAttr(value) {
  return String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

function unescapeAttr(value) {
  return String(value).replace(/&quot;/g, '"').replace(/&amp;/g, '&');
}

function managedText(source, body) {
  return `<!-- hikspine:managed source="${escapeAttr(source)}" bodySha="${sha256(body)}" -->\n${body}`;
}

function parseManaged(text) {
  const match = text.match(MANAGED_RE);
  if (!match) return null;
  return {
    source: unescapeAttr(match[1]),
    bodySha: match[2],
    body: text.slice(match[0].length),
  };
}

function listMarkdownFiles(root, dir = root) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const dirent of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, dirent.name);
    if (dirent.isDirectory()) out.push(...listMarkdownFiles(root, abs));
    else if (dirent.isFile() && dirent.name.toLowerCase().endsWith('.md')) {
      out.push({
        file: abs,
        relPath: toPosix(path.relative(root, abs)),
      });
    }
  }
  return out.sort((a, b) => a.relPath.localeCompare(b.relPath));
}

export function syncProjectRules(projectRoot, opts = {}) {
  const sourceDir = opts.sourceDir || process.env.HIKSPINE_RULES_DIR || PLUGIN_RULES_DIR;
  const destDir = opts.destDir || path.join(projectRoot, '.claude', 'rules');
  const result = {
    sourceDir,
    destDir,
    copied: [],
    updated: [],
    unchanged: [],
    skipped: [],
  };

  if (process.env.HIKSPINE_SKIP_RULES_SYNC === '1') {
    result.skipped.push({ reason: 'disabled_by_env' });
    return result;
  }

  if (!fs.existsSync(sourceDir)) return result;
  const rules = listMarkdownFiles(sourceDir);
  if (rules.length === 0) return result;

  ensureDir(destDir);
  for (const rule of rules) {
    const body = normalizeText(readText(rule.file));
    const desired = managedText(rule.relPath, body);
    const target = path.join(destDir, ...rule.relPath.split('/'));
    const publicPath = toPosix(path.relative(projectRoot, target));

    if (!fs.existsSync(target)) {
      writeText(target, desired);
      result.copied.push(publicPath);
      continue;
    }

    const existing = normalizeText(readText(target));
    if (existing === desired) {
      result.unchanged.push(publicPath);
      continue;
    }

    const managed = parseManaged(existing);
    if (managed?.source === rule.relPath && sha256(managed.body) === managed.bodySha) {
      writeText(target, desired);
      result.updated.push(publicPath);
      continue;
    }

    result.skipped.push({
      path: publicPath,
      reason: managed ? 'managed_file_modified_locally' : 'unmanaged_existing_file',
    });
  }

  return result;
}

export function publicRuleSync(result) {
  const copied = result?.copied || [];
  const updated = result?.updated || [];
  return {
    copied,
    updated,
    skipped: result?.skipped || [],
    readNow: [...copied, ...updated],
  };
}
