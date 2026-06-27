import fs from 'node:fs';
import path from 'node:path';
import { readYamlFile } from './yaml.mjs';
import { readConfig } from './store.mjs';

export function builtinRegistry() {
  return {
    'openspec-explore': {
      ref: 'openspec-explore',
      description: 'Explore and clarify OpenSpec requirements.',
      sideEffects: [],
    },
    'openspec-propose': {
      ref: 'openspec-propose',
      description: 'Create or update OpenSpec proposal, tasks, and specs.',
      sideEffects: ['write-artifact'],
    },
    'openspec.design': {
      ref: 'openspec-propose',
      description: 'Update OpenSpec design.md from design decisions.',
      sideEffects: ['write-artifact'],
    },
    'openspec.verify': {
      ref: 'openspec-verify-change',
      description: 'Verify the OpenSpec change.',
      sideEffects: [],
    },
    'openspec.archive': {
      ref: 'openspec-archive-change',
      description: 'Archive the OpenSpec change.',
      sideEffects: ['write-artifact'],
      requiresConfirm: true,
    },
    brainstorming: {
      ref: 'brainstorming',
      description: 'Explore options, unknowns, tradeoffs, and questions.',
      sideEffects: [],
    },
    'superpowers.inspect': {
      ref: 'systematic-debugging',
      description: 'Understand the issue and inspect the relevant code path.',
      sideEffects: [],
    },
    'superpowers.plan': {
      ref: 'writing-plans',
      description: 'Create an implementation plan.',
      sideEffects: ['write-artifact'],
    },
    'superpowers.implement': {
      ref: 'executing-plans',
      description: 'Apply the implementation plan or focused fix.',
      sideEffects: ['write-source'],
    },
    'superpowers.review': {
      ref: 'requesting-code-review',
      description: 'Review code for correctness and maintainability.',
      sideEffects: [],
    },
    'superpowers.verify': {
      ref: 'verification-before-completion',
      description: 'Run focused verification before completion.',
      sideEffects: [],
    },
    'company.knowledge': {
      ref: 'company-knowledge',
      description: 'Query company knowledge, platform rules, and historical decisions.',
      sideEffects: [],
      optional: true,
    },
    'company.platform-design': {
      ref: 'company-platform-design',
      description: 'Check framework, component reuse, scaffold, API, data, and platform constraints.',
      sideEffects: [],
      optional: true,
    },
    'company.review': {
      ref: 'company-review',
      description: 'Review against company engineering standards.',
      sideEffects: [],
      optional: true,
    },
    'company.security': {
      ref: 'company-security',
      description: 'Review security, permissions, logging, data, and compliance risk.',
      sideEffects: [],
      optional: true,
    },
  };
}

function loadRegistryFile(file) {
  const data = readYamlFile(file);
  return data.skills || {};
}

export function loadRegistry(root) {
  const registry = { ...builtinRegistry() };
  const config = readConfig(root);
  const entries = Array.isArray(config.registries) ? config.registries : [];
  for (const entry of entries) {
    if (typeof entry !== 'string') continue;
    if (entry.startsWith('builtin.')) continue;
    const file = path.isAbsolute(entry) ? entry : path.join(root, entry);
    if (fs.existsSync(file)) Object.assign(registry, loadRegistryFile(file));
  }
  const dir = path.join(root, '.hikspine', 'registries');
  if (fs.existsSync(dir)) {
    for (const name of fs.readdirSync(dir).sort()) {
      if (name.endsWith('.yaml') || name.endsWith('.yml')) Object.assign(registry, loadRegistryFile(path.join(dir, name)));
    }
  }
  return registry;
}

export function skillInfo(registry, id) {
  return { id, ...(registry[id] || { ref: id, description: '', sideEffects: [], unknown: true }) };
}
