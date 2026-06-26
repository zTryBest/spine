#!/usr/bin/env node
// hikspine-config.mjs — project config (.hikspine/config.json) reader + step resolver.
//
// The project config is JSON (structured) so teams can declare nested data —
// provider overrides and inserted steps — without forking the plugin or editing
// presets. Usage:
//
//   get <configFile> <key>
//       -> print a scalar config value (empty if absent). Objects/arrays as JSON.
//
//   resolve-steps <presetFile> <phase> <workflow> <configFile>
//       -> emit the phase's final ordered steps as "role\tskill\tnote" lines:
//          preset steps, with provider overrides applied, and project-level
//          extra_steps spliced in at named insertion points.
//
// Provider override priority (most specific wins), read from config.providers:
//   "<workflow>.<phase>.<role>"  >  "<phase>.<role>"  >  "<role>"
//
// extra_steps insertion keys, read from config.extra_steps:
//   "<phase>.start" | "<phase>.before_<role>" | "<phase>.after_<role>" | "<phase>.end"
// Each maps to a list of { role, skill, note } step objects.

import { readFileSync, existsSync } from 'node:fs';

const [cmd, ...rest] = process.argv.slice(2);

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

function loadConfig(configFile) {
  if (!configFile || !existsSync(configFile)) return {};
  return readJson(configFile) || {};
}

if (cmd === 'get') {
  const [configFile, key] = rest;
  const cfg = loadConfig(configFile);
  const v = Object.prototype.hasOwnProperty.call(cfg, key) ? cfg[key] : '';
  process.stdout.write(v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v));
} else if (cmd === 'resolve-steps') {
  const [presetFile, phase, workflow, configFile] = rest;
  const preset = readJson(presetFile);
  if (!preset) {
    process.stderr.write(`ERROR: cannot read preset ${presetFile}\n`);
    process.exit(1);
  }
  const ph = (preset.phases || []).find((p) => p.id === phase);
  if (!ph) {
    process.stderr.write(`ERROR: phase '${phase}' not found in preset '${preset.name}'\n`);
    process.exit(3);
  }
  const cfg = loadConfig(configFile);
  const providers = cfg.providers || {};
  const extra = cfg.extra_steps || {};

  const overrideSkill = (role) => {
    for (const k of [`${workflow}.${phase}.${role}`, `${phase}.${role}`, role]) {
      if (providers[k] != null && providers[k] !== '') return providers[k];
    }
    return null;
  };
  const mk = (s) => ({
    role: s.role || '',
    skill: overrideSkill(s.role) || s.skill || '',
    note: s.note || '',
  });
  const at = (key) => (Array.isArray(extra[key]) ? extra[key].map(mk) : []);

  let out = [];
  out = out.concat(at(`${phase}.start`));
  for (const s of ph.steps || []) {
    out = out.concat(at(`${phase}.before_${s.role}`));
    out.push(mk(s));
    out = out.concat(at(`${phase}.after_${s.role}`));
  }
  out = out.concat(at(`${phase}.end`));

  process.stdout.write(out.map((s) => `${s.role}\t${s.skill}\t${s.note}`).join('\n') + (out.length ? '\n' : ''));
} else {
  process.stderr.write(`unknown command: ${cmd}\n`);
  process.exit(2);
}
