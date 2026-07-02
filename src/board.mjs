// Board state: a read-only aggregate of everything the orchestration UI shows
// — in-flight changes (concurrent runs), available workflows, and discoverable
// skills. Reused by the `board`/`changes` CLI commands and the web server, so
// the UI and the agent see exactly the same truth.

import fs from 'node:fs';
import path from 'node:path';
import { getActive, listStates, listWorkflows, loadState, loadStateEntry, loadWorkflow } from './store.mjs';
import { summarize } from './transitions.mjs';
import { discoverSkills, normalizeCapability } from './skills.mjs';
import { readNotifications } from './notifications.mjs';
import { rel, toPosix } from './utils.mjs';
import { projectRegistryFile, readRegisteredProjects } from './project-registry.mjs';

function minutesBetween(start, end) {
  const a = new Date(start).getTime();
  const b = new Date(end).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) return 0;
  return Math.max(1, Math.round((b - a) / 60000));
}

function stageDurations(workflow, state) {
  const ids = (workflow.states || []).map((s) => s.id);
  const totals = Object.fromEntries(ids.map((id) => [id, 0]));
  const history = Array.isArray(state.history) ? state.history : [];
  if (!history.length) return totals;

  let current = history[0].state || state.current || workflow.start || ids[0];
  let startedAt = history[0].at;
  let finished = false;
  for (const event of history.slice(1)) {
    if ((event.type === 'transition' || event.type === 'rollback') && event.at) {
      if (current && totals[current] != null) totals[current] += minutesBetween(startedAt, event.at);
      current = event.to || current;
      startedAt = event.at;
      finished = false;
    } else if (event.type === 'complete' && event.at) {
      if (current && totals[current] != null) totals[current] += minutesBetween(startedAt, event.at);
      startedAt = event.at;
      finished = true;
    }
  }
  if (!finished && current && totals[current] != null && !state.decisions?.archived) {
    totals[current] += minutesBetween(startedAt, new Date().toISOString());
  }
  return totals;
}

function artifactStage(relPath, stages = []) {
  const p = toPosix(relPath).toLowerCase();
  const name = path.posix.basename(p);
  const hasStage = (id) => stages.includes(id);
  if (name === 'proposal.md' || name === 'tasks.md' || p.startsWith('specs/') || p.includes('/specs/')) return hasStage('openspec') ? 'openspec' : (hasStage('open') ? 'open' : 'openspec');
  if (name === 'design.md') return 'design';
  if (p.includes('/plans/') || name.includes('plan')) return 'build';
  if (name.includes('review')) return 'review';
  if (name.includes('verify') || name.includes('verification')) return 'verify';
  if (name.includes('brainstorm')) return 'brainstorm';
  return 'openspec';
}

function artifactLabel(relPath) {
  const p = toPosix(relPath);
  const name = path.posix.basename(p);
  if (name === 'proposal.md') return 'Proposal';
  if (name === 'design.md') return 'Design';
  if (name === 'tasks.md') return 'Tasks';
  if (p.startsWith('specs/') || p.includes('/specs/')) return `Spec: ${name}`;
  return name;
}

function artifactType(relPath) {
  const p = toPosix(relPath).toLowerCase();
  const name = path.posix.basename(p);
  if (name === 'proposal.md') return 'proposal';
  if (name === 'design.md') return 'design';
  if (name === 'tasks.md') return 'tasks';
  if (p.startsWith('specs/') || p.includes('/specs/')) return 'spec';
  if (name.includes('review')) return 'review';
  if (name.includes('verify') || name.includes('verification')) return 'verification';
  if (name.includes('brainstorm')) return 'brainstorm';
  if (p.includes('/plans/') || name.includes('plan')) return 'plan';
  return 'markdown';
}

function listMarkdownFiles(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) listMarkdownFiles(full, out);
    else if (entry.isFile() && /\.md$/i.test(entry.name)) out.push(full);
  }
  return out;
}

function resolveArtifactPath(root, state, value) {
  const rendered = String(value || '').replaceAll('{change}', state.change || '');
  if (!rendered) return '';
  return path.isAbsolute(rendered) ? rendered : path.join(root, rendered);
}

function artifactValues(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.flatMap((item) => artifactValues(item));
  if (typeof value === 'object') return artifactValues(value.path || value.file || value.outputPath || value.resolvedOutputPath || value.existingOutputPaths);
  return [value];
}

function pushArtifact(out, seen, root, base, file, stages, source) {
  if (!file || !/\.md$/i.test(file)) return;
  let stat;
  try {
    stat = fs.statSync(file);
  } catch {
    return;
  }
  if (!stat.isFile()) return;
  const rootAbs = path.resolve(root);
  const abs = path.resolve(file);
  if (abs !== rootAbs && !abs.startsWith(rootAbs + path.sep)) return;
  const key = process.platform === 'win32' ? abs.toLowerCase() : abs;
  if (seen.has(key)) return;
  seen.add(key);
  const local = base ? path.relative(base, abs) : rel(root, abs);
  out.push({
    path: rel(root, abs),
    title: artifactLabel(local),
    type: artifactType(local),
    stage: artifactStage(local, stages),
    size: stat.size,
    updatedAt: stat.mtime.toISOString(),
    source,
  });
}

function candidateArtifactDirs(root, state) {
  const change = state.change;
  const dirs = [
    state.__dir ? [state.__archived ? 'openspec-archive' : 'state-dir', state.__dir] : null,
    ['openspec', path.join(root, 'openspec', 'changes', change)],
    ['hikspine', path.join(root, '.hikspine', 'artifacts', change)],
    ['hikspine', path.join(root, '.hikspine', 'changes', change)],
    ['docs', path.join(root, 'docs', 'changes', change)],
    ['docs', path.join(root, 'docs', 'hikspine', change)],
  ];
  return dirs.filter(Boolean);
}

function changeArtifacts(root, state, stages) {
  const out = [];
  const seen = new Set();

  if (state.artifacts && typeof state.artifacts === 'object' && !Array.isArray(state.artifacts)) {
    for (const [name, value] of Object.entries(state.artifacts)) {
      for (const artifactValue of artifactValues(value)) {
        const file = resolveArtifactPath(root, state, artifactValue);
        pushArtifact(out, seen, root, path.dirname(file), file, stages, `state:${name}`);
      }
    }
  }

  for (const [source, dir] of candidateArtifactDirs(root, state)) {
    for (const file of listMarkdownFiles(dir)) pushArtifact(out, seen, root, dir, file, stages, source);
  }

  return out.sort((a, b) => {
    const sa = stages.indexOf(a.stage);
    const sb = stages.indexOf(b.stage);
    const ia = sa === -1 ? Number.MAX_SAFE_INTEGER : sa;
    const ib = sb === -1 ? Number.MAX_SAFE_INTEGER : sb;
    return ia - ib || a.stage.localeCompare(b.stage) || a.path.localeCompare(b.path);
  });
}

function workflowDetails(root, summary, opts = {}) {
  try {
    const workflow = loadWorkflow(root, summary.id, opts);
    return {
      ...summary,
      stages: workflow.states.map((state) => ({
        id: state.id,
        goal: state.goal || '',
        capabilities: (state.capabilities || []).map(normalizeCapability),
        rules: state.rules || [],
        needs: state.needs || [],
        requiresUser: !!state.requires_user,
        terminal: !!state.terminal,
        next: state.next || '',
      })),
    };
  } catch (err) {
    return { ...summary, error: err.message, stages: [] };
  }
}

// One change's status. Read-only: never auto-advances or mutates the change.
export function changeSummary(root, entryOrChange, active, opts = {}) {
  try {
    const entry = typeof entryOrChange === 'string' ? { change: entryOrChange } : entryOrChange;
    const state = entry.file ? loadStateEntry(root, entry) : loadState(root, entry.change);
    const workflow = loadWorkflow(root, state.workflow, { locale: state.workflowLocale || opts.locale });
    const sum = summarize(workflow, state);
    const stages = workflow.states.map((s) => s.id);
    const history = Array.isArray(state.history) ? state.history : [];
    const change = state.change || entry.change;
    return {
      change,
      workflow: state.workflow,
      workflowLocale: state.workflowLocale || workflow.__locale || '',
      active: change === active,
      archived: !!state.__archived,
      archivePath: state.__archivePath || '',
      current: sum.current,
      goal: sum.goal,
      nextAction: sum.nextAction,
      requiresUser: sum.requiresUser,
      needs: sum.needs,
      missing: sum.missing,
      complete: sum.complete,
      stages,
      stageIndex: stages.indexOf(sum.current),
      stageDurations: stageDurations(workflow, state),
      artifacts: changeArtifacts(root, state, stages),
      decisions: state.decisions || {},
      history,
      startedAt: history.length ? history[0].at : null,
      updatedAt: history.length ? history[history.length - 1].at : null,
    };
  } catch (err) {
    const change = typeof entryOrChange === 'string' ? entryOrChange : entryOrChange.change;
    return { change, active: change === active, error: err.message };
  }
}

export function listChangeSummaries(root, active = getActive(root), opts = {}) {
  return listStates(root).map((entry) => changeSummary(root, entry, active, opts));
}

// Build/packaging manifest the scaffold stage records at
// .hikspine/project-build.json: the component identifiers, SVN addresses, and
// project info the later SVN-build (hido) stage consumes. Read leniently so the
// board survives whatever exact shape the agent wrote (array, {components}, or a
// single component object).
function readProjectBuild(root) {
  const file = path.join(root, '.hikspine', 'project-build.json');
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
  let components = [];
  let project = {};
  if (Array.isArray(raw)) {
    components = raw;
  } else if (raw && typeof raw === 'object') {
    if (Array.isArray(raw.components)) {
      components = raw.components;
      if (raw.project && typeof raw.project === 'object' && !Array.isArray(raw.project)) {
        project = raw.project;
      } else {
        project = { ...raw };
        delete project.components;
      }
    } else if (raw.component || raw.componentId || raw.svn || raw.svnUrl) {
      components = [raw];
    } else {
      project = { ...raw };
    }
  }
  return { path: rel(root, file), project, components: components.filter((c) => c && typeof c === 'object') };
}

export function boardState(root, opts = {}) {
  const active = getActive(root);
  const workflows = listWorkflows(root, opts);
  return {
    mode: 'project',
    root,
    active,
    changes: listChangeSummaries(root, active, opts),
    workflows: workflows.map((workflow) => workflowDetails(root, workflow, opts)),
    skills: discoverSkills(root),
    notifications: readNotifications(root),
    projectBuild: readProjectBuild(root),
  };
}

function projectCounts(changes) {
  const counts = { total: changes.length, work: 0, confirm: 0, done: 0, error: 0 };
  for (const change of changes) {
    if (change.error) counts.error += 1;
    else if (change.complete || change.archived) counts.done += 1;
    else if (change.nextAction === 'confirm') counts.confirm += 1;
    else counts.work += 1;
  }
  return counts;
}

function isActiveOverviewChange(change) {
  return change.error || !(change.complete || change.archived);
}

export function allProjectsBoardState(opts = {}) {
  const projects = readRegisteredProjects();
  const outProjects = [];
  const changes = [];
  const notifications = [];

  for (const project of projects) {
    if (project.missing) {
      outProjects.push({ ...project, counts: { total: 0, work: 0, confirm: 0, done: 0, error: 1 }, error: 'Project root is missing.' });
      continue;
    }
    try {
      // Overview only needs each project's changes + notifications. Do NOT call
      // the full boardState() here: it runs discoverSkills() (a recursive
      // ~/.claude/plugins/marketplaces walk) and workflowDetails() per project,
      // both of which the overview discards — that repeated deep scan is what
      // made the global board take ~10s. Compute just the light parts instead.
      const active = getActive(project.root);
      const state = {
        active,
        changes: listChangeSummaries(project.root, active, opts),
        notifications: readNotifications(project.root),
      };
      const projectChanges = (state.changes || []).map((change) => ({
        ...change,
        projectId: project.id,
        projectName: project.name,
        projectRoot: project.root,
        active: change.change === state.active,
        artifacts: (change.artifacts || []).map((artifact) => ({ ...artifact, projectId: project.id })),
      }));
      changes.push(...projectChanges.filter(isActiveOverviewChange));
      notifications.push(...(state.notifications || []).map((notification) => ({
        ...notification,
        id: `${project.id}:${notification.id}`,
        localId: notification.id,
        projectId: project.id,
        projectName: project.name,
        projectRoot: project.root,
      })));
      outProjects.push({
        ...project,
        active: state.active,
        counts: projectCounts(projectChanges),
        updatedAt: projectChanges.map((c) => c.updatedAt).filter(Boolean).sort().at(-1) || project.lastSeenAt,
      });
    } catch (err) {
      outProjects.push({ ...project, counts: { total: 0, work: 0, confirm: 0, done: 0, error: 1 }, error: err.message });
    }
  }

  changes.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
  notifications.sort((a, b) => new Date(a.at || 0).getTime() - new Date(b.at || 0).getTime());
  return {
    mode: 'all',
    root: '',
    registryFile: projectRegistryFile(),
    active: null,
    projects: outProjects,
    changes,
    workflows: [],
    skills: [],
    notifications,
    projectBuild: null,
  };
}
