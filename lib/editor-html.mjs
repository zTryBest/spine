// Workflow editor: a single self-contained page (vanilla JS, no build step).
// It edits the same state-machine schema the engine reads — states, their
// capabilities (real skill names), needs, rules, and next/fail edges — with a
// live diagram and live validation via the engine's lintWorkflow, then saves
// to .hikspine/workflows/<id>.yaml.

export const EDITOR_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Hikspine Workflow Editor</title>
<style>
  :root {
    --bg:#0f1115; --panel:#171a21; --panel2:#1d212b; --line:#2a2f3a;
    --text:#e6e9ef; --muted:#9aa3b2; --accent:#6ea8fe; --ok:#3fb950; --err:#f85149;
  }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--bg); color:var(--text);
    font:14px/1.5 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; }
  a { color:var(--accent); text-decoration:none; }
  header { padding:12px 18px; border-bottom:1px solid var(--line); display:flex;
    gap:10px; align-items:center; flex-wrap:wrap; }
  header h1 { font-size:15px; margin:0 12px 0 0; }
  input, select, textarea, button { font:inherit; color:var(--text); background:var(--panel2);
    border:1px solid var(--line); border-radius:6px; padding:6px 8px; }
  textarea { width:100%; resize:vertical; min-height:46px; font-family:ui-monospace, monospace; font-size:12px; }
  button { cursor:pointer; }
  button.primary { background:var(--accent); color:#0b0d12; border:none; font-weight:600; }
  button.ghost { background:var(--panel2); }
  .grid { display:grid; grid-template-columns:1fr 420px; gap:0; height:calc(100vh - 53px); }
  .left { overflow:auto; padding:16px; }
  .right { border-left:1px solid var(--line); overflow:auto; padding:16px; background:var(--panel); }
  .meta { display:grid; grid-template-columns:auto 1fr; gap:8px 10px; align-items:center;
    background:var(--panel); border:1px solid var(--line); border-radius:10px; padding:12px; margin-bottom:14px; }
  .meta label { color:var(--muted); font-size:12px; }
  .state { background:var(--panel); border:1px solid var(--line); border-radius:10px; padding:12px; margin-bottom:12px; }
  .state .hd { display:flex; gap:8px; align-items:center; margin-bottom:8px; }
  .state .hd input { font-weight:600; }
  .state .hd .sp { margin-left:auto; }
  .field { display:grid; grid-template-columns:110px 1fr; gap:6px 10px; align-items:start; margin-top:8px; }
  .field > label { color:var(--muted); font-size:12px; padding-top:6px; }
  .row { display:flex; gap:12px; align-items:center; flex-wrap:wrap; }
  .row label { color:var(--muted); font-size:12px; display:flex; gap:5px; align-items:center; }
  .chips { display:flex; flex-wrap:wrap; gap:5px; align-items:center; }
  .chip { background:var(--panel2); border:1px solid var(--line); border-radius:6px; padding:2px 6px; font-size:12px; display:flex; gap:5px; align-items:center; }
  .chip b { color:var(--accent); font-weight:500; }
  .chip x { cursor:pointer; color:var(--muted); }
  .chip x:hover { color:var(--err); }
  .addcap { display:flex; gap:6px; }
  h2 { font-size:12px; text-transform:uppercase; letter-spacing:1px; color:var(--muted); margin:0 0 10px; }
  #status { font-size:12px; margin-left:auto; }
  #status.ok { color:var(--ok); } #status.err { color:var(--err); }
  #issues { list-style:none; padding:0; margin:0 0 14px; }
  #issues li { color:var(--err); font-size:12px; padding:4px 0; border-bottom:1px solid var(--line); }
  #issues li.ok { color:var(--ok); }
  svg { width:100%; background:var(--bg); border:1px solid var(--line); border-radius:10px; }
  .node rect { fill:var(--panel2); stroke:var(--line); }
  .node.start rect { stroke:var(--accent); }
  .node text { fill:var(--text); font-size:12px; }
  .node .sub { fill:var(--muted); font-size:10px; }
  .edge { stroke:var(--muted); fill:none; }
  .edge.fail { stroke:var(--err); stroke-dasharray:4 3; }
</style>
</head>
<body>
<header>
  <h1>Workflow Editor</h1>
  <a href="/">← Board</a>
  <select id="load" title="Load a workflow"></select>
  <button class="ghost" id="new">New</button>
  <button class="ghost" id="addState">+ State</button>
  <button class="primary" id="save">Save</button>
  <span id="status"></span>
</header>
<div class="grid">
  <div class="left">
    <div class="meta">
      <label>id</label><input id="wid" placeholder="my-workflow" />
      <label>name</label><input id="wname" placeholder="My Workflow" />
      <label>intent</label><input id="wintent" placeholder="When should the agent pick this workflow?" />
      <label>start</label><select id="start"></select>
    </div>
    <div id="states"></div>
  </div>
  <div class="right">
    <h2>Validation</h2>
    <ul id="issues"></ul>
    <h2>Diagram</h2>
    <div id="graph"></div>
  </div>
</div>
<datalist id="skills-dl"></datalist>
<script>
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
let wf = blank();
let skills = [];

function blank() { return { id:'', version:1, name:'', intent:'', start:'', states:[] }; }
function normState(s) {
  return {
    id:s.id||'', goal:s.goal||'',
    forbid:Array.isArray(s.forbid)?s.forbid:(s.forbid?[s.forbid]:[]),
    requires_user:!!s.requires_user,
    capabilities:Array.isArray(s.capabilities)?s.capabilities:[],
    needs:Array.isArray(s.needs)?s.needs:[],
    rules:Array.isArray(s.rules)?s.rules:[],
    next:s.next||'', fail_when:s.fail_when||'', fail_to:s.fail_to||'', fail_reason:s.fail_reason||'',
    terminal:!!s.terminal,
  };
}
function norm(def) {
  return { id:def.id||'', version:def.version||1, name:def.name||'', intent:def.intent||'',
    start:def.start||'', states:(def.states||[]).map(normState) };
}

async function init() {
  const st = await fetch('/api/state').then(r=>r.json());
  skills = st.skills.map(s=>s.name);
  $('skills-dl').innerHTML = skills.map(n=>'<option value="'+esc(n)+'">').join('');
  $('load').innerHTML = '<option value="">— load —</option>' + st.workflows.map(w=>'<option value="'+esc(w.id)+'">'+esc(w.id)+' ['+w.source+']</option>').join('');
  renderAll();
}

function ids() { return wf.states.map(s=>s.id).filter(Boolean); }
function options(sel, list, value, blankLabel) {
  sel.innerHTML = (blankLabel?'<option value="">'+blankLabel+'</option>':'') + list.map(id=>'<option value="'+esc(id)+'">'+esc(id)+'</option>').join('');
  sel.value = list.includes(value) ? value : '';
}

function chip(text, onRemove) {
  const c = document.createElement('span'); c.className = 'chip';
  c.innerHTML = '<b>'+esc(text)+'</b><x>✕</x>';
  c.querySelector('x').onclick = onRemove;
  return c;
}

function renderState(s, i) {
  const card = document.createElement('div'); card.className = 'state';
  card.innerHTML = \`
    <div class="hd">
      <input class="sid" value="\${esc(s.id)}" placeholder="state-id" />
      <span class="sp"></span>
      <label><input type="checkbox" class="sterm" \${s.terminal?'checked':''}/> terminal</label>
      <button class="ghost srm">Remove</button>
    </div>
    <div class="field"><label>goal</label><input class="sgoal" value="\${esc(s.goal)}" /></div>
    <div class="field"><label>flags</label><div class="row">
      <label><input type="checkbox" class="suser" \${s.requires_user?'checked':''}/> requires_user</label>
      <label><input type="checkbox" class="sforbid" \${s.forbid.includes('write-source')?'checked':''}/> forbid write-source</label>
    </div></div>
    <div class="field"><label>capabilities</label><div>
      <div class="chips caps"></div>
      <div class="addcap"><input class="capin" list="skills-dl" placeholder="skill name…" /><button class="ghost capadd">Add</button></div>
    </div></div>
    <div class="field"><label>needs</label><textarea class="sneeds" placeholder="one decision key per line">\${esc(s.needs.join('\\n'))}</textarea></div>
    <div class="field"><label>rules</label><textarea class="srules" placeholder="one rule per line">\${esc(s.rules.join('\\n'))}</textarea></div>
    <div class="field"><label>next</label><select class="snext"></select></div>
    <div class="field"><label>fail → to</label><div class="row">
      <input class="sfw" value="\${esc(s.fail_when)}" placeholder="key=value" style="width:140px" />
      <select class="sfto"></select>
      <input class="sfr" value="\${esc(s.fail_reason)}" placeholder="reason" style="flex:1" />
    </div></div>\`;

  const q = (c) => card.querySelector(c);
  q('.sid').oninput = e => { s.id = e.target.value.trim(); refreshSelectors(); derived(); };
  q('.sgoal').oninput = e => { s.goal = e.target.value; derived(); };
  q('.sterm').onchange = e => { s.terminal = e.target.checked; derived(); };
  q('.suser').onchange = e => { s.requires_user = e.target.checked; derived(); };
  q('.sforbid').onchange = e => { s.forbid = e.target.checked ? ['write-source'] : []; derived(); };
  q('.sneeds').oninput = e => { s.needs = lines(e.target.value); derived(); };
  q('.srules').oninput = e => { s.rules = lines(e.target.value); derived(); };
  q('.snext').onchange = e => { s.next = e.target.value; derived(); };
  q('.sfto').onchange = e => { s.fail_to = e.target.value; derived(); };
  q('.sfw').oninput = e => { s.fail_when = e.target.value.trim(); derived(); };
  q('.sfr').oninput = e => { s.fail_reason = e.target.value; derived(); };
  q('.srm').onclick = () => { wf.states.splice(i,1); renderStates(); refreshSelectors(); derived(); };

  const caps = q('.caps');
  const drawCaps = () => { caps.innerHTML=''; s.capabilities.forEach((c,ci)=>caps.appendChild(chip(c, ()=>{ s.capabilities.splice(ci,1); drawCaps(); derived(); }))); };
  drawCaps();
  const addCap = () => { const v = q('.capin').value.trim(); if (v && !s.capabilities.includes(v)) { s.capabilities.push(v); q('.capin').value=''; drawCaps(); derived(); } };
  q('.capadd').onclick = addCap;
  q('.capin').onkeydown = e => { if (e.key==='Enter') { e.preventDefault(); addCap(); } };

  card._next = q('.snext'); card._fto = q('.sfto');
  return card;
}

function lines(v) { return v.split('\\n').map(x=>x.trim()).filter(Boolean); }

let cards = [];
function renderStates() {
  const host = $('states'); host.innerHTML=''; cards=[];
  wf.states.forEach((s,i)=>{ const c = renderState(s,i); cards.push(c); host.appendChild(c); });
  refreshSelectors();
}
function refreshSelectors() {
  const list = ids();
  options($('start'), list, wf.start, '— start —');
  cards.forEach((c,i)=>{ const s = wf.states[i];
    options(c._next, list, s.next, '— next —');
    options(c._fto, list, s.fail_to, '— none —');
  });
}

function renderMeta() {
  $('wid').value = wf.id; $('wname').value = wf.name; $('wintent').value = wf.intent;
}
function renderAll() { renderMeta(); renderStates(); derived(); }

$('wid').oninput = e => { wf.id = e.target.value.trim(); };
$('wname').oninput = e => { wf.name = e.target.value; };
$('wintent').oninput = e => { wf.intent = e.target.value; };
$('start').onchange = e => { wf.start = e.target.value; };
$('new').onclick = () => { wf = blank(); $('load').value=''; renderAll(); };
$('addState').onclick = () => { wf.states.push(normState({ id:'state-'+(wf.states.length+1) })); renderStates(); refreshSelectors(); derived(); };
$('load').onchange = async e => {
  const id = e.target.value; if (!id) return;
  const r = await fetch('/api/workflow?id='+encodeURIComponent(id)).then(r=>r.json());
  wf = r.workflow ? norm(r.workflow) : blank();
  renderAll();
};
$('save').onclick = async () => {
  const r = await fetch('/api/workflow/save', { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({ workflow:wf }) }).then(r=>r.json());
  if (r.ok) { setStatus('saved → '+r.file, true); init(); }
  else { setStatus('not saved', false); showIssues(r.issues); }
};

function setStatus(msg, ok) { const el=$('status'); el.textContent=msg; el.className = ok?'ok':'err'; }

let t;
function derived() { drawGraph(); clearTimeout(t); t = setTimeout(validate, 300); }
async function validate() {
  const r = await fetch('/api/workflow/validate', { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({ workflow:wf }) }).then(r=>r.json());
  showIssues(r.issues, r.ok);
}
function showIssues(issues, ok) {
  const ul = $('issues');
  if (ok || !issues || issues.length===0) { ul.innerHTML = '<li class="ok">✓ valid</li>'; return; }
  ul.innerHTML = issues.map(m=>'<li>'+esc(m)+'</li>').join('');
}

function drawGraph() {
  const sts = wf.states; const W=380, rowH=64, boxW=210, boxH=40, x=(W-boxW)/2;
  const idset = new Set(ids());
  const pos = {}; sts.forEach((s,i)=>{ pos[s.id] = { x, y: 16 + i*rowH }; });
  const H = Math.max(80, 16 + sts.length*rowH);
  let edges='';
  const arrow = (from,to,cls) => {
    const a=pos[from], b=pos[to]; if(!a||!b) return '';
    const x1=a.x+boxW/2, y1=a.y+boxH, x2=b.x+boxW/2, y2=b.y;
    return '<path class="edge '+cls+'" marker-end="url(#ar'+(cls||'n')+')" d="M'+x1+' '+y1+' C '+x1+' '+(y1+24)+' '+x2+' '+(y2-24)+' '+x2+' '+y2+'"/>';
  };
  sts.forEach(s=>{ if(s.next && idset.has(s.next)) edges+=arrow(s.id,s.next,''); if(s.fail_to && idset.has(s.fail_to)) edges+=arrow(s.id,s.fail_to,'fail'); });
  let nodes='';
  sts.forEach(s=>{ const p=pos[s.id]; if(!p) return;
    const cls='node'+(s.id===wf.start?' start':'');
    const sub=[s.terminal?'terminal':'', s.requires_user?'confirm':''].filter(Boolean).join(' · ');
    nodes+='<g class="'+cls+'"><rect x="'+p.x+'" y="'+p.y+'" width="'+boxW+'" height="'+boxH+'" rx="8"/>'+
      '<text x="'+(p.x+10)+'" y="'+(p.y+18)+'">'+esc(s.id||'?')+'</text>'+
      '<text class="sub" x="'+(p.x+10)+'" y="'+(p.y+32)+'">'+esc(sub||(s.capabilities.length+' skills'))+'</text></g>';
  });
  $('graph').innerHTML = '<svg viewBox="0 0 '+W+' '+H+'" height="'+H+'">'+
    '<defs>'+
    '<marker id="arn" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0 0 L6 3 L0 6 z" fill="#9aa3b2"/></marker>'+
    '<marker id="arfail" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0 0 L6 3 L0 6 z" fill="#f85149"/></marker>'+
    '</defs>'+edges+nodes+'</svg>';
}

init();
</script>
</body>
</html>`;
