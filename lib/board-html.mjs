// The orchestration board: a single self-contained page (vanilla JS, no build
// step). It polls /api/state and renders concurrent changes, lets the user
// launch a new run on any workflow, and switch the active run.

export const BOARD_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Hikspine Board</title>
<style>
  :root {
    --bg: #0f1115; --panel: #171a21; --panel2: #1d212b; --line: #2a2f3a;
    --text: #e6e9ef; --muted: #9aa3b2; --accent: #6ea8fe;
    --work: #3fb950; --confirm: #d29922; --done: #6e7681; --err: #f85149;
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--text);
    font: 14px/1.5 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; }
  header { padding: 16px 22px; border-bottom: 1px solid var(--line);
    display: flex; align-items: baseline; gap: 14px; }
  header h1 { font-size: 16px; margin: 0; letter-spacing: .3px; }
  header .root { color: var(--muted); font-size: 12px; font-family: ui-monospace, monospace; }
  header .active { margin-left: auto; color: var(--muted); font-size: 12px; }
  header .active b { color: var(--accent); }
  main { padding: 22px; display: grid; gap: 22px; max-width: 1100px; }
  h2 { font-size: 12px; text-transform: uppercase; letter-spacing: 1px;
    color: var(--muted); margin: 0 0 10px; font-weight: 600; }
  .cards { display: grid; gap: 12px; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); }
  .card { background: var(--panel); border: 1px solid var(--line); border-radius: 10px;
    padding: 14px; cursor: pointer; transition: border-color .15s; }
  .card:hover { border-color: var(--accent); }
  .card.active { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent); }
  .card .top { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
  .card .name { font-weight: 600; }
  .card .wf { color: var(--muted); font-size: 12px; font-family: ui-monospace, monospace; }
  .card .row { color: var(--muted); font-size: 12px; margin-top: 4px; }
  .card .row b { color: var(--text); font-weight: 500; }
  .badge { font-size: 11px; padding: 2px 8px; border-radius: 999px; font-weight: 600;
    text-transform: uppercase; letter-spacing: .5px; margin-left: auto; }
  .badge.work { background: rgba(63,185,80,.15); color: var(--work); }
  .badge.confirm { background: rgba(210,153,34,.15); color: var(--confirm); }
  .badge.done { background: rgba(110,118,134,.18); color: var(--done); }
  .badge.error { background: rgba(248,81,73,.15); color: var(--err); }
  .launch { background: var(--panel); border: 1px solid var(--line); border-radius: 10px;
    padding: 14px; display: flex; gap: 10px; flex-wrap: wrap; align-items: center; }
  .launch select, .launch input, .launch button { font: inherit; color: var(--text);
    background: var(--panel2); border: 1px solid var(--line); border-radius: 7px; padding: 8px 10px; }
  .launch input { min-width: 200px; }
  .launch button { background: var(--accent); color: #0b0d12; border: none; font-weight: 600; cursor: pointer; }
  .launch button:hover { filter: brightness(1.08); }
  .launch .hint { color: var(--muted); font-size: 12px; flex-basis: 100%; }
  .skills { display: flex; flex-wrap: wrap; gap: 6px; }
  .chip { font-size: 12px; background: var(--panel2); border: 1px solid var(--line);
    border-radius: 6px; padding: 3px 8px; color: var(--muted); }
  .chip .src { color: var(--accent); opacity: .8; font-size: 10px; }
  .empty { color: var(--muted); font-style: italic; }
  #msg { color: var(--err); font-size: 12px; min-height: 16px; }
</style>
</head>
<body>
<header>
  <h1>Hikspine Board</h1>
  <a href="/editor" style="color:#6ea8fe;text-decoration:none;font-size:13px">✎ Workflow editor</a>
  <span class="root" id="root"></span>
  <span class="active">active: <b id="active">—</b></span>
</header>
<main>
  <section>
    <h2>Changes <span class="empty" id="changes-empty" hidden>none yet</span></h2>
    <div class="cards" id="changes"></div>
  </section>
  <section>
    <h2>Start a run</h2>
    <div class="launch">
      <select id="wf"></select>
      <input id="change" placeholder="change-name (kebab-case)" />
      <button id="launch">Start</button>
      <div id="msg"></div>
      <div class="hint" id="wf-intent"></div>
    </div>
  </section>
  <section>
    <h2>Skills <span class="empty" id="skills-count"></span></h2>
    <div class="skills" id="skills"></div>
  </section>
</main>
<script>
const $ = (id) => document.getElementById(id);
const api = (p, opts) => fetch(p, opts).then(r => r.json());

function badge(c) {
  if (c.error) return '<span class="badge error">error</span>';
  if (c.complete) return '<span class="badge done">done</span>';
  return '<span class="badge ' + c.nextAction + '">' + c.nextAction + '</span>';
}

function renderChanges(changes, active) {
  const el = $('changes');
  $('changes-empty').hidden = changes.length > 0;
  el.innerHTML = changes.map(c => {
    const cls = 'card' + (c.change === active ? ' active' : '');
    if (c.error) {
      return '<div class="' + cls + '" data-change="' + c.change + '"><div class="top">' +
        '<span class="name">' + c.change + '</span>' + badge(c) + '</div>' +
        '<div class="row">' + c.error + '</div></div>';
    }
    const missing = (c.missing && c.missing.length) ? c.missing.join(', ') : '—';
    return '<div class="' + cls + '" data-change="' + c.change + '">' +
      '<div class="top"><span class="name">' + c.change + '</span>' + badge(c) + '</div>' +
      '<div class="row"><span class="wf">' + c.workflow + '</span> · state <b>' + c.current + '</b></div>' +
      '<div class="row">needs: ' + missing + '</div></div>';
  }).join('');
  el.querySelectorAll('.card').forEach(card => {
    card.onclick = async () => {
      await api('/api/active', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ change: card.dataset.change }) });
      refresh();
    };
  });
}

function renderWorkflows(workflows) {
  const sel = $('wf');
  const prev = sel.value;
  sel.innerHTML = workflows.map(w => '<option value="' + w.id + '">' + w.id + '</option>').join('');
  if (workflows.some(w => w.id === prev)) sel.value = prev;
  const showIntent = () => {
    const w = workflows.find(x => x.id === sel.value);
    $('wf-intent').textContent = w ? w.intent : '';
  };
  sel.onchange = showIntent; showIntent();
}

function renderSkills(skills) {
  $('skills-count').textContent = skills.length + ' discoverable';
  $('skills').innerHTML = skills.map(s =>
    '<span class="chip" title="' + (s.description || '').replace(/"/g, '&quot;') + '">' +
    s.name + ' <span class="src">' + s.source + '</span></span>').join('');
}

async function refresh() {
  const s = await api('/api/state');
  $('root').textContent = s.root;
  $('active').textContent = s.active || '—';
  renderChanges(s.changes, s.active);
  renderWorkflows(s.workflows);
  renderSkills(s.skills);
}

$('launch').onclick = async () => {
  $('msg').textContent = '';
  const change = $('change').value.trim();
  const workflow = $('wf').value;
  if (!change) { $('msg').textContent = 'Enter a change name.'; return; }
  const r = await api('/api/launch', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ change, workflow }) });
  if (r.error) { $('msg').textContent = r.error; return; }
  $('change').value = '';
  refresh();
};

refresh();
setInterval(refresh, 3000);
</script>
</body>
</html>`;
