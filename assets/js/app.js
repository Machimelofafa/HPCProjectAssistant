(function(){
'use strict';

const SCHEMA_VERSION = '1.0.0';

/**
 * =============================================================================
 * Main application module.
 * This is an IIFE (Immediately Invoked Function Expression) to encapsulate the
 * application logic and avoid polluting the global scope.
 * =============================================================================
 */

let ZTL; // Zoom/pan helper for the timeline
let cpmWorker;
let cpmRequestActive = false;
let lastCPMResult = null;
let graphInitialized = false;

function createCPMWorker(){
  const isFile = location.protocol === 'file:';
  if(!isFile){
    return new Worker('assets/js/cpm-worker.js');
  }
  const workerSource = `
'use strict';

// All functions for the worker will be placed here.
// This is a self-contained script that will run in a separate thread.

// --- UTILITIES (copied from main script) ---
function parseDate(s){ const [d,m,y] = s.split('-'); return new Date(\`\${y}-\${m}-\${d}T00:00:00\`); }
function fmtDate(d){ return [d.getDate().toString().padStart(2,'0'), (d.getMonth()+1).toString().padStart(2,'0'), d.getFullYear()].join('-'); }
function addDays(date, n){ const d=new Date(date); d.setDate(d.getDate()+n); return d; }
function isWeekend(d){ const x=d.getDay(); return x===0||x===6; }
function daysBetween(a,b){ return Math.round((b-a)/86400000); }

// --- PARSERS & VALIDATORS ---
function parseDurationStrict(v){
  if(typeof v==='number'){
    if(!Number.isInteger(v) || v<0) return {error:'Duration must be a non\u2011negative integer (days).'};
    return {days:v};
  }
  const s=String(v||'').trim();
  if(s==='') return {error:'Duration is required.'};
  const m=s.match(/^(\\d+)\\s*([dw])?$/i);
  if(!m) return {error:'Use number of days or Nd/Nw (e.g., 10 or 3w).'};
  const n=parseInt(m[1],10); const u=(m[2]||'d').toLowerCase();
  if(n<0) return {error:'Duration cannot be negative.'};
  const days = u==='w'? n*5 : n;
  return {days};
}

// --- CALENDAR LOGIC ---
function makeCalendar(mode, holidaysSet){
  const isHoliday = d=> holidaysSet.has(fmtDate(d));
  function isWorkday(d){ return mode==='calendar'? true : (!isWeekend(d) && !isHoliday(d)); }
  function addBusinessDays(start, n){ let d=new Date(start); let step=n>=0?1:-1; let count=0; while(count!==n){ d.setDate(d.getDate()+step); if(isWorkday(d)) count+=step; } return d; }
  function diffBusinessDays(start, end){ let d=new Date(start); let n=0; const step=start<end?1:-1; while((step>0? d<end : d>end)){ d.setDate(d.getDate()+step); if(isWorkday(d)) n+=step; } return n; }
  return {
    mode,
    isWorkday,
    add:(start,n)=> mode==='calendar'? addDays(start,n): addBusinessDays(start,n),
    diff:(start,end)=> mode==='calendar'? daysBetween(start,end): diffBusinessDays(start,end)
  };
}

// --- DEPENDENCY PARSER ---
function parseDepToken(token){
  const s=String(token||'').trim(); if(!s) return null;
  let type='FS'; let rest=s; const colon=s.indexOf(':');
  if(colon>0){ const t=s.slice(0,colon).toUpperCase(); if(['FS','SS','FF','SF'].includes(t)){ type=t; rest=s.slice(colon+1); } }
  let pred=rest; let lag=0;
  const m = rest.match(/^(.*?)([+-])(\\d+)([dw])?$/i);
  if(m){ pred=m[1]; const sign=m[2]==='-'?-1:1; const n=parseInt(m[3],10); const u=(m[4]||'d').toLowerCase(); lag = sign * (u==='w'? n*5 : n); }
  pred=pred.trim();
  return {type, pred, lag};
}
function stringifyDep(e){ const lagStr = e.lag? ((e.lag>0?'+':'')+Math.round(e.lag)+'d') : ''; return (e.type==='FS' && !lagStr? e.pred : \`\${e.type}:\${e.pred}\${lagStr}\`); }
function normalizeDeps(task){ const raw=task.deps||[]; const arr=[]; for(const tok of raw){ const p=parseDepToken(tok); if(!p) continue; arr.push(p); } return arr; }

// --- GRAPH & DEPENDENCY HELPERS ---
function findCycles(tasks){
  const id2=Object.fromEntries(tasks.map(t=>[t.id,t]));
  const deps=Object.fromEntries(tasks.map(t=>[t.id, normalizeDeps(t).map(x=>x.pred).filter(x=>id2[x]) ]));
  const color={}; const stack=[]; const cycles=[];
  function dfs(u){ color[u]=1; stack.push(u); for(const v of (deps[u]||[])){ if(color[v]==null){ dfs(v); } else if(color[v]===1){ const idx=stack.indexOf(v); cycles.push(stack.slice(idx).concat(v)); } } stack.pop(); color[u]=2; }
  for(const t of tasks){ if(color[t.id]==null) dfs(t.id); }
  return cycles;
}

// --- CRITICAL PATH METHOD (CPM) ENGINE ---
function computeCPM(project){
  const cal = makeCalendar(project.calendar, new Set(project.holidays||[]));
  const active = project.tasks.filter(t=>t.active!==false);
  const id2 = Object.fromEntries(active.map(t=>[t.id,t]));

  const predMap = new Map(active.map(t=>[t.id, normalizeDeps(t).filter(e=>id2[e.pred]) ]));
  const succMap = new Map(active.map(t=>[t.id, []]));
  for(const [sid,edges] of predMap){ for(const e of edges){ if(!succMap.has(e.pred)) succMap.set(e.pred,[]); succMap.get(e.pred).push({to:sid, type:e.type, lag:e.lag}); } }

  const indeg = new Map(active.map(t=>[t.id,0]));
  for(const [sid,edges] of predMap){ for(const e of edges){ indeg.set(sid, (indeg.get(sid)||0)+1); } }
  const q=[]; for(const t of active){ if((indeg.get(t.id)||0)===0) q.push(t.id); }
  const order=[]; while(q.length){ const u=q.shift(); order.push(u); for(const arc of (succMap.get(u)||[])){ const v=arc.to; indeg.set(v, (indeg.get(v)||0)-1); if(indeg.get(v)===0) q.push(v); } }

  const usable=active.filter(t=>order.includes(t.id));

  const ES={}, EF={}; const warnings=[];
  for(const id of order){ const t=id2[id]; if(!t) continue; const dur = parseDurationStrict(t.duration).days||0; let baseES=0; for(const e of (predMap.get(id)||[])){
      const p=e.pred; const type=e.type; const lag=e.lag|0; const esP = ES[p]||0; const efP = EF[p]||0;
      if(type==='FS') baseES=Math.max(baseES, efP + lag);
      else if(type==='SS') baseES=Math.max(baseES, esP + lag);
      else if(type==='FF') baseES=Math.max(baseES, efP + lag - dur);
      else if(type==='SF') baseES=Math.max(baseES, esP + lag - dur);
  }
  const sc = t.startConstraint || (t.fixedStart!=null ? {type:'SNET', day:t.fixedStart|0} : null);
  if(sc){ if(sc.type==='SNET') baseES = Math.max(baseES, sc.day|0); else if(sc.type==='MSO'){ if(baseES > (sc.day|0)) warnings.push({sev:'error', msg:\`MSO violated for \${t.name}: deps force start \${baseES} > \${sc.day}\`, taskId:t.id}); baseES = Math.max(baseES, sc.day|0); } }
  ES[id]=baseES; EF[id]=baseES + dur; }
  const projectFinish = Math.max(0, ...order.map(id=>EF[id]||0));

  const LF={}, LS={};
  const orderRev = order.slice().reverse();
  for(const id of orderRev){ const t=id2[id]; if(!t) continue; const dur=parseDurationStrict(t.duration).days||0; let baseLF = projectFinish; const succs = succMap.get(id)||[]; if(succs.length===0){ baseLF = projectFinish; }
    for(const arc of succs){ const s=arc.to; const type=arc.type; const lag=arc.lag|0; const lsS = LS[s]; const lfS = LF[s]; if(lsS==null || lfS==null) continue;
      if(type==='FS') baseLF = Math.min(baseLF, lsS - lag);
      else if(type==='SS') baseLF = Math.min(baseLF, (LS[id]==null? (lsS - lag) + dur : Math.min(LF[id]||Infinity, (lsS - lag) + dur) ));
      else if(type==='FF') baseLF = Math.min(baseLF, lfS - lag);
      else if(type==='SF') baseLF = Math.min(baseLF, (lfS - lag));
    }
    LF[id] = baseLF; LS[id] = baseLF - dur; }

  const out = usable.map(t=>({ ...t,
    es:ES[t.id]||0, ef:EF[t.id]||parseDurationStrict(t.duration).days||0,
    ls:LS[t.id]||0, lf:LF[t.id]||parseDurationStrict(t.duration).days||0,
    slack: (LS[t.id]??0)-(ES[t.id]??0),
    start: cal.add(parseDate(project.startDate), ES[t.id]||0),
    finish: cal.add(parseDate(project.startDate), EF[t.id]||0),
    critical: (LS[t.id]??0)===(ES[t.id]??0)
  }));

  return {order, tasks: out, finishDays: projectFinish, warnings};
}

// --- Worker message handler ---
self.onmessage = function(e) {
  if (e.data && e.data.type === 'compute') {
    const project = e.data.project;
    const cpmResult = computeCPM(project);
    // Post the result back to the main thread
    self.postMessage({ type: 'result', cpm: cpmResult });
  }
};
`;
  const blob = new Blob([workerSource], { type: 'application/javascript' });
  const url = URL.createObjectURL(blob);
  return new Worker(url);
}


// ----------------------------[ UTILITIES ]----------------------------
// A collection of small, reusable utility functions.
// ---------------------------------------------------------------------
const $ = (q,el=document)=>el.querySelector(q); const $$=(q,el=document)=>Array.from(el.querySelectorAll(q));
const todayStr = ()=> { const d = new Date(); return [d.getDate().toString().padStart(2,'0'), (d.getMonth()+1).toString().padStart(2,'0'), d.getFullYear()].join('-'); };
function parseDate(s){ const [d,m,y] = s.split('-'); return new Date(`${y}-${m}-${d}T00:00:00`); }
function fmtDate(d){ return [d.getDate().toString().padStart(2,'0'), (d.getMonth()+1).toString().padStart(2,'0'), d.getFullYear()].join('-'); }
function yyyymmdd_to_ddmmyyyy(s) { if (!s) return ''; const [y,m,d] = s.split('-'); return `${d}-${m}-${y}`; }
function ddmmyyyy_to_yyyymmdd(s) { if (!s) return ''; const [d,m,y] = s.split('-'); return `${y}-${m}-${d}`; }
function addDays(date, n){ const d=new Date(date); d.setDate(d.getDate()+n); return d; }
function isWeekend(d){ const x=d.getDay(); return x===0||x===6; }
function daysBetween(a,b){ return Math.round((b-a)/86400000); }
function esc(s){
  return String(s ?? '').replace(/['"&<>]/g, c => ({
    "'": '&#39;',
    '"': '&quot;',
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;'
  }[c]));
}
function uid(prefix='t'){ return prefix+'_'+Math.random().toString(36).slice(2,8); }
function slug(s){ return String(s||'').toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_|_$/g,''); }
function clone(o){ return JSON.parse(JSON.stringify(o)); }
function deepFreeze(o){ if(o&&typeof o==='object'&&!Object.isFrozen(o)){ Object.freeze(o); for(const k of Object.keys(o)){ deepFreeze(o[k]); } } return o; }
function debounce(fn, delay) { let timeoutId; return function(...args) { clearTimeout(timeoutId); timeoutId = setTimeout(() => fn.apply(this, args), delay); }; }
window.debounce=debounce;

// ----------------------------[ SETTINGS STORE ]----------------------------
const UI_FLAGS = { topSettingsToolbar: true };
window.ui = UI_FLAGS;

const SettingsStore = (function(){
  const state = {
    calendar: { startDate: todayStr(), mode: 'workdays', holidays: [] },
    slackThreshold: 2,
    filters: { text: '', groupBy: 'none' },
    subsystemLegend: {},
    legend: true,
    templates: {},
    validation: {},
    selection: []
  };
  try {
    const saved = JSON.parse(localStorage.getItem('hpc-settings') || '{}');
    Object.assign(state, saved);
    if(saved.calendar) state.calendar = Object.assign(state.calendar, saved.calendar);
    if(saved.filters) state.filters = Object.assign(state.filters, saved.filters);
  } catch(e){}
  const listeners = {};
  function save(){ localStorage.setItem('hpc-settings', JSON.stringify(state)); }
  function emit(ev, detail){ (listeners[ev]||[]).forEach(fn=>fn(detail)); }
  function on(ev, fn){ (listeners[ev]||(listeners[ev]=[])).push(fn); }
  function set(part){ Object.assign(state, part); save(); emit('settings:changed', state); }
  function setFilters(part){ state.filters = Object.assign(state.filters, part); save(); emit('filters:changed', state.filters); emit('settings:changed', state); }
  function setCalendar(part){ state.calendar = Object.assign(state.calendar, part); save(); emit('settings:changed', state); }
  return { get: ()=>state, set, setFilters, setCalendar, on };
})();
window.SettingsStore = SettingsStore;
function showToast(msg){ const t=$('#toast'); t.textContent=msg; t.style.display='block'; clearTimeout(showToast._h); showToast._h=setTimeout(()=>{ t.style.display='none'; }, 2600); }
function showHint(x,y,msg){ const h=$('#hint'); h.textContent=msg; h.style.left=(x+12)+'px'; h.style.top=(y+12)+'px'; h.style.display='block'; }
function hideHint(){ $('#hint').style.display='none'; }
function showContextMenu(x,y,id){ const m=$('#ctxMenu'); m.dataset.id=id; m.style.display='block'; m.style.left=x+'px'; m.style.top=y+'px'; }
function hideContextMenu(){ $('#ctxMenu').style.display='none'; }
document.addEventListener('click', hideContextMenu);

// ----------------------------[ PARSERS & VALIDATORS ]----------------------------
// Functions for parsing and validating specific data formats like duration and dependencies.
// ------------------------------------------------------------------------------------
function parseDurationStrict(v){
  if(typeof v==='number'){
    if(!Number.isInteger(v) || v<0) return {error:'Duration must be a non‑negative integer (days).'};
    return {days:v};
  }
  const s=String(v||'').trim();
  if(s==='') return {error:'Duration is required.'};
  const m=s.match(/^(\d+)\s*([dw])?$/i);
  if(!m) return {error:'Use number of days or Nd/Nw (e.g., 10 or 3w).'};
  const n=parseInt(m[1],10); const u=(m[2]||'d').toLowerCase();
  if(n<0) return {error:'Duration cannot be negative.'};
  const days = u==='w'? n*5 : n;
  return {days};
}

function validateProject(project) {
  const errors = [];
  const warnings = [];
  let migrated = false;

  if (!project || typeof project !== 'object') {
    errors.push({ sev: 'critical', msg: 'Invalid project file format. Expected a JSON object.' });
    return { ok: false, errors, warnings, project };
  }

  const projectVersion = project.schemaVersion;

  if (!projectVersion) {
    warnings.push({ sev: 'warn', msg: 'No schemaVersion found. Assuming older format and attempting to migrate.' });
    project.schemaVersion = '0.0.0'; // Assign a base version for migration logic
  }

  // --- MIGRATION LOGIC ---
  if (project.schemaVersion < SCHEMA_VERSION) {
    migrated = true;
    // Example migration: from pre-1.0.0 where 'active' field might not exist
    if (project.tasks && Array.isArray(project.tasks)) {
      project.tasks.forEach(t => {
        if (t.active === undefined) {
          t.active = true;
        }
      });
      warnings.push({ sev: 'info', msg: 'Project migrated to schema v1.0.0: ensured all tasks have an "active" status.' });
    }
    project.schemaVersion = SCHEMA_VERSION;
  } else if (project.schemaVersion > SCHEMA_VERSION) {
    errors.push({ sev: 'critical', msg: `Project schema version (${project.schemaVersion}) is newer than this application's supported version (${SCHEMA_VERSION}). Please update the application.` });
    return { ok: false, errors, warnings, project };
  }

  // --- VALIDATION LOGIC ---
  if (!project.startDate || !/^\d{2}-\d{2}-\d{4}$/.test(project.startDate)) {
    errors.push({ sev: 'error', msg: 'Project is missing a valid "startDate".' });
    project.startDate = todayStr(); // Attempt to fix
    warnings.push({ sev: 'warn', msg: 'Project "startDate" was missing or invalid. It has been reset to today.' });
  }

  if (!project.tasks || !Array.isArray(project.tasks)) {
    errors.push({ sev: 'critical', msg: 'Project is missing a valid "tasks" array.' });
    return { ok: false, errors, warnings, project };
  }

  const taskIds = new Set();
  for (const task of project.tasks) {
    if (!task.id) {
        warnings.push({ sev: 'warn', msg: `A task is missing an ID. A new one will be generated.` });
        task.id = uid('t');
        migrated = true;
    }
    if (taskIds.has(task.id)) {
        warnings.push({ sev: 'warn', msg: `Duplicate task ID found: ${task.id}. A new ID will be generated.` });
        task.id = uid('t');
        migrated = true;
    }
    taskIds.add(task.id);
  }


  const ok = !errors.some(e => e.sev === 'critical');
  return { ok, errors, warnings, project, migrated };
}

// ----------------------------[ CALENDAR LOGIC ]----------------------------
// Handles date calculations, respecting working days, weekends, and holidays.
// --------------------------------------------------------------------------
function makeCalendar(mode, holidaysSet){
  const isHoliday = d=> holidaysSet.has(fmtDate(d));
  function isWorkday(d){ return mode==='calendar'? true : (!isWeekend(d) && !isHoliday(d)); }
  function addBusinessDays(start, n){ let d=new Date(start); let step=n>=0?1:-1; let count=0; while(count!==n){ d.setDate(d.getDate()+step); if(isWorkday(d)) count+=step; } return d; }
  function diffBusinessDays(start, end){ let d=new Date(start); let n=0; const step=start<end?1:-1; while((step>0? d<end : d>end)){ d.setDate(d.getDate()+step); if(isWorkday(d)) n+=step; } return n; }
  return {
    mode,
    isWorkday,
    add:(start,n)=> mode==='calendar'? addDays(start,n): addBusinessDays(start,n),
    diff:(start,end)=> mode==='calendar'? daysBetween(start,end): diffBusinessDays(start,end)
  };
}

// ---------------------------- dependency parser ----------------------------
function parseDepToken(token){
  const s=String(token||'').trim(); if(!s) return null;
  let type='FS'; let rest=s; const colon=s.indexOf(':');
  if(colon>0){ const t=s.slice(0,colon).toUpperCase(); if(['FS','SS','FF','SF'].includes(t)){ type=t; rest=s.slice(colon+1); } }
  let pred=rest; let lag=0;
  const m = rest.match(/^(.*?)([+-])(\d+)([dw])?$/i);
  if(m){ pred=m[1]; const sign=m[2]==='-'?-1:1; const n=parseInt(m[3],10); const u=(m[4]||'d').toLowerCase(); lag = sign * (u==='w'? n*5 : n); }
  pred=pred.trim();
  return {type, pred, lag};
}
function stringifyDep(e){ const lagStr = e.lag? ((e.lag>0?'+':'')+Math.round(e.lag)+'d') : ''; return (e.type==='FS' && !lagStr? e.pred : `${e.type}:${e.pred}${lagStr}`); }
function normalizeDeps(task){ const raw=task.deps||[]; const arr=[]; for(const tok of raw){ const p=parseDepToken(tok); if(!p) continue; arr.push(p); } return arr; }
function adjustIncomingLags(task, delta){ const out=[]; for(const tok of (task.deps||[])){ const e=parseDepToken(tok); if(!e){ out.push(tok); continue; } if(e.type==='FS'||e.type==='SS'){ e.lag=(e.lag|0)+delta; out.push(stringifyDep(e)); } else { out.push(tok); } } return out; }

// ----------------------------[ STATE MANAGEMENT ]----------------------------
// Centralized state manager (SM) to handle application state, including undo/redo.
// -------------------------------------------------------------------------------
const SM=(function(){
  let state=deepFreeze({ startDate: todayStr(), calendar:'workdays', holidays:[], tasks:[] });
  let listeners=[]; let lastCPMWarns=[];
  const undo=[]; const redo=[]; const MAX=100;
  const BASE_KEY='hpc-project-baselines';
  let baselines=[];
  try{ baselines=JSON.parse(localStorage.getItem(BASE_KEY))||[]; }catch(e){ baselines=[]; }
  function saveBaselines(){
    try{ localStorage.setItem(BASE_KEY, JSON.stringify(baselines)); }
    catch(e){ console.warn('Failed to save baselines', e); }
  }
  function get(){ return clone(state); }
  function _apply(next){ state=deepFreeze(clone(next)); for(const fn of listeners){ try{ fn(get()); }catch(e){ console.warn(e); } } }

  function updateUndoUI() {
      const undoBtn = $('#btnUndo');
      const redoBtn = $('#btnRedo');
      if (undoBtn) {
          const lastUndo = undo[undo.length - 1];
          undoBtn.disabled = !canUndo();
          undoBtn.title = lastUndo ? `Undo: ${lastUndo.name} (Ctrl+Z)` : 'Undo (Ctrl+Z)';
      }
      if (redoBtn) {
          const lastRedo = redo[redo.length - 1];
          redoBtn.disabled = !canRedo();
          redoBtn.title = lastRedo ? `Redo: ${lastRedo.name} (Ctrl+Y)` : 'Redo (Ctrl+Y)';
      }
  }

  function saveState(state) {
    try {
      const data = JSON.stringify(state);
      localStorage.setItem('hpc-project-planner-data', data);
      saveBaselines();
      const lastSaved = new Date().toLocaleTimeString();
      const lastSavedBadge = $('#lastSavedBadge');
      if (lastSavedBadge) {
        lastSavedBadge.innerHTML = `<span class="pill-icon" aria-hidden="true">💾</span> Saved: ${lastSaved}`;
      }
    } catch (e) {
      console.warn('Failed to save state to localStorage', e);
      const lastSavedBadge = $('#lastSavedBadge');
      if (lastSavedBadge) {
        lastSavedBadge.textContent = 'Save failed';
      }
    }
  }
  function set(next, opts={}){
    const prev=get();
    _apply(next);
    if(opts.record!==false){
      const actionName = opts.name || 'Unknown action';
      undo.push({ state: prev, name: actionName });
      if(undo.length>MAX) undo.shift();
      redo.length=0;
    }
    window.dispatchEvent(new CustomEvent('state:changed', {detail:{sourceIds:opts.sourceIds||[]}}));
    if (opts.noSave !== true) {
      saveState(next);
    }
    updateUndoUI();
  }
  function setProjectProps(props, opts={}){ const cur=get(); Object.assign(cur, props); set(cur, opts); }
  function addTasks(list, opts={}){ const cur=get(); const ids=new Set(cur.tasks.map(t=>t.id)); const add=list.map(t=>{ let id=t.id||uid('t'); while(ids.has(id)) id=uid('t'); ids.add(id); return {...t, id}; }); cur.tasks=cur.tasks.concat(add); set(cur, opts); }
  function replaceTasks(tasks, opts={}){ const cur=get(); cur.tasks=tasks; set(cur, opts); }
  function updateTask(id, patch, opts={}){ const cur=get(); const i=cur.tasks.findIndex(t=>t.id===id); if(i<0) return; cur.tasks=cur.tasks.slice(); cur.tasks[i]={...cur.tasks[i], ...patch}; set(cur,{sourceIds:[id], ...opts}); }
  function onChange(fn){ listeners.push(fn); }
  function setCPMWarnings(list){ lastCPMWarns = list||[]; }
  function canUndo(){ return undo.length>0; } function canRedo(){ return redo.length>0; }
  function undoOp(){ if(!canUndo()) return; const record=undo.pop(); const cur={state: get(), name: record.name}; redo.push(cur); _apply(record.state); updateUndoUI(); }
  function redoOp(){ if(!canRedo()) return; const record=redo.pop(); const cur={state: get(), name: record.name}; undo.push(cur); _apply(record.state); updateUndoUI(); }
  function listBaselines(){ return baselines.map(b=>({id:b.id,name:b.name,createdAt:b.createdAt})); }
  function getBaseline(id){ const b=baselines.find(x=>x.id===id); return b? clone(b.projectSnapshot): null; }
  function addBaseline(name){ const id=uid('b'); const projectSnapshot=get(); baselines.push({id,name,createdAt:new Date().toISOString(),projectSnapshot}); if(baselines.length>5) baselines=baselines.slice(-5); saveBaselines(); return id; }
  function removeBaseline(id){ baselines=baselines.filter(b=>b.id!==id); saveBaselines(); }
  return {get,set,setProjectProps,addTasks,replaceTasks,updateTask,onChange,setCPMWarnings,undo:undoOp,redo:redoOp,canUndo,canRedo,addBaseline,removeBaseline,getBaseline,listBaselines};
})();

// ----------------------------[ WARNING ENGINE ]----------------------------
// Scans for potential issues and provides structured warnings.
// --------------------------------------------------------------------------
const WarningEngine = (function() {
  let seq = 0;
  function _push(warnings, FIX, sev, msg, opts = {}) {
      const id = 'w_' + (++seq);
      const it = { id, sev, msg, ...opts };
      if (opts.fix) {
          FIX[id] = opts.fix;
          it.hasFix = true;
      }
      warnings.push(it);
  }

  function checkTaskProperties(project, cpm, warnings, FIX) {
    const push = (...args) => _push(warnings, FIX, ...args);
    const seenIds = new Set();
    const dupIds = new Set();
    for (const t of project.tasks) {
        if (t.id && seenIds.has(t.id)) dupIds.add(t.id);
        if (t.id) seenIds.add(t.id);
    }

    if (dupIds.size > 0) {
        push('critical', `Duplicate task ID(s) found: ${Array.from(dupIds).join(', ')}`, {
            fix: () => {
                const s = SM.get();
                const used = new Set();
                s.tasks.forEach(t => {
                    if (t.id && used.has(t.id)) {
                        t.id = uid('t');
                    }
                    used.add(t.id);
                });
                SM.replaceTasks(s.tasks, { name: 'Fix Duplicate IDs' });
            }
        });
    }

    for (const t of project.tasks) {
        if (!t.id || String(t.id).trim() === '') {
            push('error', `Task found with missing ID.`, { taskId: t.id,
                fix: () => { SM.updateTask(t.id, { id: uid('t') }, { name: 'Assign Missing ID' }); }
            });
        }
        if (!t.name || String(t.name).trim() === '') {
            push('error', `Task has a missing name.`, { taskId: t.id,
                fix: () => { SM.updateTask(t.id, { name: `Task ${t.id}` }, { name: 'Assign Missing Name' }); }
            });
        }
        const pd = parseDurationStrict(t.duration);
        if (pd.error) {
            push('error', `Invalid duration: ${pd.error}`, { taskId: t.id,
                fix: () => { SM.updateTask(t.id, { duration: 1 }, { name: 'Fix Invalid Duration' }); }
            });
        }
    }
  }

  function checkDependencies(project, cpm, warnings, FIX) {
      const push = (...args) => _push(warnings, FIX, ...args);
      const id2 = Object.fromEntries(project.tasks.map(t => [t.id, t]));

      for (const t of project.tasks) {
          const depStrings = t.deps || [];
          const seen = new Set();
          for (const tok of depStrings) {
              const d = parseDepToken(tok);
              if (!d) continue;
              if (d.pred === t.id) {
                  push('critical', `Self-dependency is not allowed.`, { taskId: t.id,
                      fix: () => { SM.updateTask(t.id, { deps: (t.deps || []).filter(x => x !== tok) }, { name: 'Remove Self-Dependency' }); }
                  });
              }
              if (!id2[d.pred]) {
                  push('error', `Links to missing dependency: "${d.pred}".`, { taskId: t.id,
                      fix: () => { SM.addTasks([{ id: d.pred, name: `New: ${d.pred}`, duration: 1, deps: [] }], { name: 'Add Missing Dependency' }); }
                  });
              }
              if (seen.has(d.pred)) {
                  push('warn', `Duplicate dependency on "${d.pred}".`, { taskId: t.id,
                      fix: () => {
                          const s = SM.get();
                          const T = s.tasks.find(x => x.id === t.id);
                          const seen2 = new Set();
                          T.deps = (T.deps || []).filter(x => { const p = parseDepToken(x); if (!p || seen2.has(p.pred)) return false; seen2.add(p.pred); return true; });
                          SM.replaceTasks(s.tasks, { name: 'Remove Duplicate Dependency' });
                      }
                  });
              }
              seen.add(d.pred);
              if (id2[d.pred] && id2[d.pred].active === false) {
                  push('warn', `Predecessor "${d.pred}" is inactive.`, { taskId: t.id,
                      fix: () => { SM.updateTask(d.pred, { active: true }, { name: 'Activate Predecessor' }); }
                  });
              }
          }
      }
  }

  function checkCycles(project, cpm, warnings, FIX) {
      const push = (...args) => _push(warnings, FIX, ...args);
      if (cpm && cpm.tasks.length !== project.tasks.filter(t=>t.active!==false).length) {
        push('critical', `Circular dependency detected or invalid graph structure. Some tasks are excluded from calculation.`);
      }
  }

  function checkSchedule(project, cpm, warnings, FIX) {
      const push = (...args) => _push(warnings, FIX, ...args);
      if (!project.startDate) {
        push('error','Project start date is missing.', {
          fix:()=> SM.setProjectProps({startDate: todayStr()}, {name: 'Set Start Date'})
        });
      }

      if (!cpm || !cpm.tasks) return;
      const cpmMap = Object.fromEntries(cpm.tasks.map(t => [t.id, t]));
      const id2 = Object.fromEntries(project.tasks.map(t => [t.id, t]));

      for (const t of cpm.tasks) {
          const cur = id2[t.id];
          if (!cur) continue;

          if (cur.startConstraint && cur.startConstraint.type === 'MSO') {
              const esReq = calcEarliestESFor(project, t.id, t.ef - t.es);
              if (esReq > (cur.startConstraint.day | 0)) {
                  push('error', `MSO violated: must start on/after day ${esReq}, but set to ${cur.startConstraint.day}.`, { taskId: t.id,
                      fix: () => { SM.updateTask(t.id, { startConstraint: { ...cur.startConstraint, day: esReq } }, { name: 'Fix MSO Violation' }); }
                  });
              }
          }
          const dur = parseDurationStrict(cur.duration).days || 0;
          const isMilestone = String(cur.name || '').toLowerCase().includes('gate') || String(cur.phase || '').toLowerCase().includes('gate');
          if (dur === 0 && !isMilestone) {
              push('info', `Zero-duration task. Consider making it a milestone or setting duration to 1d.`, { taskId: t.id,
                  fix: () => { SM.updateTask(t.id, { duration: 1 }, { name: 'Set Duration to 1d' }); }
              });
          }
      }
  }

  function run(project, cpm) {
    const warnings = [];
    const FIX = {};
    seq = 0;

    checkTaskProperties(project, cpm, warnings, FIX);
    checkDependencies(project, cpm, warnings, FIX);
    checkCycles(project, cpm, warnings, FIX);
    checkSchedule(project, cpm, warnings, FIX);

    // Add back warnings from CPM compute step (e.g. SNET clamps)
    // These are not yet in the new engine, so we merge them.
    const cpmWarnings = SM.lastCPMWarns || [];
    warnings.push(...cpmWarnings);

    // Deduplicate warnings
    const seen = new Set();
    const uniqueWarnings = [];
    for (const w of warnings) {
      const key = `${w.sev}|${w.msg}|${w.taskId || ''}`;
      if (!seen.has(key)) {
        seen.add(key);
        uniqueWarnings.push(w);
      }
    }

    return { warnings: uniqueWarnings, FIX };
  }

  return { run };
})();

// The computeCPM function is now in the worker.

// ----------------------------[ ISSUE VALIDATION ENGINE ]----------------------------
// Rule-based engine to collect validation issues, warnings, and errors in the project.
// ------------------------------------------------------------------------------------
function collectIssues(project, cpm){
  // The new WarningEngine is now the source of truth for issues.
  // We just call it and return its results.
  const { warnings, FIX } = WarningEngine.run(project, cpm);
  return { issues: warnings, FIX };
}

// ----------------------------[ UI: ZOOM & PAN ]----------------------------
// Reusable component for handling zoom and pan on SVG elements.
// --------------------------------------------------------------------------
// A more robust interaction manager for SVG surfaces
function InteractionManager(svg, options = {}) {
    const Z = {};
    let vb = [0, 0, svg.clientWidth || 800, svg.clientHeight || 500];
    const listeners = [];

    function setVB(x, y, w, h) {
        vb = [x, y, w, h];
        svg.setAttribute('viewBox', vb.join(' '));
        listeners.forEach(fn => fn(vb));
    }

    function fit() {
        const w = svg.clientWidth || 800;
        const h = svg.clientHeight || 500;
        if (options.fitContent) {
            try {
                const bbox = svg.getBBox();
                if (bbox.width > 0 && bbox.height > 0) {
                    const padding = 20;
                    setVB(bbox.x - padding, bbox.y - padding, bbox.width + padding * 2, bbox.height + padding * 2);
                    return;
                }
            } catch (e) { /* initial render might fail */ }
        }
        setVB(0, 0, w, h);
    }
    fit();

    let dragging = false;
    let p0 = null;

    svg.addEventListener('wheel', (e) => {
        e.preventDefault();

        if (e.ctrlKey) { // ZOOM
            const scale = e.deltaY > 0 ? 1.1 : 0.9;
            const mx = e.offsetX;
            const my = e.offsetY;
            const clientWidth = svg.clientWidth || 1;
            const clientHeight = svg.clientHeight || 1;

            const pointX = vb[0] + mx * (vb[2] / clientWidth);
            const pointY = vb[1] + my * (vb[3] / clientHeight);

            const newW = vb[2] * scale;
            const newH = vb[3] * scale;

            const newX = pointX - mx * (newW / clientWidth);
            const newY = pointY - my * (newH / clientHeight);

            setVB(newX, newY, newW, newH);
        } else { // PAN
            const clientWidth = svg.clientWidth || 1;
            const clientHeight = svg.clientHeight || 1;
            const panXAmount = (e.shiftKey ? e.deltaY : e.deltaX) * (vb[2] / clientWidth);
            const panYAmount = (e.shiftKey ? 0 : e.deltaY) * (vb[3] / clientHeight);
            setVB(vb[0] + panXAmount, vb[1] + panYAmount, vb[2], vb[3]);
        }
    }, { passive: false });

    svg.addEventListener('pointerdown', (e) => {
        if (e.button !== 0 || e.target !== svg) return;
        dragging = true;
        p0 = { x: e.clientX, y: e.clientY, vb0: [...vb] };
        svg.setPointerCapture(e.pointerId);
        svg.style.cursor = 'grabbing';
    });

    svg.addEventListener('pointermove', (e) => {
        if (!dragging) return;
        const clientWidth = svg.clientWidth || 1;
        const clientHeight = svg.clientHeight || 1;
        const dx = (e.clientX - p0.x) * (vb[2] / clientWidth);
        const dy = (e.clientY - p0.y) * (vb[3] / clientHeight);
        setVB(p0.vb0[0] - dx, p0.vb0[1] - dy, vb[2], vb[3]);
    });

    svg.addEventListener('pointerup', (e) => {
        if (!dragging) return;
        dragging = false;
        svg.releasePointerCapture(e.pointerId);
        svg.style.cursor = 'grab';
    });

    svg.style.cursor = 'grab';

    Z.zoomIn = () => {
        const scale = 0.9;
        const newW = vb[2] * scale;
        const newH = vb[3] * scale;
        setVB(vb[0] + (vb[2] - newW) / 2, vb[1] + (vb[3] - newH) / 2, newW, newH);
    };
    Z.zoomOut = () => {
        const scale = 1.1;
        const newW = vb[2] * scale;
        const newH = vb[3] * scale;
        setVB(vb[0] - (newW - vb[2]) / 2, vb[1] - (newH - vb[3]) / 2, newW, newH);
    };
    Z.fit = fit;
    Z.getViewBox = () => vb.slice();
    Z.setViewBox = (x, y, w, h) => setVB(x, y, w, h);
    Z.onChange = (fn) => { listeners.push(fn); };

    return Z;
}


// ----------------------------[ UI: FILTER & GROUP ]----------------------------
// Logic for filtering and grouping tasks in the views.
// ------------------------------------------------------------------------------
const SUBS=['power/VRM','PCIe','BMC','BIOS','FW','Mech','Thermal','System'];
function getActiveSubsystems(){ return $$('#subsysFilters input[type="checkbox"]').filter(x=>x.checked).map(x=>x.value); }
function matchesFilters(t){ const txt=($('#filterText').value||'').toLowerCase(); if(txt){ const inName=(t.name||'').toLowerCase().includes(txt); const inPhase=(t.phase||'').toLowerCase().includes(txt); if(!inName && !inPhase) return false; }
  const act=getActiveSubsystems(); if(act.length && !act.includes(t.subsystem||'System')) return false; return true; }
function groupKey(t){ const g=$('#groupBy').value||'none'; if(g==='phase') return t.phase||'(no phase)'; if(g==='subsystem') return t.subsystem||'System'; return null; }

// ----------------------------[ UI: RENDERING ]----------------------------
// Functions to render the main views: dependency graph, timeline, focus view, etc.
// ---------------------------------------------------------------------------

function wrapText(text, maxChars) {
    if (!text) return [''];
    const words = String(text).split(' ');
    const lines = [];
    let currentLine = '';
    for (const word of words) {
        if ((currentLine + ' ' + word).length > maxChars && currentLine.length > 0) {
            lines.push(currentLine);
            currentLine = word;
        } else {
            if (currentLine.length > 0) currentLine += ' ';
            currentLine += word;
        }
    }
    if (currentLine.length > 0) {
        lines.push(currentLine);
    }
    return lines.length > 0 ? lines : [''];
}

function layoutDAG(tasks){
    const byLevel=new Map();
    const K=120; // Increased vertical spacing
    const nodeSpacing = 40; // Explicit horizontal spacing
    const charWidth = 8.5; // Estimated width of a character
    const minWidth = 180;
    const maxWidth = 320; // Max width before wrapping

    for(const t of tasks){
        const lvl=t.es;
        const y=Math.round(lvl/5);
        if(!byLevel.has(y)) byLevel.set(y,[]);
        byLevel.get(y).push(t);
    }

    const pos=new Map();
    for(const [lvl,arr] of byLevel){
        arr.sort((a,b)=> (a.phase||'').localeCompare(b.phase||''));
        let x=40;
        for(const t of arr){
            const name = t.name || '';
            // Determine width first
            const calculatedWidth = name.length * charWidth + 20;
            const width = Math.max(minWidth, Math.min(maxWidth, calculatedWidth));

            // Now determine height based on wrapping with the chosen width
            const charLimit = Math.floor((width - 20) / charWidth);
            const lines = wrapText(name, charLimit);
            const height = 28 + lines.length * 16;

            pos.set(t.id,{x, y: 40 + lvl * K, width, height });
            x += width + nodeSpacing;
        }
    }
    return pos;
}

function renderGraph(project, cpm){
    const svg = $('#graphSvg');
    svg.innerHTML='';
    const defs=document.createElementNS('http://www.w3.org/2000/svg','defs');
    defs.innerHTML=`<marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#94a3b8"/></marker>`;
    svg.appendChild(defs);
    const g=document.createElementNS('http://www.w3.org/2000/svg','g');
    svg.appendChild(g);
    const tasks=cpm.tasks.filter(matchesFilters);
    const id2=Object.fromEntries(cpm.tasks.map(t=>[t.id,t]));
    const pos=layoutDAG(tasks);

    for(const t of tasks){
        const edges = normalizeDeps(t);
        for(const e of edges){
            const d=e.pred;
            if(!id2[d] || !matchesFilters(id2[d])) continue;
            const p1=pos.get(d), p2=pos.get(t.id);
            if(!p1||!p2) continue;
            const line=document.createElementNS('http://www.w3.org/2000/svg','path');
            line.setAttribute('d',`M ${p1.x + p1.width} ${p1.y + p1.height / 2} L ${p2.x - 12} ${p2.y + p2.height / 2}`);
            line.setAttribute('class','edge arrow'+(t.critical&&id2[d].critical?' critical':''));
            g.appendChild(line);
        }
    }

    for(const t of tasks){
        const p=pos.get(t.id);
        if(!p) continue;
        const node=document.createElementNS('http://www.w3.org/2000/svg','g');
        node.setAttribute('class','node'+(t.critical?' critical':''));
        node.setAttribute('data-id',t.id);
        if(SEL.has(t.id)) node.classList.add('selected');
        const color=colorFor(t.subsystem);

        const charLimit = Math.floor((p.width - 20) / 8.5);
        const titleLines = wrapText(esc(t.name), charLimit);

        const rect = document.createElementNS('http://www.w3.org/2000/svg','rect');
        rect.setAttribute('x', p.x);
        rect.setAttribute('y', p.y);
        rect.setAttribute('width', p.width);
        rect.setAttribute('height', p.height);
        rect.setAttribute('style', `stroke:${color}`);
        rect.setAttribute('rx', "8");
        rect.setAttribute('fill', "#fff");
        node.appendChild(rect);

        const titleText = document.createElementNS('http://www.w3.org/2000/svg','text');
        titleText.setAttribute('x', p.x + 10);
        titleText.setAttribute('y', p.y + 20);
        titleText.setAttribute('class', 'title');

        titleLines.forEach((line, i) => {
            const tspan = document.createElementNS('http://www.w3.org/2000/svg', 'tspan');
            tspan.setAttribute('x', p.x + 10);
            tspan.setAttribute('dy', i === 0 ? '0' : '1.2em');
            tspan.textContent = line;
            titleText.appendChild(tspan);
        });
        node.appendChild(titleText);

        const metaText = document.createElementNS('http://www.w3.org/2000/svg','text');
        metaText.setAttribute('x', p.x + 10);
        metaText.setAttribute('y', p.y + p.height - 8);
        metaText.setAttribute('fill', '#64748b');
        metaText.textContent = `${esc(t.phase||'')} • ${esc(String(t.duration))}d • slack ${esc(String(t.slack))}`;
        node.appendChild(metaText);

          node.addEventListener('click', (ev)=>{
            if(ev.shiftKey||ev.metaKey||ev.ctrlKey){
              toggleSelect(t.id);
            } else {
              selectOnly(t.id);
            }
          });
          g.appendChild(node);
      }
  }

function colorFor(subsys){ const M={'power/VRM':'--pwr','PCIe':'--pcie','BMC':'--bmc','BIOS':'--bios','FW':'--fw','Mech':'--mech','Thermal':'--thermal','System':'--sys'}; const v=M[subsys]||'--ok'; return getComputedStyle(document.documentElement).getPropertyValue(v).trim()||'#16a34a'; }
function renderGantt(project, cpm){ const svg=$('#gantt'); svg.innerHTML=''; const W=(svg.getBoundingClientRect().width||800); const H=(svg.getBoundingClientRect().height||500); const tasksAll=cpm.tasks.slice(); const tasks=tasksAll.filter(matchesFilters);
  const maxLen = Math.max(20, ...tasks.map(t=>(t.name||'').length));
  const P = Math.min(400, 10 + maxLen * 8.5);
  // grouping
  const groups={}; const order=[]; for(const t of tasks){ const k=groupKey(t); if(k==null){ order.push(['', [t]]); continue; } if(!groups[k]) groups[k]=[]; groups[k].push(t); }
  if(Object.keys(groups).length){ for(const k of Object.keys(groups).sort()){ order.push([k, groups[k].sort((a,b)=> (a.es-b.es)|| (a.name||'').localeCompare(b.name||''))]); } }
  if(!order.length) order.push(['', tasks.sort((a,b)=> (a.es-b.es)|| (a.name||'').localeCompare(b.name||''))]);
  const rows=[]; order.forEach(([k,arr])=>{ if(k){ rows.push({type:'group', label:k}); } arr.forEach(t=> rows.push({type:'task', t})); });
  const rowH=28; const chartH=Math.max(H, rows.length*rowH+60); svg.setAttribute('viewBox',`0 0 ${W} ${chartH}`);
  svg.setAttribute('height', chartH);
  const finish=Math.max(10,cpm.finishDays||10); const scale = (x)=> P + (x*(W-P-20))/finish; const scaleInv=(px)=> Math.round((px-P)*finish/(W-P-20));
  const gAxis=document.createElementNS('http://www.w3.org/2000/svg','g'); gAxis.setAttribute('class','axis'); const ticks=10; for(let i=0;i<=ticks;i++){ const x=scale(i*(finish/ticks)); const l=document.createElementNS('http://www.w3.org/2000/svg','line'); l.setAttribute('x1',x); l.setAttribute('y1',20); l.setAttribute('x2',x); l.setAttribute('y2',chartH-20); l.setAttribute('stroke','#e5e7eb'); gAxis.appendChild(l); const t=document.createElementNS('http://www.w3.org/2000/svg','text'); t.setAttribute('x',x+2); t.setAttribute('y',14); t.textContent = Math.round(i*(finish/ticks))+'d'; gAxis.appendChild(t); } svg.appendChild(gAxis);
  const g=document.createElementNS('http://www.w3.org/2000/svg','g'); svg.appendChild(g);
  let y=30; rows.forEach((r)=>{ if(r.type==='group'){ const rect=document.createElementNS('http://www.w3.org/2000/svg','rect'); rect.setAttribute('x',0); rect.setAttribute('y',y-6); rect.setAttribute('width',P-10); rect.setAttribute('height',22); rect.setAttribute('class','groupHeader'); g.appendChild(rect); const tx=document.createElementNS('http://www.w3.org/2000/svg','text'); tx.setAttribute('x',8); tx.setAttribute('y',y+8); tx.setAttribute('class','groupLabel'); tx.textContent=r.label; g.appendChild(tx); y+=22; return; }
    const t=r.t; const x=scale(Math.max(0,t.es||0)), w=Math.max(4, scale(Math.max(0,t.ef||1))-scale(Math.max(0,t.es||0)) );
    const bar=document.createElementNS('http://www.w3.org/2000/svg','g');
    bar.setAttribute('class','bar'+(t.critical?' critical':'')); bar.setAttribute('data-id',t.id);
    bar.setAttribute('role','listitem');
    const durVal = parseDurationStrict(t.duration).days || 0;
    const labelText = `${t.name}, phase ${t.phase || 'N/A'}, duration ${durVal} days, ${t.critical ? 'critical path' : 'slack ' + t.slack + ' days'}`;
    bar.setAttribute('aria-label', labelText);
    if(SEL.has(t.id)) bar.classList.add('selected');
    const col=colorFor(t.subsystem);
    const isMilestone=(parseDurationStrict(t.duration).days||0)===0;
    if(isMilestone){
      bar.setAttribute('data-ms','1');
      const diamond=document.createElementNS("http://www.w3.org/2000/svg","rect");
      diamond.setAttribute("x",x-6); diamond.setAttribute("y",y+2); diamond.setAttribute("width",12); diamond.setAttribute("height",12);
      diamond.setAttribute("transform",`rotate(45 ${x} ${y+8})`);
      diamond.setAttribute("class","milestone"+(t.critical?' critical':''));
      diamond.setAttribute("style",`stroke:${col}`);
      bar.appendChild(diamond);
    }else{
      const rect=document.createElementNS("http://www.w3.org/2000/svg","rect");
      rect.setAttribute("x",x); rect.setAttribute("y",y); rect.setAttribute("width",w); rect.setAttribute("height",16); rect.setAttribute("style",`stroke:${col}`);
      bar.appendChild(rect);

      // Add overlay for critical tasks for the stripe pattern
      if (t.critical) {
        const overlay = document.createElementNS("http://www.w3.org/2000/svg","rect");
        overlay.setAttribute('class', 'overlay');
        overlay.setAttribute('x', x);
        overlay.setAttribute('y', y);
        overlay.setAttribute('width', w);
        overlay.setAttribute('height', 16);
        bar.appendChild(overlay);
      }

      const progW=Math.max(0, Math.min(w, w*(t.pct||0)/100));
      if(progW>0){ const prog=document.createElementNS("http://www.w3.org/2000/svg","rect"); prog.setAttribute("x",x); prog.setAttribute("y",y); prog.setAttribute("width",progW); prog.setAttribute("height",16); prog.setAttribute("class","progress"); prog.setAttribute("fill",col); bar.appendChild(prog); }
      const left=document.createElementNS("http://www.w3.org/2000/svg","rect"); left.setAttribute("x",x-3); left.setAttribute("y",y); left.setAttribute("width",3); left.setAttribute("height",16); left.setAttribute("class","handle"); left.setAttribute("data-side","left"); bar.appendChild(left);
      const right=document.createElementNS("http://www.w3.org/2000/svg","rect"); right.setAttribute("x",x+w); right.setAttribute("y",y); right.setAttribute("width",3); right.setAttribute("height",16); right.setAttribute("class","handle"); right.setAttribute("data-side","right"); bar.appendChild(right);
    }
    // Add background rectangle for task name readability
    const nameBg=document.createElementNS("http://www.w3.org/2000/svg","rect");
    const nameWidth = Math.max(80, (t.name||'').length * 8.5); // Estimate text width
    nameBg.setAttribute("x", P - 10 - nameWidth);
    nameBg.setAttribute("y", y - 4);
    nameBg.setAttribute("width", nameWidth + 4);
    nameBg.setAttribute("height", 24);
    nameBg.setAttribute("fill", "var(--bg)");
    nameBg.setAttribute("rx", "4");
    nameBg.setAttribute("class", "taskNameBg");
    nameBg.style.pointerEvents = 'none';
    bar.appendChild(nameBg);

    const label=document.createElementNS("http://www.w3.org/2000/svg","text");
    label.setAttribute("class","label");
    label.setAttribute("x", P - 8);
    label.setAttribute("y", y + 12);
    label.setAttribute("text-anchor","end");
    bar.appendChild(label);

    const titleEl = document.createElementNS("http://www.w3.org/2000/svg", "title");
    titleEl.textContent = t.name;
    label.appendChild(titleEl);

    const name = t.name || '';
    const maxCharsPerLine = Math.floor((P - 20) / 8.5);

    if (name.length > maxCharsPerLine) {
        let breakPoint = name.lastIndexOf(' ', maxCharsPerLine);
        if (breakPoint === -1) breakPoint = maxCharsPerLine;

        const line1 = name.substring(0, breakPoint);
        const line2 = name.substring(breakPoint).trim();

        label.setAttribute("y", y + 6); // Adjust y for two lines

        const tspan1 = document.createElementNS("http://www.w3.org/2000/svg","tspan");
        tspan1.textContent = line1;
        tspan1.setAttribute("x", P-8);
        label.appendChild(tspan1);

        const tspan2 = document.createElementNS("http://www.w3.org/2000/svg","tspan");
        tspan2.textContent = line2.length > maxCharsPerLine ? line2.substring(0, maxCharsPerLine - 1) + '…' : line2;
        tspan2.setAttribute("x", P-8);
        tspan2.setAttribute("dy", "1.2em");
        label.appendChild(tspan2);

        nameBg.setAttribute('height', '40');
        nameBg.setAttribute('y', y-6);

    } else {
        label.textContent = name;
    }
    const dur=document.createElementNS("http://www.w3.org/2000/svg","text"); dur.setAttribute("class","label duration-label"); dur.setAttribute("x",isMilestone? x+6 : x+w+6); dur.setAttribute("y",y+12); dur.textContent=String(t.duration)+"d"; bar.appendChild(dur);
    if(!isMilestone){ if (w > 40 || (t.pct||0) > 0) { const pct=document.createElementNS("http://www.w3.org/2000/svg","text"); pct.setAttribute("class","label inbar"); pct.setAttribute("x",x+4); pct.setAttribute("y",y+12); pct.textContent=(t.pct||0)+"%"; bar.appendChild(pct); } }
      bar.addEventListener('click', (ev)=>{
        if(ev.shiftKey||ev.metaKey||ev.ctrlKey){
          toggleSelect(t.id);
        } else {
          selectOnly(t.id);
        }
      });
      bar.addEventListener('contextmenu',(ev)=>{ ev.preventDefault(); selectOnly(t.id); showContextMenu(ev.clientX, ev.clientY, t.id); });
      g.appendChild(bar); y+=rowH; });

  // drag
  let drag = null;
  svg.onpointerdown = (ev) => {
    const tgt = ev.target;
    const gg = tgt.closest('.bar');
    if (!gg || gg.dataset.ms) return;
    const id = gg.getAttribute('data-id');
    const rect = gg.querySelector('rect');
    const x0 = +rect.getAttribute('x');
    const w0 = +rect.getAttribute('width');
    const side = tgt.classList.contains('handle') ? tgt.getAttribute('data-side') : 'move';
    drag = { id, side, x0, w0, px0: ev.clientX, py0: ev.clientY, moved: false };
    gg.classList.add('moved');
  };
  svg.onpointermove = (ev) => {
    if (!drag) return;
    const dx = ev.clientX - drag.px0;
    const dy = ev.clientY - drag.py0;
    if (!drag.moved) {
      if (Math.abs(dx) < 2 && Math.abs(dy) < 2) return;
      drag.moved = true;
      svg.setPointerCapture(ev.pointerId);
    }
    const gg = $(`.bar[data-id="${drag.id}"]`, svg);
    const rect = gg.querySelector('rect');
    const labelNext = gg.querySelectorAll('text')[1];
    if (drag.side === 'right') {
      const newW = Math.max(4, drag.w0 + dx);
      rect.setAttribute('width', newW);
      const dur = scaleInv(+rect.getAttribute('x') + newW) - (cpm.tasks.find(t => t.id === drag.id).es || 0);
      labelNext.textContent = Math.max(1, dur) + 'd';
      hideHint();
      gg.classList.remove('invalid', 'valid');
    } else {
      const newX = Math.max(P, drag.x0 + dx);
      rect.setAttribute('x', newX);
      const esCand = scaleInv(newX);
      const cur = cpm.tasks.find(t => t.id === drag.id);
      const dur = cur.ef - cur.es;
      const allowed = $('#toggleConAware') ? ($('#toggleConAware').checked ? calcEarliestESFor(SM.get(), drag.id, dur) : 0) : 0;
      const ok = (esCand >= allowed) || ev.shiftKey;
      labelNext.textContent = (cur.duration) + 'd';
      if (ok) {
        gg.classList.add('valid');
        gg.classList.remove('invalid');
        hideHint();
      } else {
        gg.classList.add('invalid');
        gg.classList.remove('valid');
        showHint(ev.clientX, ev.clientY, `Blocked: earliest ${allowed}d`);
      }
    }
  };
  svg.onpointerup = (ev) => {
    if (!drag) return;
    if (svg.hasPointerCapture && svg.hasPointerCapture(ev.pointerId)) svg.releasePointerCapture(ev.pointerId);
    hideHint();
    const gg = $(`.bar[data-id="${drag.id}"]`, svg);
    if (!drag.moved) {
      gg.classList.remove('moved', 'invalid', 'valid');
      drag = null;
      return;
    }
    const rect = gg.querySelector('rect');
    const x = +rect.getAttribute('x');
    const w = +rect.getAttribute('width');
    const scaleInv = (px) => Math.round((px - P) * finish / (W - P - 20));
    const esNew = scaleInv(x);
    const efNew = scaleInv(x + w);
    const durNew = Math.max(1, efNew - esNew);
    const cur = cpm.tasks.find(t => t.id === drag.id);
    if (drag.side === 'right') {
      SM.updateTask(drag.id, { duration: durNew }, { name: 'Update Duration' });
      showToast('Duration updated');
    } else if (drag.side === 'left' || (drag.side === 'move' && ev.shiftKey)) {
      const sc = { type: 'SNET', day: esNew };
      SM.updateTask(drag.id, { startConstraint: sc, duration: durNew }, { name: 'Set SNET Constraint' });
      showToast('Set SNET constraint');
    } else {
      const allowed = $('#toggleConAware') ? ($('#toggleConAware').checked ? calcEarliestESFor(SM.get(), drag.id, cur.ef - cur.es) : 0) : 0;
      const autoLag = $('#toggleAutoLag') ? $('#toggleAutoLag').checked : false;
      if (esNew < allowed && !autoLag) {
        const sc = { type: 'SNET', day: allowed };
        SM.updateTask(drag.id, { startConstraint: sc }, { record: true, name: 'Snap to Earliest' });
        showToast(`Snapped to earliest ${allowed}d`);
      } else if (esNew !== (cur.es || 0)) {
        const delta = esNew - (cur.es || 0);
        if (autoLag) {
          const s = SM.get();
          const t = s.tasks.find(x => x.id === drag.id);
          t.deps = adjustIncomingLags(t, delta);
          SM.replaceTasks(s.tasks, { record: true, name: `Adjust Lags by ${delta}d` });
          showToast(`Adjusted predecessor lags by ${delta}d`);
        } else {
          const sc = { type: 'SNET', day: Math.max(0, esNew) };
          SM.updateTask(drag.id, { startConstraint: sc }, { record: true, name: 'Add SNET Constraint' });
          showToast('Added SNET to honor move');
        }
      }
    }
    gg.classList.remove('invalid', 'valid');
    drag = null;
    setTimeout(() => { refresh(); }, 0);
  };
// Accessible summary
  const summaryContainer = $('#gantt-accessible-summary');
  if (summaryContainer) {
    summaryContainer.innerHTML = '';
    const list = document.createElement('ul');
    list.setAttribute('aria-label', 'List of project tasks');
    for (const r of rows) {
      if (r.type !== 'task') continue;
      const t = r.t;
      const li = document.createElement('li');
      const durVal = parseDurationStrict(t.duration).days || 0;
      li.innerHTML = `Task: <strong>${esc(t.name)}</strong> (Phase: ${esc(t.phase) || 'N/A'}).
        <span class="duration">Duration: ${durVal} days</span>.
        <span class="slack">Slack: ${t.slack} days</span>.
        Status: ${t.critical ? 'Critical' : 'Not Critical'}.`;
      list.appendChild(li);
    }
    summaryContainer.appendChild(list);
  }
}

function calcEarliestESFor(project, id, dur){
  const id2=Object.fromEntries(project.tasks.map(t=>[t.id,t]));
  const cur=id2[id]; if(!cur) return 0; let es=0;
  for(const e of normalizeDeps(cur)){ const p=id2[e.pred]; if(!p) continue; const pd=parseDurationStrict(p.duration).days||0; if(e.type==='FS') es=Math.max(es, (p.ef!=null?p.ef:pd)+e.lag); else if(e.type==='SS') es=Math.max(es, (p.es!=null?p.es:0)+e.lag); else if(e.type==='FF') es=Math.max(es, (p.ef!=null?p.ef:pd)+e.lag - dur); else if(e.type==='SF') es=Math.max(es, (p.es!=null?p.es:0)+e.lag - dur); }
  if(cur.startConstraint){ const sc=cur.startConstraint; if(sc.type==='SNET' || sc.type==='MSO') es=Math.max(es, sc.day|0); }
  if(cur.fixedStart!=null) es=Math.max(es, cur.fixedStart|0);
  return Math.max(0, Math.round(es));
}

// ---------------------------- Focus & Issues rendering ----------------------------
function renderFocus(project, cpm){
  $('#countMetric').textContent = String(cpm.tasks.length);
  const cal=makeCalendar(project.calendar, new Set(project.holidays||[]));
  const finishDate = cal.add(parseDate(project.startDate), cpm.finishDays||0);
  $('#finishMetric').textContent = fmtDate(finishDate);
  $('#critMetric').textContent = String(cpm.tasks.filter(t=>t.critical).length);
  const th = +($('#slackThreshold').value||0);
  const near = cpm.tasks.filter(t=>t.slack<=th && !t.critical).sort((a,b)=>a.slack-b.slack);
  const L=$('#nearList'); L.innerHTML=''; for(const t of near){ const row=document.createElement('div'); row.className='row'; row.innerHTML=`<span>${esc(t.name)}</span><span class="slack">slack ${t.slack}d</span>`; L.appendChild(row); }
  // focus warnings = same as issues filter
  renderIssues(project, cpm, '#focusWarnings');
}

function renderIssues(project, cpm, targetSel) {
    const { issues, FIX } = collectIssues(project, cpm);

    // Update severity badges
    const counts = { critical: 0, error: 0, warn: 0, info: 0 };
    for (const it of issues) {
        if (counts[it.sev] !== undefined) {
            counts[it.sev]++;
        }
    }
    const badgesContainer = $('#warning-badges');
    if (badgesContainer) {
        badgesContainer.innerHTML = ['critical', 'error', 'warn', 'info'].map(sev => {
            if (counts[sev] > 0) {
                return `<span class="badge sev-${sev}" style="background:var(--${sev});color:white;margin-left:4px;border-radius:6px;padding:2px 6px;font-size:0.8em;" title="${counts[sev]} ${sev} issues">${counts[sev]}</span>`;
            }
            return '';
        }).join('');
    }

    const filter = $('#severityFilter').value || 'all';
    const box = $(targetSel || '#issues');
    box.innerHTML = '';

    const rank = { info: 1, warn: 2, error: 3, critical: 4 };
    const filterRankMap = { 'critical': 4, 'error': 3, 'warn': 2, 'info': 1 };
    const filterRank = filterRankMap[filter.split(' ')[0]] || 0;

    const filteredIssues = issues.filter(it => {
        if (filter === 'all') return true;
        if (filter === 'info') return it.sev === 'info';
        return rank[it.sev] >= filterRank;
    });

    if (!filteredIssues.length) {
        const ok = document.createElement('div');
        ok.className = 'issue sev-info';
        ok.innerHTML = '<span class="msg">No validation issues for this filter.</span>';
        box.appendChild(ok);
        return;
    }

    const groups = new Map();
    for (const it of filteredIssues) {
        if (!groups.has(it.msg)) {
            groups.set(it.msg, []);
        }
        groups.get(it.msg).push(it);
    }

    for (const [msg, items] of groups) {
        const details = document.createElement('details');
        details.open = true; // Open by default

        const firstItem = items[0];
        const sev = firstItem.sev;
        const hasFix = items.some(it => it.hasFix);

        const summary = document.createElement('summary');
        summary.className = `issue sev-${sev}`;
        summary.style.display = 'grid';
        summary.style.gridTemplateColumns = '1fr auto';
        summary.style.alignItems = 'center';

        const badge = `<span class="badge" style="background:var(--${sev});color:white;margin-left:8px;border-radius:6px;padding:2px 6px;font-size:0.8em;">${items.length}</span>`;
        const fixButtonGroup = hasFix && !targetSel && items.length > 1 ? `<button class="btn small fix-btn" data-fix-group="${esc(msg)}">Fix All</button>` : '';

        summary.innerHTML = `
            <div class="msg">${esc(msg)} ${badge}</div>
            <div class="actions">${fixButtonGroup}</div>
        `;

        details.appendChild(summary);

        const list = document.createElement('div');
        list.style.paddingLeft = '20px';
        list.style.borderTop = '1px solid var(--line)';
        list.style.paddingTop = '8px';
        list.style.marginTop = '4px';


        for (const it of items) {
            const row = document.createElement('div');
            row.className = 'row';
            row.style.justifyContent = 'space-between';
            const taskName = it.taskId ? (project.tasks.find(t => t.id === it.taskId)?.name || it.taskId) : 'Project-wide';
            const fixBtn = it.hasFix && !targetSel ? `<button class="btn small fix-btn" data-i="${it.id}">Fix</button>` : '';
            row.innerHTML = `
                <span class="meta" style="cursor:pointer; text-decoration:underline;" data-task-id="${it.taskId}">Task: ${esc(taskName)}</span>
                <div class="actions">${fixBtn}</div>
            `;
            list.appendChild(row);
        }
        details.appendChild(list);
        box.appendChild(details);
    }

    if (!targetSel) {
        box.onclick = (e) => {
            const b = e.target.closest('.fix-btn');
            if (b) {
              e.preventDefault();
              const groupId = b.dataset.fixGroup;
              if (groupId) {
                  const itemsToFix = issues.filter(it => it.msg === groupId && it.hasFix);
                  let fixedCount = 0;
                  itemsToFix.forEach(it => { const fn = FIX[it.id]; if (typeof fn === 'function') { fn(); fixedCount++; } });
                  if (fixedCount > 0) { showToast(`Applied ${fixedCount} fix(es).`); refresh(); }
              } else {
                  const id = b.dataset.i;
                  const fn = FIX[id];
                  if (typeof fn === 'function') { fn(); showToast('Applied fix'); refresh(); }
              }
              return;
            }

            const taskLink = e.target.closest('[data-task-id]');
            if (taskLink) {
              e.preventDefault();
              const taskId = taskLink.dataset.taskId;
              if (taskId) {
                selectOnly(taskId);
                refresh();
                const bar = document.querySelector(`.bar[data-id="${taskId}"]`);
                if (bar) {
                  bar.scrollIntoView({behavior: 'smooth', block: 'center'});
                  bar.style.transition = 'outline 0.1s';
                  bar.style.outline = '2px solid var(--accent)';
                  setTimeout(() => bar.style.outline = '', 1000);
                }
              }
            }
        };

        $('#btnAutoFix').onclick = () => {
            let fixedCount = 0;
            for (const it of issues) {
                if (it.hasFix && rank[it.sev] >= 3) {
                    const fn = FIX[it.id];
                    if (typeof fn === 'function') { fn(); fixedCount++; }
                }
            }
            if(fixedCount > 0) {
              showToast(`Auto-fix pass finished, applied ${fixedCount} fixes.`);
              refresh();
            } else {
              showToast('No critical issues to auto-fix.');
            }
        };
    }
}

function renderContextPanel(selectedId) {
  const sidePanel = $('#side');
  if (!selectedId) {
    sidePanel.innerHTML = `<h3>Context</h3><div class="skeleton"></div><p style="text-align:center; color: var(--c-text-muted); padding: var(--space-4) 0;">No task selected.</p>`;
    return;
  }

  if (!lastCPMResult) {
    sidePanel.innerHTML = `<h3>Context</h3><div class="skeleton"></div><p style="text-align:center; color: var(--c-text-muted); padding: var(--space-4) 0;">Calculating...</p>`;
    return;
  }
  const project = SM.get();
  const cpm = lastCPMResult;
  const task = cpm.tasks.find(t => t.id === selectedId);

  if (!task) {
    sidePanel.innerHTML = `<h3>Context</h3><div class="skeleton"></div><p style="text-align:center; color: var(--c-text-muted); padding: var(--space-4) 0;">Task details not available.</p>`;
    return;
  }

  const duration = parseDurationStrict(task.duration).days || 0;
  const deps = normalizeDeps(task).map(d => stringifyDep(d)).join(', ') || 'None';
  const activeBtnText = task.active !== false ? 'Deactivate' : 'Activate';

  const html = `
    <h3 class="flex justify-between items-center" style="margin-bottom: var(--space-4);">
      <span>Task Details</span>
      ${task.critical ? '<span class="badge" style="background:var(--crit); color:white;">Critical</span>' : ''}
    </h3>
    <div class="context-panel-content" aria-live="polite">
      <div class="card" style="margin-bottom: var(--space-4);">
        <div class="card-content">
          <div class="card-label" style="font-weight: 700; color: var(--c-text); margin-bottom: var(--space-1);">${esc(task.name)}</div>
          <code style="color: var(--c-text-muted); font-size: 0.8em;">ID: ${esc(task.id)}</code>
        </div>
      </div>

      <div class="list" style="display: grid; gap: var(--space-2); margin-bottom: var(--space-6);">
        <div class="row" style="justify-content: space-between;"><strong>Duration</strong> <span class="badge">${duration} days</span></div>
        <div class="row" style="justify-content: space-between;"><strong>Slack</strong> <span class="badge">${task.slack} days</span></div>
        <div class="row" style="justify-content: space-between;"><strong>Status</strong> <span>${task.active !== false ? 'Active' : 'Inactive'}</span></div>
        <div class="row" style="flex-direction: column; align-items: flex-start; border-top: 1px solid var(--c-border); padding-top: var(--space-2); margin-top: var(--space-2);">
          <strong>Dependencies</strong>
          <code style="word-break: break-all; background: var(--c-bg); padding: var(--space-2); border-radius: var(--radius-sm); margin-top: var(--space-1); width: 100%;">${esc(deps)}</code>
        </div>
      </div>

      <h4 style="font-size: 0.9em; text-transform: uppercase; color: var(--c-text-muted); border-bottom: 1px solid var(--c-border); padding-bottom: var(--space-1); margin-bottom: var(--space-3);">CPM Timings (days)</h4>
      <div class="cards" style="grid-template-columns: 1fr 1fr; gap: var(--space-2); font-size: var(--font-size-sm); margin-bottom: var(--space-6);">
          <div class="card metric-card" style="padding: var(--space-2); text-align: center;"><div class="card-content"><div class="card-label">ES</div><div class="metric" style="font-size: 1.2rem;">${task.es}</div></div></div>
          <div class="card metric-card" style="padding: var(--space-2); text-align: center;"><div class="card-content"><div class="card-label">EF</div><div class="metric" style="font-size: 1.2rem;">${task.ef}</div></div></div>
          <div class="card metric-card" style="padding: var(--space-2); text-align: center;"><div class="card-content"><div class="card-label">LS</div><div class="metric" style="font-size: 1.2rem;">${task.ls}</div></div></div>
          <div class="card metric-card" style="padding: var(--space-2); text-align: center;"><div class="card-content"><div class="card-label">LF</div><div class="metric" style="font-size: 1.2rem;">${task.lf}</div></div></div>
      </div>

      <div id="context-panel-warnings"></div>

      <h4 style="font-size: 0.9em; text-transform: uppercase; color: var(--c-text-muted); border-bottom: 1px solid var(--c-border); padding-bottom: var(--space-1); margin-bottom: var(--space-3);">Actions</h4>
      <div class="button-group" style="display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-2);">
        <button class="btn" id="ctx-btn-edit" title="Focus the editor fields for this task in the left sidebar">Edit</button>
        <button class="btn" id="ctx-btn-duplicate">Duplicate</button>
        <button class="btn" id="ctx-btn-toggle-active">${activeBtnText}</button>
        <button class="btn error" id="ctx-btn-delete">Delete</button>
      </div>
    </div>
  `;
  sidePanel.innerHTML = html;

  // Render warnings into their dedicated container
  const { issues } = collectIssues(project, cpm);
  const taskIssues = issues.filter(it => it.taskId === selectedId);
  const warningsContainer = sidePanel.querySelector('#context-panel-warnings');

  if (taskIssues.length > 0 && warningsContainer) {
      warningsContainer.innerHTML = `
        <h4 style="font-size: 0.9em; text-transform: uppercase; color: var(--c-text-muted); border-bottom: 1px solid var(--c-border); padding-bottom: var(--space-1); margin-bottom: var(--space-3); margin-top: var(--space-6);">Warnings for this Task</h4>
        <div class="issues" style="margin:0; padding:0; max-height: 150px; overflow-y: auto;">
            ${taskIssues.map(it => `
                <div class="issue sev-${it.sev}" style="margin-bottom: var(--space-2);">
                    <div class="msg">${esc(it.msg)}</div>
                </div>
            `).join('')}
        </div>
      `;
  }


  // Add event listeners for the buttons.
  $('#ctx-btn-edit').addEventListener('click', () => {
    selectOnly(task.id);
    refresh(); // to make sure inline editor is rendered
    const inlineEditor = $('#inlineEdit');
    if (inlineEditor) {
      inlineEditor.scrollIntoView({ behavior: 'smooth', block: 'center' });
      inlineEditor.style.transition = 'none';
      inlineEditor.style.backgroundColor = 'var(--accent-light)';
      setTimeout(() => {
          inlineEditor.style.transition = 'background-color 0.5s';
          inlineEditor.style.backgroundColor = '';
      }, 500);
    }
  });

  $('#ctx-btn-duplicate').addEventListener('click', () => {
    selectOnly(task.id);
    duplicateSelected();
  });

  $('#ctx-btn-toggle-active').addEventListener('click', () => {
    const currentStatus = task.active !== false;
    SM.updateTask(task.id, { active: !currentStatus }, { name: currentStatus ? 'Deactivate Task' : 'Activate Task' });
    refresh();
  });

  $('#ctx-btn-delete').addEventListener('click', () => {
    if (confirm(`Are you sure you want to delete task "${task.name}"?`)) {
      selectOnly(task.id);
      deleteSelected();
    }
  });
}

function renderTasksTable(project, cpm){
  const tbody = $('#tasksTable tbody');
  if(!tbody) return;
  tbody.innerHTML = '';
  if(!cpm) return;
  for(const t of cpm.tasks){
    const dur = parseDurationStrict(t.duration).days || 0;
    const deps = normalizeDeps(t).map(d=>d.pred).join(', ');
    const critical = t.critical || t.slack === 0;
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${esc(t.id)}</td>
      <td>${esc(t.name||'')}</td>
      <td>${dur}</td>
      <td>${esc(deps)}</td>
      <td>${esc(t.subsystem||'')}</td>
      <td>${esc(t.phase||'')}</td>
      <td>${t.pct != null ? esc(String(t.pct)) : ''}</td>
      <td>${critical? '✓' : ''}</td>
      <td>${dur===0? '✓' : ''}</td>`;
    tbody.appendChild(tr);
  }
}

// ----------------------------[ SCENARIO MANAGEMENT ]----------------------------
// Handles creating, switching, and comparing different project scenarios.
// -------------------------------------------------------------------------------
const SC=(function(){
  const scenarios={}; let current='Working';
  function snapshot(){ return SM.get(); }
  function saveAs(name){ scenarios[name]=clone(snapshot()); current=name; updateScenarioUI(); showToast(`Saved as "${name}"`); }
  function switchTo(name){ if(!scenarios[name]) return; SM.set(clone(scenarios[name]), {name: `Switch to ${name}`}); current=name; updateScenarioUI(); showToast(`Switched to "${name}"`); }
  function get(name){ return scenarios[name]? clone(scenarios[name]): null; }
  function list(){ return Object.keys(scenarios); }
  return {saveAs, switchTo, get, list, current:()=>current};
})();
function updateScenarioUI(){
  const sel=$('#scenarioSelect');
  if(sel){
    sel.innerHTML='';
    const items=SC.list();
    for(const name of items){
      const opt=document.createElement('option'); opt.value=name; opt.textContent=name; sel.appendChild(opt);
    }
    const badge=$('#scenarioBadge'); if(badge) badge.textContent = `Scenario: ${SC.current()}`;
  }
}
function updateBaselineUI(){
  const sel=$('#baselineSelect');
  if(sel){
    sel.innerHTML='';
    const items=SM.listBaselines();
    for(const b of items){
      const opt=document.createElement('option'); opt.value=b.id; opt.textContent=b.name; sel.appendChild(opt);
    }
  }
}
let CURRENT_BASELINE=null;
function buildCompare(){
  const baseProj=CURRENT_BASELINE? SM.getBaseline(CURRENT_BASELINE): null;
  const curProj=SM.get();
  const L=$('#cmpList');
  if(!baseProj){
    $('#cmpFinishA').textContent='—';
    $('#cmpFinishB').textContent='—';
    $('#cmpFinishDelta').textContent='—';
    $('#cmpCritDelta').textContent='—';
    L.innerHTML='<div class="issue sev-info"><div class="msg">Select a baseline.</div></div>';
    return;
  }
  if (!lastCPMResult) {
    L.innerHTML='<div class="issue sev-info"><div class="msg">Calculating current project...</div></div>';
    return;
  }
  const B=lastCPMResult;
  const calB=makeCalendar(curProj.calendar, new Set(curProj.holidays||[]));
  const finishB=fmtDate(calB.add(parseDate(curProj.startDate), B.finishDays||0));
  $('#cmpFinishB').textContent=finishB;
  const A=computeCPM(baseProj); // This is a temporary solution for the baseline
  const calA=makeCalendar(baseProj.calendar, new Set(baseProj.holidays||[]));
  const finishA=fmtDate(calA.add(parseDate(baseProj.startDate), A.finishDays||0));
  const delta=(B.finishDays||0)-(A.finishDays||0);
  const critA=new Set(A.tasks.filter(t=>t.critical).map(t=>t.id));
  const critB=new Set(B.tasks.filter(t=>t.critical).map(t=>t.id));
  const critDelta=Math.abs(critA.size-critB.size);
  $('#cmpFinishA').textContent=finishA;
  $('#cmpFinishDelta').textContent=String(delta);
  $('#cmpCritDelta').textContent=String(critDelta);
  L.innerHTML='';
  const meta=SM.listBaselines().find(b=>b.id===CURRENT_BASELINE);
  const header=document.createElement('div');
  header.className='issue sev-info';
  header.innerHTML=`<div class="msg"><b>${esc(meta?meta.name:'Baseline')}</b> • Δfinish ${delta}d • Δcritical ${critDelta}</div>`;
  L.appendChild(header);
  const mapA=Object.fromEntries(A.tasks.map(t=>[t.id,t]));
  const mapB=Object.fromEntries(B.tasks.map(t=>[t.id,t]));
  const rows=[];
  for(const id of Object.keys(mapB)){
    const a=mapA[id]; const b=mapB[id]; if(!b) continue;
    const ds=(b.es||0)-(a? a.es||0:0);
    const df=(b.ef||0)-(a? a.ef||0:0);
    const dsl=(b.slack||0)-(a? a.slack||0:0);
    rows.push({name:b.name||id, ds, df, dsl});
  }
  rows.sort((x,y)=> Math.abs(y.df)-Math.abs(x.df));
  rows.forEach(r=>{
    const div=document.createElement('div');
    div.className='row';
    div.innerHTML=`<span>${esc(r.name)}</span><span class="slack">Δstart ${r.ds}d • Δfinish ${r.df}d • Δslack ${r.dsl}d</span>`;
    L.appendChild(div);
  });
}


// ----------------------------[ DATA IMPORT/EXPORT ]----------------------------
// Functions for handling file I/O, including saving/loading projects and CSV export.
// ------------------------------------------------------------------------------------
async function saveFile(json){ const blob=new Blob([json],{type:'application/json'}); if(window.showSaveFilePicker){ try{ const handle=await showSaveFilePicker({suggestedName:'project.hpc.json', types:[{description:'JSON', accept:{'application/json':['.json']}}]}); const w=await handle.createWritable(); await w.write(blob); await w.close(); return; }catch(e){ console.warn(e);} } const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='project.hpc.json'; a.click(); URL.revokeObjectURL(a.href); }
async function openFile(){ if(window.showOpenFilePicker){ try{ const [h]=await showOpenFilePicker({types:[{description:'JSON/CSV', accept:{'application/json':['.json'],'text/csv':['.csv']}}]}); const f=await h.getFile(); const txt=await f.text(); return f.name.endsWith('.csv')? csvToProject(txt) : JSON.parse(txt); }catch(e){ console.warn(e);} } return new Promise((res)=>{ const inp=document.createElement('input'); inp.type='file'; inp.accept='.json,.csv'; inp.onchange=async()=>{ const f=inp.files[0]; const txt=await f.text(); if(f.name.endsWith('.csv')) res(csvToProject(txt)); else res(JSON.parse(txt)); }; inp.click(); }); }
function exportCSV(){ const rows=[['id','name','duration(d)','deps','phase','subsystem']]; for(const t of SM.get().tasks){ if(t.active===false) continue; rows.push([t.id,t.name,parseDurationStrict(t.duration).days||0, (t.deps||[]).join(' '), t.phase||'', t.subsystem||''].map(x=>`"${String(x).replaceAll('"','""')}"`)); } const csv=rows.map(r=>r.join(',')).join('\n'); const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv'})); a.download='project.csv'; a.click(); URL.revokeObjectURL(a.href); }
function csvToProject(csv){ const lines=csv.trim().split(/\r?\n/); const [header,...rows]=lines; const idx=(k)=> header.split(',').map(s=>s.replace(/\W+/g,'').toLowerCase()).indexOf(k.toLowerCase()); const iId=idx('id'), iName=idx('name'), iDur=idx('durationd'), iDeps=idx('deps'), iPhase=idx('phase'), iSub=idx('subsystem'); const tasks=rows.map(r=>{ const cols=r.match(/\"([^\"]|\"\")*\"|[^,]+/g).map(s=>s.replace(/^\"|\"$/g,'').replaceAll('""','"')); const d=parseDurationStrict(+cols[iDur]||cols[iDur]||''); return { id: cols[iId]||uid('t'), name: cols[iName], duration: d.error? 1 : d.days, deps: (cols[iDeps]||'').split(/[\s;]/).filter(Boolean), phase: cols[iPhase]||'', subsystem: cols[iSub]||'System', active:true }; }); return {startDate: todayStr(), calendar: 'workdays', holidays:[], tasks}; }

// ----------------------------[ UI: SELECTION & BULK EDIT ]----------------------------
// Manages task selection, including multi-select and bulk editing operations.
// ------------------------------------------------------------------------------------
const SEL=new Set();
let LAST_SEL=null;
const debouncedRefresh = debounce(refresh, 50);
function updateSelectionUI(){
  document.querySelectorAll('.bar, .node').forEach(el=>{
    const id=el.getAttribute('data-id');
    el.classList.toggle('selected', SEL.has(id));
  });
  renderContextPanel(LAST_SEL);
  updateSelBadge();
}
function toggleSelect(id){
  if(SEL.has(id)){
    SEL.delete(id);
    if(LAST_SEL===id) LAST_SEL=null;
  }else{
    SEL.add(id);
    LAST_SEL=id;
  }
  updateSelectionUI();
  debouncedRefresh();
}
function selectOnly(id){
  SEL.clear();
  SEL.add(id);
  LAST_SEL=id;
  updateSelectionUI();
  debouncedRefresh();
}
function moveSelection(dir){
  const tasks=SM.get().tasks.filter(matchesFilters);
  if(!tasks.length) return;
  let idx=tasks.findIndex(t=>t.id===LAST_SEL);
  if(idx===-1) idx = dir>0?0:tasks.length-1;
  else idx=(idx+dir+tasks.length)%tasks.length;
  selectOnly(tasks[idx].id);
}
function deleteSelected(){
  if(!SEL.size) return;
  const ids=new Set(SEL);
  const s=SM.get();
  const remaining=s.tasks.filter(t=>!ids.has(t.id));
  for(const t of remaining){
    if(t.deps){
      t.deps=t.deps.filter(tok=>{
        const e=parseDepToken(tok);
        return !(e && ids.has(e.pred));
      });
    }
  }
  SM.replaceTasks(remaining, {name: `Delete ${ids.size} Task(s)`});
  clearSelection();
  showToast(`Deleted ${ids.size} task${ids.size>1?'s':''}`);
  refresh();
}
function duplicateSelected(){
  if(!SEL.size) return;
  const s=SM.get();
  const tasks=[...s.tasks];
  const ids=new Set(tasks.map(t=>t.id));
  const originals=tasks.filter(t=>SEL.has(t.id));
  const mapOldToNew=new Map();
  const clones=[];
  for(const t of originals){
    let id=t.id+'_copy';
    while(ids.has(id)) id=uid('t');
    ids.add(id);
    const clone=JSON.parse(JSON.stringify(t));
    clone.id=id;
    clone.name=(t.name||t.id)+' (copy)';
    mapOldToNew.set(t.id,id);
    clones.push(clone);
  }
  for(const c of clones){
    if(c.deps){
      c.deps=c.deps.map(tok=>{
        const e=parseDepToken(tok);
        if(!e) return tok;
        if(mapOldToNew.has(e.pred)) e.pred=mapOldToNew.get(e.pred);
        return stringifyDep(e);
      });
    }
  }
  for(let i=originals.length-1;i>=0;i--){
    const idx=tasks.findIndex(t=>t.id===originals[i].id);
    tasks.splice(idx+1,0,clones[i]);
  }
  SM.replaceTasks(tasks, {name: `Duplicate ${clones.length} Task(s)`});
  SEL.clear();
  clones.forEach(c=>SEL.add(c.id));
  LAST_SEL=clones.length?clones[clones.length-1].id:null;
  updateSelBadge();
  showToast(`Duplicated ${clones.length} task${clones.length>1?'s':''}`);
  refresh();
}
  function clearSelection(){ SEL.clear(); LAST_SEL=null; updateSelectionUI(); debouncedRefresh(); }
function renderInlineEditor(){ const box=$('#inlineEdit'); if(!box) return; box.innerHTML=''; if(SEL.size===0) return; const s=SM.get();
  for(const id of SEL){ const t=s.tasks.find(x=>x.id===id); if(!t) continue; const row=document.createElement('div'); row.className='row';
    const dur=parseDurationStrict(t.duration).days||0;
    row.innerHTML=`<input type="text" data-id="${id}" data-field="name" value="${esc(t.name)}">
      <input type="number" min="0" data-id="${id}" data-field="duration" value="${dur}">
      <input type="number" min="0" max="100" data-id="${id}" data-field="pct" value="${t.pct||0}">
      <input type="text" data-id="${id}" data-field="phase" value="${esc(t.phase||'')}">
      <select data-id="${id}" data-field="subsystem">${SUBS.map(sub=>`<option${sub===t.subsystem?' selected':''}>${esc(sub)}</option>`).join('')}</select>
      <select data-id="${id}" data-field="active"><option value="true"${t.active!==false?' selected':''}>true</option><option value="false"${t.active===false?' selected':''}>false</option></select>`;
    box.appendChild(row);
  }
  box.querySelectorAll('input,select').forEach(inp=>{ inp.addEventListener('change',()=>{ const id=inp.dataset.id; const field=inp.dataset.field; let val=inp.value; if(field==='duration') val=parseInt(val,10)||0; else if(field==='active') val=(val==='true'); else if(field==='pct') val=Math.min(100, Math.max(0, parseInt(val,10)||0)); SM.updateTask(id,{[field]:val}, {name: `Edit ${field}`}); refresh(); }); });
}
window.renderInlineEditor = renderInlineEditor;
  function updateSelBadge(){
    $('#selBadge').textContent = `${SEL.size} selected`;
    $('#bulkCount').textContent=String(SEL.size);
    $('#inlineCount') && ($('#inlineCount').textContent=String(SEL.size));
    renderInlineEditor();
  }
function applyBulk(){ if(SEL.size===0){ showToast('Select some tasks first'); return; } const s=SM.get(); const ids=new Set(SEL); let changed=0; for(const t of s.tasks){ if(!ids.has(t.id)) continue; changed++; const phase=$('#bulkPhase').value.trim(); if(phase) t.phase=phase; const sub=$('#bulkSub').value; if(sub) t.subsystem=sub; const act=$('#bulkActive').value; if(act!=='') t.active=(act==='true'); const pfx=$('#bulkPrefix').value||''; if(pfx) t.name=pfx+' '+(t.name||''); const addDep=$('#bulkAddDep').value.trim(); if(addDep){ t.deps=(t.deps||[]).concat([addDep]); }
    if($('#bulkClearDeps').checked) t.deps=[];
    const durV=$('#bulkDur').value; if(durV!==''){ const n=parseInt(durV,10)||0; if($('#bulkDurMode').value==='set') t.duration=n; else t.duration=Math.max(0, parseDurationStrict(t.duration).days + n); }
    const shift=$('#bulkShift').value; if(shift!==''){ const d=parseInt(shift,10)||0; const es = t.es||0; t.startConstraint = {type:'SNET', day: Math.max(0, es + d)}; }
    const pctV=$('#bulkPct').value; if(pctV!==''){ const n=Math.min(100, Math.max(0, parseInt(pctV,10)||0)); t.pct=n; }
  }
  SM.replaceTasks(s.tasks, {name: `Bulk Edit ${changed} task(s)`}); showToast(`Bulk applied to ${changed} tasks`); refresh(); }

// ----------------------------[ TEMPLATES ]----------------------------
// Functions for inserting predefined sets of tasks (templates) into the project.
// ---------------------------------------------------------------------------
function insertTemplate(which){ const lib = templateLib(which); const s=SM.get(); const base = slug(which)+'_'; const used=new Set(s.tasks.map(t=>t.id)); const toAdd=lib.map((t,i)=>{ let id = (t.id||uid('t')); if(used.has(id)) id = base + id; while(used.has(id)) id=base+uid('t'); used.add(id); return {...t, id}; });
  // Remap dependencies if they reference other tasks within the template
  const mapOldToNew = new Map(lib.map((t,i)=>[t.id, toAdd[i].id]));
  toAdd.forEach((t,i)=>{ if(t.deps){ t.deps = t.deps.map(tok=>{ const e=parseDepToken(tok); if(!e) return tok; if(mapOldToNew.has(e.pred)) e.pred = mapOldToNew.get(e.pred); return stringifyDep(e); }); }
  });
  SM.addTasks(toAdd, {name: `Insert ${which} Template`}); showToast(`Inserted ${toAdd.length} tasks from ${which}`); }

// ----------------------------[ UI ORCHESTRATION ]----------------------------
// Functions that manage the overall UI, set up event listeners, and orchestrate updates.
// ------------------------------------------------------------------------------------
function setupLegend(){ const box=$('#subsysFilters'); box.innerHTML=''; SUBS.forEach(name=>{ const cls=slug(name).replace('_',''); const div=document.createElement('label'); div.className='tag'; div.innerHTML=`<input type="checkbox" checked value="${name}"><span class=\"dot ${cls}\" style="background:${colorFor(name)}"></span> ${name}`; box.appendChild(div); }); $('#btnSubAll').onclick=()=> $$('#subsysFilters input[type="checkbox"]').forEach(c=>c.checked=true);
  $('#btnSubNone').onclick=()=> $$('#subsysFilters input[type="checkbox"]').forEach(c=>c.checked=false); $$('#subsysFilters input[type="checkbox"]').forEach(c=> c.onchange=refresh); }
function parseHolidaysInput(){ const raw=$('#holidayInput').value||''; const tokens=raw.split(/[\s,]+/).filter(Boolean); const out=[]; for(const t of tokens){ const m=t.match(/^\d{2}-\d{2}-\d{4}$/); if(m){ out.push(t); } }
  return out; }

function triggerCPM(project) {
    if (!cpmWorker) {
        console.error("CPM Worker not initialized.");
        return;
    }

    // Cancel any pending request to ensure we are always computing the latest state.
    if (cpmRequestActive) {
        // A simple way to handle this is to just ignore the new request,
        // but a better way is to have a "next_request" flag.
        // For now, we'll let the current one finish and the user can trigger another.
        // This avoids race conditions.
        return;
    }

    cpmRequestActive = true;
    const statusBadge = $('#cpmStatusBadge');
    if(statusBadge) statusBadge.style.display = 'inline-flex';

    cpmWorker.postMessage({ type: 'compute', project: clone(project) });
}

function renderAll(project, cpm) {
    if (!cpm) return;
    renderGantt(project, cpm);
    // The graph is now rendered lazily, so we don't render it here on every update.
    // if ($('.tab[data-tab="graph"]').classList.contains('active')) {
    //     renderGraph(project, cpm);
    // }
      renderFocus(project, cpm);
      renderIssues(project, cpm);
      renderContextPanel(LAST_SEL);
      $('#boot').style.display='none';
      $('#appRoot').style.display='grid';
      const activeTab = $('.tab.active').dataset.tab;
      if(activeTab==='compare') buildCompare();
      if(activeTab==='tasks') renderTasksTable(project, cpm);
  }

function refresh(){
    triggerCPM(SM.get());
}

function newProject(){
    SM.set({startDate: todayStr(), calendar:'workdays', holidays:[], tasks:[]}, {name: 'New Project'});
    $('#startDate').value=todayStr();
    $('#calendarMode').value='workdays';
    $('#holidayInput').value='';
    clearSelection();
    refresh();
}

// ----------------------------[ APPLICATION BOOTSTRAP ]----------------------------
// Main entry point of the application. Initializes the UI and sets up event listeners.
// -------------------------------------------------------------------------------------
window.addEventListener('DOMContentLoaded', ()=>{
  if (UI_FLAGS.topSettingsToolbar) {
    document.body.classList.add('top-toolbar');
  }
  const ss = SettingsStore.get();
  $('#slackThreshold').value = ss.slackThreshold;
  $('#filterText').value = ss.filters.text;
  $('#groupBy').value = ss.filters.groupBy;
  $('#calendarMode').value = ss.calendar.mode;
  $('#startDate').value = ss.calendar.startDate;
  $('#holidayInput').value = (ss.calendar.holidays || []).join(', ');
  SettingsStore.on('settings:changed', ()=> refresh());
  SettingsStore.on('filters:changed', ()=> refresh());
  try{
    if (window.Worker) {
        cpmWorker = createCPMWorker();

        cpmWorker.onmessage = function(e) {
            if (e.data.type === 'result') {
                cpmRequestActive = false;
                const statusBadge = $('#cpmStatusBadge');
                if(statusBadge) statusBadge.style.display = 'none';

                lastCPMResult = e.data.cpm;
                SM.setCPMWarnings(lastCPMResult.warnings || []);

                const s = SM.get();
                renderAll(s, lastCPMResult);
            }
        };

        cpmWorker.onerror = function(error) {
            console.error("CPM Worker Error:", error);
            cpmRequestActive = false;
            const statusBadge = $('#cpmStatusBadge');
            if(statusBadge) {
                statusBadge.textContent = 'Error!';
                statusBadge.style.backgroundColor = 'var(--error)';
            }
        };
    } else {
        console.error("Web Workers are not supported in this browser.");
        // Fallback or error message could be implemented here.
    }

    // Fallback for browsers that do not support input[type="date"]
    (function() {
      var input = document.createElement('input');
      input.setAttribute('type', 'date');
      var notADateValue = 'not-a-date';
      input.setAttribute('value', notADateValue);
      if (input.value === notADateValue) {
        var startDateInput = document.getElementById('startDate');
        if (startDateInput) {
          startDateInput.setAttribute('type', 'text');
          startDateInput.setAttribute('placeholder', 'DD-MM-YYYY');
          startDateInput.setAttribute('pattern', '\\d{2}-\\d{2}-\\d{4}');
        }
      }
    })();

    setupLegend();
    // seed with sample HPC flow
    const saved = localStorage.getItem('hpc-project-planner-data');
    if (saved) {
      try {
        const project = JSON.parse(saved);
        SM.set(project, {record: false, noSave: true});
        const lastSavedBadge = $('#lastSavedBadge');
        if (lastSavedBadge) {
          lastSavedBadge.innerHTML = `<span class="pill-icon" aria-hidden="true">💾</span> Loaded from storage`;
        }
        showToast('Loaded project from last session.');
      } catch (e) {
        console.warn('Failed to parse saved data, starting fresh.', e);
        SM.set({startDate: todayStr(), calendar:'workdays', holidays:[], tasks: templateHPC()},{record:false, name: 'Load Sample Project'});
      }
    } else {
      SM.set({startDate: todayStr(), calendar:'workdays', holidays:[], tasks: templateHPC()},{record:false, name: 'Load Sample Project'});
    }

    // Sync UI to loaded state, which also handles empty/missing start date
    const loadedState = SM.get();
    $('#startDate').value = ddmmyyyy_to_yyyymmdd(loadedState.startDate || todayStr());
    $('#calendarMode').value = loadedState.calendar || 'workdays';
    $('#holidayInput').value = (loadedState.holidays || []).join(', ');

    refresh();

    // reactive
    SM.onChange(()=>{ $('#btnUndo').disabled=!SM.canUndo(); $('#btnRedo').disabled=!SM.canRedo(); updateSelBadge(); });

    // tabs
      $$('.tab').forEach(t=> t.onclick=()=>{
          $$('.tab').forEach(x=>x.classList.remove('active'));
          t.classList.add('active');
          $$('.view').forEach(v=>v.classList.remove('active'));
          const viewId = t.dataset.tab;
          $('#'+viewId).classList.add('active');

        if (viewId === 'graph' && !graphInitialized) {
            if (lastCPMResult) {
                renderGraph(SM.get(), lastCPMResult);
                graphInitialized = true;
            } else {
                $('#graphSvg').innerHTML = '<text x="50%" y="50%" text-anchor="middle">Calculating graph data...</text>';
                refresh();
            }
        }

          if(viewId==='compare') {
              buildCompare();
          }
          if(viewId==='tasks') {
              renderTasksTable(SM.get(), lastCPMResult);
          }
      });

    // controls
    $('#slackThreshold').onchange = ()=>{ SettingsStore.set({slackThreshold: parseInt($('#slackThreshold').value,10)||0}); refresh(); };
    $('#calendarMode').onchange = ()=>{ SM.setProjectProps({calendar: $('#calendarMode').value}, {name: 'Change Calendar'}); SettingsStore.setCalendar({mode: $('#calendarMode').value}); refresh(); };
    const startDateInput = $('#startDate');
    const startDateError = $('#startDateError');

    function handleStartDateChange() {
      let value = startDateInput.value;
      if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        value = yyyymmdd_to_ddmmyyyy(value);
      }
      const dateRegex = /^\d{2}-\d{2}-\d{4}$/;

      const d = parseDate(value);
      if (!dateRegex.test(value) || fmtDate(d) !== value) {
        startDateError.textContent = 'Invalid date. Please use DD-MM-YYYY format for a valid date.';
        startDateError.style.display = 'block';
        startDateInput.classList.add('error');
        return;
      }

      startDateError.style.display = 'none';
      startDateInput.classList.remove('error');
      SM.setProjectProps({startDate: value}, {name: 'Change Start Date'});
      SettingsStore.setCalendar({startDate: startDateInput.value});
      refresh();
    }

    startDateInput.addEventListener('change', handleStartDateChange);
    startDateInput.addEventListener('blur', handleStartDateChange);
    $('#holidayInput').onchange = ()=>{ SM.setProjectProps({holidays: parseHolidaysInput()}, {name: 'Update Holidays'}); SettingsStore.setCalendar({holidays: parseHolidaysInput()}); refresh(); };
    $('#severityFilter').onchange = ()=>{ renderIssues(SM.get(), lastCPMResult); };
    $('#filterText').oninput = ()=>{ SettingsStore.setFilters({text: $('#filterText').value}); refresh(); };
    $('#groupBy').onchange = ()=>{ SettingsStore.setFilters({groupBy: $('#groupBy').value}); refresh(); };
    $('#btnFilterClear').onclick=()=>{ $('#filterText').value=''; SettingsStore.setFilters({text: ''}); $$('#subsysFilters input[type="checkbox"]').forEach(c=>c.checked=true); refresh(); };
    $('#btnSelectFiltered').onclick=()=>{ if(!lastCPMResult) return; const ids=new Set(lastCPMResult.tasks.filter(matchesFilters).map(t=>t.id)); ids.forEach(id=>SEL.add(id)); updateSelBadge(); refresh(); };
    $('#btnClearSel').onclick=()=>{ clearSelection(); refresh(); };

    // bulk
    $('#btnApplyBulk').onclick=applyBulk; $('#btnBulkReset').onclick=()=>{ ['bulkPhase','bulkSub','bulkActive','bulkDur','bulkDurMode','bulkPrefix','bulkPct','bulkAddDep','bulkClearDeps','bulkShift'].forEach(id=>{ const el=document.getElementById(id); if(!el) return; if(el.type==='checkbox') el.checked=false; else if(el.tagName==='SELECT') el.selectedIndex=0; else el.value=''; }); };

    // scenarios
    updateScenarioUI();
    updateBaselineUI();
    $('#scenarioSelect') && ($('#scenarioSelect').onchange=(e)=>{ SC.switchTo(e.target.value); refresh(); });
    $('#btnScenarioNew') && ($('#btnScenarioNew').onclick=()=>{ const name=prompt('New scenario name'); if(!name) return; SC.saveAs(name); refresh(); });
    $('#btnScenarioSaveAs') && ($('#btnScenarioSaveAs').onclick=()=>{ const name=prompt('Save current as…'); if(!name) return; SC.saveAs(name); refresh(); });
    $('#btnOpenCompare') && ($('#btnOpenCompare').onclick=()=>{ $$('.tab').forEach(x=>x.classList.remove('active')); $('[data-tab="compare"]').classList.add('active'); $$('.view').forEach(v=>v.classList.remove('active')); $('#compare').classList.add('active'); buildCompare(); });
    $('#btnUseBaseline') && ($('#btnUseBaseline').onclick=()=>{ const id=$('#baselineSelect').value; CURRENT_BASELINE=id; buildCompare(); });
    $('#btnAddBaseline') && ($('#btnAddBaseline').onclick=()=>{ const name=prompt('Baseline name'); if(!name) return; SM.addBaseline(name); updateBaselineUI(); });

    // I/O
    $('#btnExportCSV').onclick=exportCSV;
    $('#btnExportJSON').onclick=()=>{ const project = SM.get(); project.schemaVersion = SCHEMA_VERSION; const json=JSON.stringify(project, null, 2); const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([json],{type:'application/json'})); a.download='project.json'; a.click(); URL.revokeObjectURL(a.href); };
    $('#btnSave').onclick=()=> { const project = SM.get(); project.schemaVersion = SCHEMA_VERSION; saveFile(JSON.stringify(project, null, 2)); };
    $('#btnLoad').onclick=async()=>{
      const data=await openFile();
      if(!data) return;

      const { ok, errors, warnings, project, migrated } = validateProject(data);

      if (errors.length > 0 || warnings.length > 0) {
        let message = '';
        if (errors.length > 0) {
          message += 'Errors found during import:\n' + errors.map(e => `- ${e.msg}`).join('\\n');
        }
        if (warnings.length > 0) {
          message += '\\n\\nWarnings:\\n' + warnings.map(w => `- ${w.msg}`).join('\\n');
        }

        if (!ok) {
          alert('Import failed!\\n\\n' + message);
          return;
        } else {
          if (!confirm('Project imported with some issues. Import anyway?\\n\\n' + message)) {
            return;
          }
        }
      }

      SM.set(project, {name: 'Load Project'});
      $('#startDate').value=SM.get().startDate;
      $('#calendarMode').value=SM.get().calendar;
      $('#holidayInput').value=(SM.get().holidays||[]).join(', ');
      clearSelection();
      refresh();
      if (migrated) {
        showToast('Project data was migrated to the latest version.');
      } else {
        showToast('Project loaded successfully.');
      }
    };
    $('#btnNew').onclick=newProject; $('#btnPrint').onclick=()=>window.print();
    $('#btnGuide').onclick=()=>document.getElementById('help-modal').style.display = 'flex';

    // theme
    const btnToggleTheme = $('#btnToggleTheme');
    btnToggleTheme.addEventListener('click', () => {
      const html = document.documentElement;
      html.classList.toggle('dark-mode');
      const isDarkMode = html.classList.contains('dark-mode');
      localStorage.setItem('theme', isDarkMode ? 'dark' : 'light');
      btnToggleTheme.querySelector('.btn-icon').textContent = isDarkMode ? '☀️' : '🌙';
    });
    if (document.documentElement.classList.contains('dark-mode')) {
        btnToggleTheme.querySelector('.btn-icon').textContent = '☀️';
    }


    // history
    $('#btnUndo').onclick=()=>{ SM.undo(); refresh(); };
    $('#btnRedo').onclick=()=>{ SM.redo(); refresh(); };
    window.addEventListener('keydown', (e)=>{
      const tag=(e.target.tagName||'').toLowerCase();
      if(e.target.isContentEditable || ['input','textarea','select'].includes(tag)) return;
      const k=e.key;
      if((e.ctrlKey||e.metaKey)&&!e.shiftKey && k.toLowerCase()==='z'){
        e.preventDefault(); SM.undo(); refresh();
      }else if((e.ctrlKey||e.metaKey) && (k.toLowerCase()==='y' || (e.shiftKey && k.toLowerCase()==='z'))){
        e.preventDefault(); SM.redo(); refresh();
      }else if(k==='Delete'){
        e.preventDefault(); deleteSelected();
      }else if((e.ctrlKey||e.metaKey) && k.toLowerCase()==='d'){
        e.preventDefault(); duplicateSelected();
      } else if (e.key === '?' || e.key === 'F1') {
        e.preventDefault();
        const helpModal = document.getElementById('new-help-modal');
        helpModal.style.display = helpModal.style.display === 'flex' ? 'none' : 'flex';
      } else if (e.ctrlKey || e.metaKey) {
        switch(k.toLowerCase()) {
          case 's': e.preventDefault(); $('#btnSave').click(); break;
          case 'o': e.preventDefault(); $('#btnLoad').click(); break;
          case 'p': e.preventDefault(); $('#btnPrint').click(); break;
        }
      }
    });

    // Guide modal
    (function(){ let step=1; const max=5; const modal=$('#guided-workflow'); function showStep(){ for(let i=1;i<=max;i++){ $('#wz'+i).style.display = (i===step)?'block':'none'; } $('#wzPrev').disabled = step===1; $('#wzNext').textContent = step===max? 'Done' : 'Next'; }
      $('#wzPrev').onclick=()=>{ if(step>1) step--; showStep(); };
      $('#wzNext').onclick=()=>{ if(step<max) step++; else modal.style.display='none'; showStep(); };
    })();

    // Zoom/Pan controls
    ZTL=InteractionManager($('#gantt')); const ZGR=InteractionManager($('#graphSvg'));
    $('#zoomInTL').onclick=ZTL.zoomIn; $('#zoomOutTL').onclick=ZTL.zoomOut; $('#zoomResetTL').onclick=ZTL.fit;
    $('#zoomInGR').onclick=ZGR.zoomIn; $('#zoomOutGR').onclick=ZGR.zoomOut; $('#zoomResetGR').onclick=ZGR.fit;

    // View-specific keyboard navigation
    const viewKeydownHandler = (e) => {
      if (['ArrowDown', 'ArrowRight'].includes(e.key)) {
        e.preventDefault();
        moveSelection(1);
      } else if (['ArrowUp', 'ArrowLeft'].includes(e.key)) {
        e.preventDefault();
        moveSelection(-1);
      } else if (e.key === 'Enter') {
        if (LAST_SEL) {
          e.preventDefault();
          const sidePanel = $('#side');
          sidePanel.focus();
          // Flash the panel to give a visual cue
          sidePanel.style.transition = 'none';
          sidePanel.style.boxShadow = '0 0 0 2px var(--c-accent)';
          setTimeout(() => {
            sidePanel.style.transition = 'box-shadow 0.4s ease-out';
            sidePanel.style.boxShadow = '';
          }, 400);
        }
      }
    };
    $('#timeline').addEventListener('keydown', viewKeydownHandler);
    $('#graph').addEventListener('keydown', viewKeydownHandler);

    // Templates
    $('#btnInsertTpl').onclick=()=> {
      insertTemplate($('#tplSelect').value);
      // The SM.addTasks in insertTemplate doesn't trigger a refresh, so force one.
      setTimeout(() => refresh(), 0);
    };
    $('#ctxMenu').onclick=(e)=>{ const act=e.target.dataset.action; const id=$('#ctxMenu').dataset.id; hideContextMenu(); if(!id||!act) return; if(act==='edit'){ selectOnly(id); refresh(); const inp=$('#inlineEdit input'); inp&&inp.focus(); } else if(act==='duplicate'){ selectOnly(id); duplicateSelected(); } else if(act==='delete'){ selectOnly(id); deleteSelected(); } else if(act==='adddep'){ const tok=prompt('Dependency token (e.g. FS:pred+2d)'); if(tok){ const s=SM.get(); const t=s.tasks.find(x=>x.id===id); if(t){ t.deps=(t.deps||[]).concat([tok]); SM.replaceTasks(s.tasks, {name: 'Add Dependency'}); refresh(); } } } };

    // --- Action Menu Handlers ---

    // 1. Export JSON
    $('#action-export-json').addEventListener('click', () => {
      const project = SM.get();
      project.schemaVersion = SCHEMA_VERSION;
      const json = JSON.stringify(project, null, 2);
      const blob = new Blob([json], {type: 'application/json'});
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'project.json';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(a.href);
      showToast('Project data exported to project.json');
    });

    // 2. Import JSON
    $('#action-import-json').addEventListener('click', async () => {
      try {
        const data = await openFile();
        if (!data) return; // User cancelled

        const { ok, errors, warnings, project, migrated } = validateProject(data);

        if (errors.length > 0 || warnings.length > 0) {
          let message = '';
          if (errors.length > 0) {
            message += 'Errors found during import:\\n' + errors.map(e => `- ${e.msg}`).join('\\n');
          }
          if (warnings.length > 0) {
            message += '\\n\\nWarnings:\\n' + warnings.map(w => `- ${w.msg}`).join('\\n');
          }

          if (!ok) {
            alert('Import failed!\\n\\n' + message);
            return;
          } else {
            if (!confirm('Project imported with some issues. Import anyway?\\n\\n' + message)) {
              return;
            }
          }
        }

        SM.set(project, { name: 'Import Project' });

        // Sync UI to new state
        $('#startDate').value = SM.get().startDate;
        $('#calendarMode').value = SM.get().calendar;
        $('#holidayInput').value = (SM.get().holidays || []).join(', ');
        clearSelection();
        refresh();

        if (migrated) {
          showToast('Project data was migrated to the latest version.');
        } else {
          showToast('Project imported successfully.');
        }
      } catch (e) {
        console.error("Import failed:", e);
        showToast('Error: Could not import file.');
        $('#fatal').textContent = `Import Error: ${e.message}. Please ensure the file is valid JSON.`;
        $('#fatal').style.display = 'block';
      }
    });

    // 3. Export PNG
    async function exportGanttToPng() {
      const svg = $('#gantt');
      if (!svg) {
        showToast('Error: Timeline SVG not found.');
        return;
      }
      showToast('Generating PNG...');

      // Clone the SVG to avoid modifying the original
      const svgClone = svg.cloneNode(true);

      // Collect all relevant CSS rules from all stylesheets
      let css = '';
      const selectors = [
        '.gantt', '.bar', '.axis', '.label', '.critical', '.milestone',
        '.progress', '.handle', '.groupHeader', '.groupLabel', '.taskNameBg',
        '#timeline', '.stripes-bg', '.stripes-line'
      ];
      for (const sheet of document.styleSheets) {
          try {
              for (const rule of sheet.cssRules) {
                  if (rule.selectorText && selectors.some(s => rule.selectorText.includes(s))) {
                      css += rule.cssText + '\n';
                  }
              }
          } catch (e) {
              console.warn("Could not read CSS rules from stylesheet:", e);
          }
      }

      // Add a style element to the SVG clone
      const styleEl = document.createElement('style');
      styleEl.textContent = css;
      svgClone.insertBefore(styleEl, svgClone.firstChild);

      const { width, height } = svg.getBoundingClientRect();
      svgClone.setAttribute('width', width);
      svgClone.setAttribute('height', height);

      // Serialize the SVG to a string and create a data URL
      const svgString = new XMLSerializer().serializeToString(svgClone);
      const svgBlob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
      const url = URL.createObjectURL(svgBlob);

      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        // Add padding for better aesthetics
        const padding = 20;
        canvas.width = width + padding * 2;
        canvas.height = height + padding * 2;
        const ctx = canvas.getContext('2d');

        // Fill background with current theme color
        const bgColor = getComputedStyle(document.documentElement).getPropertyValue('--c-bg').trim();
        ctx.fillStyle = bgColor || '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // Draw the SVG image onto the canvas
        ctx.drawImage(img, padding, padding);
        URL.revokeObjectURL(url);

        // Trigger download
        const pngUrl = canvas.toDataURL('image/png');
        const a = document.createElement('a');
        a.href = pngUrl;
        a.download = `timeline-export-${todayStr()}.png`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        showToast('PNG export complete.');
      };
      img.onerror = (err) => {
        console.error("PNG Export: Image loading failed.", err);
        showToast('Error exporting PNG. Check console for details.');
        URL.revokeObjectURL(url);
      };
      img.src = url;
    }
    $('#action-export-png').addEventListener('click', exportGanttToPng);

    // 4. Reset Demo Data
    $('#action-reset-demo').addEventListener('click', () => {
      if (confirm('Are you sure you want to reset to the demo project? All unsaved changes will be lost.')) {
        SM.set({
          startDate: todayStr(),
          calendar: 'workdays',
          holidays: [],
          tasks: templateHPC()
        }, { record: true, name: 'Reset to Demo' });
        refresh();
        showToast('Project has been reset to the demo data.');
      }
    });

    // 5. Toggle Theme
    $('#action-toggle-theme').addEventListener('click', () => {
      $('#toggle-theme').click(); // Reuse existing button's logic
      const isDark = document.documentElement.classList.contains('dark-mode');
      showToast(`Theme switched to ${isDark ? 'Dark' : 'Light'} Mode.`);
    });

    // 6. Help Modal
    $('#btn-help').addEventListener('click', () => {
      const helpModal = document.getElementById('new-help-modal');
      helpModal.style.display = 'flex';
    });

  }catch(err){
    console.error(err);
    const box=$('#fatal'); box.style.display='block'; box.textContent='Startup error:\n'+(err&&err.stack||String(err));
  }
});

// ----------------------------[ DATA TEMPLATES ]----------------------------
// Predefined project templates for various use cases (HPC, Software, Hardware).
// ------------------------------------------------------------------------------
function ensureIds(list){ return list.map(t=>({...t, id:t.id||uid('t'), active: t.active!==false})); }
function w(n){ return n*5; } function d(n){ return n; }
function templateHPC(){ return ensureIds([
  {id:'mobo_assembly', name:'Carte mère assemblée (PCB+ASM)', duration:w(1), subsystem:'System', phase:'EVT L1'},
  {id:'mobo_bringup_air', name:'Bring-up carte mère (à air, pas de méca)', duration:w(8), deps:['mobo_assembly'], subsystem:'power/VRM', phase:'EVT L1'},
  {id:'power_bringup_bench', name:'Bring-up power (banc)', duration:w(4), subsystem:'power/VRM', phase:'EVT L1'},
  {id:'power_full_load', name:'Power en puissance', duration:w(2), deps:['power_bringup_bench'], subsystem:'power/VRM', phase:'EVT L1'},
  {id:'power_rails_validated', name:'Power rails validés (gate)', duration:d(0), deps:['power_full_load'], subsystem:'power/VRM', phase:'EVT L1'},
  {id:'bringup_other_cards', name:'Bring-up autres cartes', duration:w(4), deps:['mobo_bringup_air'], subsystem:'System', phase:'EVT L1'},
  {id:'mech_deliveries', name:'Livraison méca', duration:w(4), subsystem:'Mech', phase:'EVT L1'},
  {id:'first_blade_assembly', name:'1ère lame assembly & corrections méca', duration:w(1), deps:['mech_deliveries','mobo_bringup_air','bringup_other_cards','power_full_load'], subsystem:'System', phase:'EVT L1'},
  {id:'remaining_blades_assembly', name:'Assemblage lames restantes (~5)', duration:w(2), deps:['first_blade_assembly'], subsystem:'System', phase:'EVT L1'},
  {id:'mech_lvl1_lab', name:'Méca L1 labo (WaterBox sans lame)', duration:w(1), deps:['mech_deliveries'], subsystem:'Mech', phase:'EVT L1'},
  {id:'blade_watercool_setup', name:'Setup water cooling', duration:w(1), deps:['remaining_blades_assembly','mech_lvl1_lab'], subsystem:'Thermal', phase:'EVT L2'},
  {id:'l2_integration_evt', name:'L2 tests (intégration lame)', duration:w(3), deps:['blade_watercool_setup'], subsystem:'System', phase:'EVT L2'},
  {id:'bmc_fw_evt', name:'Dev FW BMC (EVT)', duration:w(4), deps:['mobo_bringup_air'], subsystem:'BMC', phase:'EVT L2'},
  {id:'bios_dev_evt', name:'Dev BIOS (EVT)', duration:w(4), deps:['power_rails_validated','blade_watercool_setup'], subsystem:'BIOS', phase:'EVT L2'},
  {id:'sw_hal_evt', name:'Dev SW HAL (EVT 20j)', duration:d(20), deps:['blade_watercool_setup'], subsystem:'FW', phase:'EVT L2'},
  {id:'evt_done', name:'Fin EVT → GreenLight DVT', duration:d(0), deps:['l2_integration_evt'], subsystem:'System', phase:'EVT'},
  {id:'make_15_blades', name:'Préparer ~15 lames DVT', duration:w(4), deps:['evt_done'], subsystem:'System', phase:'DVT L3'},
  {id:'fw_dev_dvt', name:'Dev FW (BMC/BIOS) continue', duration:w(4), deps:['make_15_blades'], subsystem:'FW', phase:'DVT L3'},
  {id:'l2_integration_dvt', name:'L2 intégration + interconnect (8w)', duration:w(8), deps:['make_15_blades'], subsystem:'System', phase:'DVT L3'},
  {id:'l1_thermal_cont', name:'L1 thermique (TC) continue', duration:w(4), deps:['make_15_blades'], subsystem:'Thermal', phase:'DVT L3'},
  {id:'sw_hal_dvt', name:'Dev SW HAL (DVT 60j)', duration:d(60), deps:['make_15_blades','sw_hal_evt'], subsystem:'FW', phase:'DVT L3'},
  {id:'l3_system_test', name:'L3 tests système (8w)', duration:w(8), deps:['l2_integration_dvt','fw_dev_dvt','sw_hal_dvt'], subsystem:'System', phase:'DVT L3'},
  {id:'blade_for_angers', name:'Lame pour Angers (usine)', duration:w(1), deps:['make_15_blades'], subsystem:'System', phase:'DVT L3'},
  {id:'dvt_done', name:'Fin DVT', duration:d(0), deps:['l3_system_test'], subsystem:'System', phase:'DVT'},
  {id:'transfer_factory', name:'Transfert à Angers / CdP usine', duration:w(1), deps:['dvt_done'], subsystem:'System', phase:'PVT'},
  {id:'train_assembly', name:'Former montage lames', duration:w(1), deps:['transfer_factory'], subsystem:'System', phase:'PVT'},
  {id:'build_card_tester', name:'Construire testeur carte', duration:w(3), deps:['transfer_factory'], subsystem:'System', phase:'PVT'},
  {id:'pretest_bench', name:'Banc de pré‑test mémoire', duration:w(2), deps:['transfer_factory'], subsystem:'System', phase:'PVT'},
  {id:'pvt_launch_mfg', name:'Lancer MFG PVT (cartes + méca)', duration:w(2), deps:['transfer_factory'], subsystem:'System', phase:'PVT'},
  {id:'parts_received', name:'Réception pièces', duration:w(3), deps:['pvt_launch_mfg'], subsystem:'System', phase:'PVT'},
  {id:'mfg_process', name:'Process MFG (ramp‑up)', duration:w(4), deps:['parts_received'], subsystem:'System', phase:'PVT'},
  {id:'pvt_done', name:'Fin PVT', duration:d(0), deps:['mfg_process'], subsystem:'System', phase:'PVT'}
]); }

function templateLib(which){
  if(which==='hpc') return templateHPC();
  if(which==='sw') return ensureIds([
    {id:'sw_backlog', name:'Backlog grooming', duration:d(1), phase:'Sprint‑0', subsystem:'System'},
    {id:'sw_planning', name:'Sprint planning', duration:d(1), deps:['sw_backlog'], phase:'Sprint‑0', subsystem:'System'},
    {id:'sw_dev', name:'Development', duration:d(8), deps:['sw_planning'], phase:'Sprint‑1', subsystem:'FW'},
    {id:'sw_ci', name:'CI & Code review', duration:d(2), deps:['sw_dev'], phase:'Sprint‑1', subsystem:'FW'},
    {id:'sw_test', name:'Testing', duration:d(2), deps:['sw_ci'], phase:'Sprint‑1', subsystem:'System'},
    {id:'sw_release', name:'Release & Retro', duration:d(1), deps:['sw_test'], phase:'Sprint‑1', subsystem:'System'}
  ]);
  if(which==='hw') return ensureIds([
    {id:'schematic', name:'Schematic update', duration:w(2), subsystem:'System', phase:'SPIN'},
    {id:'layout', name:'PCB layout changes', duration:w(3), deps:['schematic'], subsystem:'System', phase:'SPIN'},
    {id:'fabrication', name:'Fabrication', duration:w(2), deps:['layout'], subsystem:'System', phase:'SPIN'},
    {id:'bringup', name:'Board bring‑up', duration:w(3), deps:['fabrication'], subsystem:'power/VRM', phase:'BRINGUP'}
  ]);
  return [];
}

})();
/* === TIMELINE VISIBILITY ENHANCEMENTS (single-file) === */

/** Measure text length in the SVG coordinate space */
function measureSvgText(svg, text, font = '14px Inter, system-ui, sans-serif') {
  const probe = document.createElementNS('http://www.w3.org/2000/svg', 'text');
  probe.setAttribute('x', -9999); probe.setAttribute('y', -9999);
  probe.style.font = font;
  probe.textContent = text || '';
  svg.appendChild(probe);
  const w = probe.getComputedTextLength();
  probe.remove();
  return w;
}

/** Compute a safe left column (task-name) width P based on current tasks */
function computeLeftColumnWidth(svg, tasks, min = 140, max = 320, pad = 18) {
  let maxW = 0;
  for (const t of tasks) {
    maxW = Math.max(maxW, measureSvgText(svg, t.name));
  }
  return Math.max(min, Math.min(max, Math.ceil(maxW + pad)));
}

/** Apply ellipsis + title tooltip when a name overflows the chip */
function fitTaskName(svgTextEl, maxWidth) {
  const full = svgTextEl.getAttribute('data-full') || svgTextEl.textContent;
  svgTextEl.setAttribute('data-full', full);
  svgTextEl.setAttribute('title', full);

  // Quick exit if it already fits
  svgTextEl.textContent = full;
  if (svgTextEl.getComputedTextLength() <= maxWidth) return;

  // Binary-search ellipsis
  let lo = 0, hi = full.length, best = '';
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const trial = full.slice(0, mid) + '…';
    svgTextEl.textContent = trial;
    if (svgTextEl.getComputedTextLength() <= maxWidth) {
      best = trial; lo = mid + 1;
    } else hi = mid - 1;
  }
  svgTextEl.textContent = best || '…';
}

/** Mark inside-bar labels as narrow when bar is small */
function tagNarrowInbarLabels(svg, minWidth = 46) {
  svg.querySelectorAll('.gantt .bar').forEach(bar => {
    const rect = bar.querySelector('rect');
    if (!rect) return;
    const bw = Number(rect.getAttribute('width') || 0);
    bar.querySelectorAll('.label.inbar').forEach(label => {
      label.setAttribute('data-w', bw < minWidth ? 'narrow' : 'wide');
    });
  });
}

/** Reflow task name column and labels after (re)render and on zoom/resize */
function enhanceTimelineReadability() {
  const svg = document.getElementById('gantt');
  if (!svg) return;

  // Derive tasks from existing bar groups
  const tasks = Array.from(svg.querySelectorAll('.gantt .bar')).map(g => ({
    name: (g.getAttribute('data-name') || g.querySelector('text.label[text-anchor="end"]')?.textContent || '').trim()
  }));

  if (!tasks.length) return;

  // 1) Compute P, shift axis & bars if your renderer uses a constant P
  const P = computeLeftColumnWidth(svg, tasks); // e.g., 140..320
  // If your renderer uses a constant "P", update it here and re-render if needed.
  // Otherwise, shift name texts and left chips based on P.
  svg.style.setProperty('--left-col', P + 'px');

  // 2) Fit task names + chip background
  svg.querySelectorAll('.gantt .bar').forEach(bar => {
    const nameText = bar.querySelector('text.label[text-anchor="end"], text.taskName');
    const chip = bar.querySelector('rect.taskNameBg');
    if (nameText && chip) {
      // Max width for text inside the chip (chip width minus padding)
      const chipWidth = Number(chip.getAttribute('width') || 0);
      fitTaskName(nameText, chipWidth - 12);
    }
  });

  // 3) Hide cramped labels inside bars
  tagNarrowInbarLabels(svg);

  // 4) Re-run on next frame to catch zoom transforms
  requestAnimationFrame(() => tagNarrowInbarLabels(svg));
}

// Hook into your existing lifecycle
const debouncedEnhance = debounce(enhanceTimelineReadability, 150);
window.addEventListener('resize', debouncedEnhance, { passive: true });
document.getElementById('zoomInTL')?.addEventListener('click', debouncedEnhance);
document.getElementById('zoomOutTL')?.addEventListener('click', debouncedEnhance);
document.getElementById('zoomResetTL')?.addEventListener('click', debouncedEnhance);

// Call after initial render; if your app already exposes renderGantt, patch it:
const _renderGanttOrig = window.renderGantt;
if (typeof _renderGanttOrig === 'function') {
  window.renderGantt = function(...args) {
    const out = _renderGanttOrig.apply(this, args);
    enhanceTimelineReadability();
    return out;
  }
} else {
  // Fallback if you don't have a render wrapper
  window.addEventListener('load', () => setTimeout(enhanceTimelineReadability, 0));
}
document.getElementById('btnToggleSidebar')?.addEventListener('click', (e)=>{
  const on = !document.body.classList.contains('sidebar-collapsed');
  document.body.classList.toggle('sidebar-collapsed', on);
  e.currentTarget.setAttribute('aria-pressed', String(on));
  setTimeout(()=> enhanceTimelineReadability(), 0); // reflow
});
(function() {
  'use strict';

  const doc = document.documentElement;
  const themeToggle = document.getElementById('toggle-theme');
  const densityToggle = document.getElementById('toggle-density');

  // 1. Restore preferences on load
  const savedTheme = localStorage.getItem('hpc-theme');
  if (savedTheme === 'dark') {
    doc.classList.add('dark-mode');
  } else if (savedTheme === 'light') {
    doc.classList.remove('dark-mode');
  }

  const savedDensity = localStorage.getItem('hpc-compact');
  if (savedDensity === 'true') {
    doc.classList.add('compact');
  }

  // 2. Theme toggle handler
  if (themeToggle) {
    themeToggle.addEventListener('click', () => {
      doc.classList.toggle('dark-mode');
      const isDarkMode = doc.classList.contains('dark-mode');
      localStorage.setItem('hpc-theme', isDarkMode ? 'dark' : 'light');
    });
  }

  // 3. Density toggle handler
  if (densityToggle) {
    densityToggle.addEventListener('click', () => {
      const isCompact = doc.classList.toggle('compact');
      localStorage.setItem('hpc-compact', isCompact);
    });
  }

  // 4. Skeleton loading behavior
  const bootElement = document.getElementById('boot');
  if (bootElement) {
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.attributeName === 'style' && bootElement.style.display === 'none') {
          const skeleton = document.querySelector('#side .skeleton');
          if (skeleton) {
            skeleton.style.transition = 'opacity 0.3s ease-out';
            skeleton.style.opacity = '0';
            setTimeout(() => { skeleton.style.display = 'none'; }, 300);
          }
          observer.disconnect();
        }
      }
    });
    observer.observe(bootElement, { attributes: true });
  }

})();
(function() {
  'use strict';
  const actionButton = document.getElementById('primary-action');
  const actionMenu = document.getElementById('action-menu');

  if (!actionButton || !actionMenu) return;

  const menuItems = Array.from(actionMenu.querySelectorAll('[role="menuitem"]'));

  function openMenu() {
    actionMenu.style.display = 'block';
    setTimeout(() => {
      actionMenu.classList.add('open');
      actionButton.setAttribute('aria-expanded', 'true');
      menuItems[0]?.focus();
    }, 10); // Small delay for transition
  }

  function closeMenu() {
    actionMenu.classList.remove('open');
    actionButton.setAttribute('aria-expanded', 'false');
    actionButton.focus();
    setTimeout(() => {
      if (!actionMenu.classList.contains('open')) {
        actionMenu.style.display = 'none';
      }
    }, 150); // Match CSS transition duration
  }

  actionButton.addEventListener('click', (e) => {
    e.stopPropagation();
    const isExpanded = actionButton.getAttribute('aria-expanded') === 'true';
    if (isExpanded) {
      closeMenu();
    } else {
      openMenu();
    }
  });

  document.addEventListener('click', (e) => {
    const isExpanded = actionButton.getAttribute('aria-expanded') === 'true';
    if (isExpanded && !actionMenu.contains(e.target) && !actionButton.contains(e.target)) {
      closeMenu();
    }
  });

  // Consolidated keydown handler for the whole menu
  actionMenu.addEventListener('keydown', (e) => {
    const isExpanded = actionMenu.classList.contains('open');
    if (!isExpanded) return;

    const key = e.key;

    if (key === 'Escape') {
      closeMenu();
      return;
    }

    if (key === 'ArrowDown' || key === 'ArrowUp') {
      e.preventDefault();
      const activeEl = document.activeElement;
      const currentIndex = menuItems.indexOf(activeEl);
      let nextIndex = currentIndex + (key === 'ArrowDown' ? 1 : -1);

      if (nextIndex >= menuItems.length) {
        nextIndex = 0; // Wrap to top
      } else if (nextIndex < 0) {
        nextIndex = menuItems.length - 1; // Wrap to bottom
      }

      menuItems[nextIndex]?.focus();
    }

    if (key === 'Tab') {
        e.preventDefault(); // Trap focus
        const first = menuItems[0];
        const last = menuItems[menuItems.length - 1];

        if (e.shiftKey) { // Shift+Tab
            if (document.activeElement === first) {
                last.focus();
            } else {
                const idx = menuItems.indexOf(document.activeElement);
                menuItems[idx - 1]?.focus();
            }
        } else { // Tab
            if (document.activeElement === last) {
                first.focus();
            } else {
                const idx = menuItems.indexOf(document.activeElement);
                menuItems[idx + 1]?.focus();
            }
        }
    }
  });

  // Global keydown for Escape, as menu may not have focus
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && actionMenu.classList.contains('open')) {
      closeMenu();
    }
  });

  // Add click listeners to close menu after action
  menuItems.forEach(item => {
    item.addEventListener('click', () => {
      // Action will be handled by other event listeners
      closeMenu();
    });
  });

})();

(function(){
  'use strict';
  function setupDropdown(buttonId, menuId, onOpen){
    const btn=document.getElementById(buttonId);
    const menu=document.getElementById(menuId);
    if(!btn || !menu) return;
    const getItems=()=>Array.from(menu.querySelectorAll('button, [href], input, select, textarea'));
    function openMenu(){
      menu.style.display='block';
      if(typeof onOpen==='function') onOpen();
      setTimeout(()=>{ menu.classList.add('open'); btn.setAttribute('aria-expanded','true'); getItems()[0]?.focus(); },10);
    }
    function closeMenu(){
      menu.classList.remove('open');
      btn.setAttribute('aria-expanded','false');
      setTimeout(()=>{ if(!menu.classList.contains('open')) menu.style.display='none'; },150);
    }
    btn.addEventListener('click',(e)=>{ e.stopPropagation(); const exp=btn.getAttribute('aria-expanded')==='true'; exp?closeMenu():openMenu(); });
    document.addEventListener('click',(e)=>{ const exp=btn.getAttribute('aria-expanded')==='true'; if(exp && !menu.contains(e.target) && !btn.contains(e.target)) closeMenu(); });
    menu.addEventListener('keydown',(e)=>{ if(e.key==='Escape'){ closeMenu(); return; } if(e.key==='Tab'){ const items=getItems(); if(items.length){ const first=items[0]; const last=items[items.length-1]; if(e.shiftKey && document.activeElement===first){ e.preventDefault(); last.focus(); } else if(!e.shiftKey && document.activeElement===last){ e.preventDefault(); first.focus(); } } }});
  }
  setupDropdown('btn-project-calendar','menu-project-calendar');
  setupDropdown('btn-filter-group','menu-filter-group');
  setupDropdown('btn-subsystem-legend','menu-subsystem-legend');
  setupDropdown('btn-edit-selected','menu-edit-selected', window.renderInlineEditor);
  setupDropdown('btn-bulk-edit','menu-bulk-edit');
  setupDropdown('btn-template','menu-template');
  setupDropdown('btn-validation','menu-validation');
  setupDropdown('btn-legend','menu-legend');
})();
