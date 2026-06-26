#!/usr/bin/env node
// hikspine-preset.mjs — read a preset definition (JSON) and emit bash-friendly
// descriptors so the pure-bash state machine stays generic (no hardcoded phases).
//
// Usage: node hikspine-preset.mjs <preset.json> <command> [args...]
// Commands:
//   first-phase                  -> first phase id
//   phases                       -> all phase ids, one per line
//   defaults                     -> "<field>\t<value>" lines (value 'null' literal for null)
//   skill <phaseId>              -> the skill that owns the phase
//   phase-info <phaseId>         -> descriptor block (see below), tab-separated
//
// phase-info emits:
//   ID\t<id>
//   SKILL\t<skill>
//   ON_COMPLETE\t<phaseId|''>
//   ON_FAIL\t<phaseId|''>
//   TERMINAL\t<0|1>
//   ARTIFACT\t<file>                       (0..n)
//   STATE\t<field>\texists|set             (0..n)
//   STATE\t<field>\teq\t<value>            (0..n)
//   STATE\t<field>\tin\t<v1>\t<v2>...      (0..n)
//   SET_COMPLETE\t<field>\t<value>         (0..n; @date resolved by caller)
//   SET_FAIL\t<field>\t<value>             (0..n)

import { readFileSync } from 'node:fs';

const [presetFile, cmd, ...args] = process.argv.slice(2);
if (!presetFile || !cmd) {
  process.stderr.write('usage: hikspine-preset.mjs <preset.json> <command> [args]\n');
  process.exit(2);
}

let preset;
try {
  preset = JSON.parse(readFileSync(presetFile, 'utf8'));
} catch (e) {
  process.stderr.write(`ERROR: cannot read preset ${presetFile}: ${e.message}\n`);
  process.exit(1);
}

const phases = Array.isArray(preset.phases) ? preset.phases : [];
const byId = (id) => phases.find((p) => p.id === id);
const out = [];
const emit = (...cols) => out.push(cols.join('\t'));

function emitGuard(p) {
  const g = p.guard || {};
  for (const a of g.artifacts || []) emit('ARTIFACT', a);
  for (const [field, spec] of Object.entries(g.state || {})) {
    if (Array.isArray(spec)) emit('STATE', field, 'in', ...spec);
    else if (spec === 'exists' || spec === 'set') emit('STATE', field, spec);
    else emit('STATE', field, 'eq', String(spec));
  }
}

function emitSets(p) {
  for (const [k, v] of Object.entries(p.onCompleteSet || {}))
    emit('SET_COMPLETE', k, v === null ? 'null' : String(v));
  for (const [k, v] of Object.entries(p.onFailSet || {}))
    emit('SET_FAIL', k, v === null ? 'null' : String(v));
}

switch (cmd) {
  case 'first-phase':
    process.stdout.write((phases[0]?.id || '') + '\n');
    break;
  case 'phases':
    process.stdout.write(phases.map((p) => p.id).join('\n') + (phases.length ? '\n' : ''));
    break;
  case 'defaults': {
    const d = preset.defaults || {};
    const lines = Object.entries(d).map(([k, v]) => `${k}\t${v === null ? 'null' : String(v)}`);
    process.stdout.write(lines.join('\n') + (lines.length ? '\n' : ''));
    break;
  }
  case 'skill': {
    const p = byId(args[0]);
    process.stdout.write((p?.skill || '') + '\n');
    break;
  }
  case 'steps': {
    // Emit the phase's ordered provider steps: "role\tskill\tnote".
    const p = byId(args[0]);
    if (!p) {
      process.stderr.write(`ERROR: phase '${args[0]}' not found in preset '${preset.name}'\n`);
      process.exit(3);
    }
    const lines = (p.steps || []).map(
      (s) => `${s.role || ''}\t${s.skill || ''}\t${s.note || ''}`,
    );
    process.stdout.write(lines.join('\n') + (lines.length ? '\n' : ''));
    break;
  }
  case 'phase-info': {
    const p = byId(args[0]);
    if (!p) {
      process.stderr.write(`ERROR: phase '${args[0]}' not found in preset '${preset.name}'\n`);
      process.exit(3);
    }
    emit('ID', p.id);
    emit('SKILL', p.skill || '');
    emit('ON_COMPLETE', p.onComplete || '');
    emit('ON_FAIL', p.onFail || '');
    emit('TERMINAL', p.terminal ? '1' : '0');
    emitGuard(p);
    emitSets(p);
    process.stdout.write(out.join('\n') + (out.length ? '\n' : ''));
    break;
  }
  default:
    process.stderr.write(`unknown command: ${cmd}\n`);
    process.exit(2);
}
