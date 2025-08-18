'use strict';

// All functions for the worker will be placed here.
// This is a self-contained script that will run in a separate thread.

// --- UTILITIES (copied from main script) ---
function parseDate(s){ const [d,m,y] = s.split('-'); return new Date(`${y}-${m}-${d}T00:00:00`); }
function fmtDate(d){ return [d.getDate().toString().padStart(2,'0'), (d.getMonth()+1).toString().padStart(2,'0'), d.getFullYear()].join('-'); }
function addDays(date, n){ const d=new Date(date); d.setDate(d.getDate()+n); return d; }
function isWeekend(d){ const x=d.getDay(); return x===0||x===6; }
function daysBetween(a,b){ return Math.round((b-a)/86400000); }

// --- PARSERS & VALIDATORS ---
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
  const m = rest.match(/^(.*?)([+-])(\d+)([dw])?$/i);
  if(m){ pred=m[1]; const sign=m[2]==='-'?-1:1; const n=parseInt(m[3],10); const u=(m[4]||'d').toLowerCase(); lag = sign * (u==='w'? n*5 : n); }
  pred=pred.trim();
  return {type, pred, lag};
}
function stringifyDep(e){ const lagStr = e.lag? ((e.lag>0?'+':'')+Math.round(e.lag)+'d') : ''; return (e.type==='FS' && !lagStr? e.pred : `${e.type}:${e.pred}${lagStr}`); }
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
  if(sc){ if(sc.type==='SNET') baseES = Math.max(baseES, sc.day|0); else if(sc.type==='MSO'){ if(baseES > (sc.day|0)) warnings.push({sev:'error', msg:`MSO violated for ${t.name}: deps force start ${baseES} > ${sc.day}`, taskId:t.id}); baseES = Math.max(baseES, sc.day|0); } }
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
