import { die, isPlainObject, readText, writeText } from './utils.mjs';

function stripInlineComment(line) {
  let quote = '';
  let depth = 0;
  let out = '';
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i];
    if (quote) {
      out += c;
      if (c === quote && line[i - 1] !== '\\') quote = '';
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      out += c;
      continue;
    }
    if (c === '[' || c === '{') depth += 1;
    if (c === ']' || c === '}') depth -= 1;
    if (c === '#' && depth === 0 && (i === 0 || /\s/.test(line[i - 1]))) return out.trimEnd();
    out += c;
  }
  return out.trimEnd();
}

function tokenizeYaml(text) {
  return text
    .replace(/\t/g, '  ')
    .split('\n')
    .map((raw, idx) => {
      const line = stripInlineComment(raw);
      if (!line.trim()) return null;
      const indent = line.match(/^ */)[0].length;
      return { indent, text: line.trim(), line: idx + 1 };
    })
    .filter(Boolean);
}

function splitTopLevel(text, delimiter) {
  const parts = [];
  let quote = '';
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (quote) {
      if (c === quote && text[i - 1] !== '\\') quote = '';
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      continue;
    }
    if (c === '[' || c === '{') depth += 1;
    else if (c === ']' || c === '}') depth -= 1;
    else if (c === delimiter && depth === 0) {
      parts.push(text.slice(start, i).trim());
      start = i + 1;
    }
  }
  parts.push(text.slice(start).trim());
  return parts.filter(Boolean);
}

function splitKeyValue(text) {
  let quote = '';
  let depth = 0;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (quote) {
      if (c === quote && text[i - 1] !== '\\') quote = '';
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      continue;
    }
    if (c === '[' || c === '{') depth += 1;
    else if (c === ']' || c === '}') depth -= 1;
    else if (c === ':' && depth === 0) return [text.slice(0, i).trim(), text.slice(i + 1).trim()];
  }
  return [text.trim(), undefined];
}

function parseScalar(text) {
  const s = String(text ?? '').trim();
  if (s === '' || s === 'null' || s === '~') return null;
  if (s === 'true') return true;
  if (s === 'false') return false;
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    if (s.startsWith('"')) return JSON.parse(s);
    return s.slice(1, -1).replace(/''/g, "'");
  }
  if (s.startsWith('[') && s.endsWith(']')) {
    const inner = s.slice(1, -1).trim();
    return inner ? splitTopLevel(inner, ',').map(parseScalar) : [];
  }
  if (s.startsWith('{') && s.endsWith('}')) {
    const inner = s.slice(1, -1).trim();
    if (!inner) return {};
    const out = {};
    for (const part of splitTopLevel(inner, ',')) {
      const [k, v] = splitKeyValue(part);
      out[k] = parseScalar(v ?? '');
    }
    return out;
  }
  return s;
}

function parseYamlBlock(tokens, index, indent) {
  if (index >= tokens.length) return [null, index];
  const first = tokens[index];
  if (first.indent < indent) return [null, index];

  if (first.indent === indent && (first.text === '-' || first.text.startsWith('- '))) {
    const arr = [];
    while (index < tokens.length) {
      const token = tokens[index];
      if (token.indent !== indent || !(token.text === '-' || token.text.startsWith('- '))) break;
      const itemText = token.text === '-' ? '' : token.text.slice(2).trim();
      index += 1;
      let item;
      if (!itemText) {
        [item, index] = parseYamlBlock(tokens, index, indent + 2);
      } else {
        const [key, value] = splitKeyValue(itemText);
        item = value !== undefined ? { [key]: parseScalar(value) } : parseScalar(itemText);
      }
      if (index < tokens.length && tokens[index].indent > indent) {
        const [child, next] = parseYamlBlock(tokens, index, tokens[index].indent);
        index = next;
        if (isPlainObject(item) && isPlainObject(child)) item = { ...item, ...child };
        else if (item == null) item = child;
      }
      arr.push(item);
    }
    return [arr, index];
  }

  const obj = {};
  while (index < tokens.length) {
    const token = tokens[index];
    if (token.indent < indent) break;
    if (token.indent > indent) die(`YAML parse error near line ${token.line}: unexpected indentation.`);
    if (token.text.startsWith('- ')) break;
    const [key, valueText] = splitKeyValue(token.text);
    if (!key || valueText === undefined) die(`YAML parse error near line ${token.line}: expected key: value.`);
    index += 1;
    if (valueText === '') {
      if (index < tokens.length && tokens[index].indent > indent) {
        const [child, next] = parseYamlBlock(tokens, index, tokens[index].indent);
        obj[key] = child;
        index = next;
      } else {
        obj[key] = null;
      }
    } else {
      obj[key] = parseScalar(valueText);
    }
  }
  return [obj, index];
}

export function parseYaml(text) {
  const tokens = tokenizeYaml(text);
  if (tokens.length === 0) return {};
  const [value, index] = parseYamlBlock(tokens, 0, tokens[0].indent);
  if (index < tokens.length) die(`YAML parse error near line ${tokens[index].line}.`);
  return value || {};
}

function formatScalar(value) {
  if (value == null) return '';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return String(value);
  const s = String(value);
  if (s && /^[A-Za-z0-9_./:@+-]+$/.test(s) && !['true', 'false', 'null', '~'].includes(s)) return s;
  return JSON.stringify(s);
}

function yamlDumpValue(value, indent = 0) {
  const sp = ' '.repeat(indent);
  if (Array.isArray(value)) {
    if (value.length === 0) return `${sp}[]\n`;
    let out = '';
    for (const item of value) {
      if (isPlainObject(item) || Array.isArray(item)) out += `${sp}-\n${yamlDumpValue(item, indent + 2)}`;
      else out += `${sp}- ${formatScalar(item)}\n`;
    }
    return out;
  }
  if (isPlainObject(value)) {
    const entries = Object.entries(value);
    if (entries.length === 0) return `${sp}{}\n`;
    let out = '';
    for (const [key, val] of entries) {
      if (isPlainObject(val) || Array.isArray(val)) {
        const empty = Array.isArray(val) ? val.length === 0 : Object.keys(val).length === 0;
        out += empty ? `${sp}${key}: ${Array.isArray(val) ? '[]' : '{}'}\n` : `${sp}${key}:\n${yamlDumpValue(val, indent + 2)}`;
      } else {
        out += `${sp}${key}: ${formatScalar(val)}\n`;
      }
    }
    return out;
  }
  return `${sp}${formatScalar(value)}\n`;
}

export function readYamlFile(file) {
  return parseYaml(readText(file));
}

export function writeYamlFile(file, value) {
  writeText(file, yamlDumpValue(value));
}
