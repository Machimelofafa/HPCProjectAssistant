'use strict';

// --- date-cal.js ---
/**
 * Parse a date in `dd-mm-yyyy` format.
 * @param {string} s
 * @returns {Date|null}
 */
function parseDate(s){
  const [d,m,y] = String(s||'').split('-').map(n=>parseInt(n,10));
  if(!d || !m || !y) return null;
  const dt = new Date(y, m-1, d);
  if(dt.getFullYear()!==y || dt.getMonth()!==m-1 || dt.getDate()!==d) return null;
  return dt;
}

/**
 * Format date as `dd-mm-yyyy`.
 * @param {Date} d
 * @returns {string}
 */
function fmtDate(d){ return [d.getDate().toString().padStart(2,'0'), (d.getMonth()+1).toString().padStart(2,'0'), d.getFullYear()].join('-'); }

/**
 * Convert `yyyy-mm-dd` to `dd-mm-yyyy`.
 * @param {string} s
 * @returns {string}
 */
function yyyymmdd_to_ddmmyyyy(s){ if (!s) return ''; const [y,m,d] = s.split('-'); return `${d}-${m}-${y}`; }

/**
 * Convert `dd-mm-yyyy` to `yyyy-mm-dd`.
 * @param {string} s
 * @returns {string}
 */
function ddmmyyyy_to_yyyymmdd(s){ if (!s) return ''; const [d,m,y] = s.split('-'); return `${y}-${m}-${d}`; }

/**
 * Add `n` days to a date.
 * @param {Date} date
 * @param {number} n
 * @returns {Date}
 */
function addDays(date, n){ const d=new Date(date); d.setDate(d.getDate()+n); return d; }

/**
 * Check if given date falls on weekend.
 * @param {Date} d
 * @returns {boolean}
 */
function isWeekend(d){ const x=d.getDay(); return x===0||x===6; }

/**
 * Difference in days between two dates.
 * @param {Date} a
 * @param {Date} b
 * @returns {number}
 */
function daysBetween(a,b){ return Math.round((b-a)/86400000); }

/**
 * @typedef {Object} Calendar
 * @property {'calendar'|'workdays'} mode
 * @property {(d:Date)=>boolean} isWorkday
 * @property {(start:Date,n:number)=>Date} add
 * @property {(start:Date,end:Date)=>number} diff
 */

/**
 * Build a calendar helper for adding/diffing business days.
 * @param {'calendar'|'workdays'} mode
 * @param {Set<string>} holidaysSet
 * @returns {Calendar}
 */
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

// --- duration.js ---
/**
 * @typedef {Object} DurationParseResult
 * @property {number} [days] - Duration in days when valid.
 * @property {string} [error] - Error message if parsing failed.
 */

/**
 * Parse a duration value expressed either as a number of days or a token like
 * "3w" (3 work weeks).
 *
 * @param {string|number} v - Raw duration value.
 * @returns {DurationParseResult}
 */
function parseDuration(v){
  if (typeof v === 'number') {
    if (!Number.isInteger(v) || v < 0) return { error: 'Duration must be a non‑negative integer (days).' };
    return { days: v };
  }
  const s = String(v || '').trim();
  if (s === '') return { error: 'Duration is required.' };
  const m = s.match(/^(\d+)\s*([dw])?$/i);
  if (!m) return { error: 'Use number of days or Nd/Nw (e.g., 10 or 3w).' };
  const n = parseInt(m[1], 10); const u = (m[2] || 'd').toLowerCase();
  if (n < 0) return { error: 'Duration cannot be negative.' };
  const days = u === 'w' ? n * 5 : n;
  return { days };
}

// --- deps.js ---
/**
 * @typedef {'FS'|'SS'|'FF'|'SF'} DepType
 *
 * @typedef {Object} ParsedDep
 * @property {DepType} type - Relationship type.
 * @property {string} pred - Predecessor task id.
 * @property {number} lag - Lag in days.
 */

/**
 * Parse a dependency token (e.g., `FS:task+2d`).
 * @param {string} token
 * @returns {ParsedDep|null}
 */
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

/**
 * Stringify a dependency edge.
 * @param {ParsedDep} e
 * @returns {string}
 */
function stringifyDep(e){ const lagStr = e.lag? ((e.lag>0?'+':'')+Math.round(e.lag)+'d') : ''; return (e.type==='FS' && !lagStr? e.pred : `${e.type}:${e.pred}${lagStr}`); }

/**
 * Normalize dependencies array from task into ParsedDep[]
 * @param {{deps?: string[]}} task
 * @returns {ParsedDep[]}
 */
function normalizeDeps(task){ const raw=task.deps||[]; const arr=[]; for(const tok of raw){ const p=parseDepToken(tok); if(!p) continue; arr.push(p); } return arr; }

// --- cpm.js ---
// --- CRITICAL PATH METHOD (CPM) ENGINE ---
function computeCPM(project){
  const cal = makeCalendar(project.calendar, new Set(project.holidays||[]));
  const active = project.tasks.filter(t=>t.active!==false);
  const id2 = Object.fromEntries(active.map(t=>[t.id,t]));

  const predMap = new Map(active.map(t=>[t.id, normalizeDeps(t).filter(e=>id2[e.pred]) ]));
  const succMap = new Map(active.map(t=>[t.id, []]));
  for(const [sid,edges] of predMap){
    for(const e of edges){
      if(!succMap.has(e.pred)) succMap.set(e.pred,[]);
      succMap.get(e.pred).push({to:sid, type:e.type, lag:e.lag});
    }
  }

  const indeg = new Map(active.map(t=>[t.id,0]));
  for(const [sid,edges] of predMap){
    for(const e of edges){ indeg.set(sid, (indeg.get(sid)||0)+1); }
  }
  const q=[]; for(const t of active){ if((indeg.get(t.id)||0)===0) q.push(t.id); }
  const order=[]; while(q.length){ const u=q.shift(); order.push(u); for(const arc of (succMap.get(u)||[])){ const v=arc.to; indeg.set(v, (indeg.get(v)||0)-1); if(indeg.get(v)===0) q.push(v); } }

  const usable=active.filter(t=>order.includes(t.id));

  const ES={}, EF={}; const warnings=[];
  for(const id of order){
    const t=id2[id]; if(!t) continue; const dur = parseDuration(t.duration).days||0; let baseES=0;
    for(const e of (predMap.get(id)||[])){
      const p=e.pred; const type=e.type; const lag=e.lag|0; const esP = ES[p]||0; const efP = EF[p]||0;
      if(type==='FS') baseES=Math.max(baseES, efP + lag);
      else if(type==='SS') baseES=Math.max(baseES, esP + lag);
      else if(type==='FF') baseES=Math.max(baseES, efP + lag - dur);
      else if(type==='SF') baseES=Math.max(baseES, esP + lag - dur);
    }
    const sc = t.startConstraint || (t.fixedStart!=null ? {type:'SNET', day:t.fixedStart|0} : null);
    if(sc){
      if(sc.type==='SNET') baseES = Math.max(baseES, sc.day|0);
      else if(sc.type==='MSO'){
        if(baseES > (sc.day|0)) warnings.push({sev:'error', msg:`MSO violated for ${t.name}: deps force start ${baseES} > ${sc.day}`, taskId:t.id});
        baseES = Math.max(baseES, sc.day|0);
      }
    }
    ES[id]=baseES; EF[id]=baseES + dur;
  }
  const projectFinish = Math.max(0, ...order.map(id=>EF[id]||0));

  const LF={}, LS={};
  const orderRev = order.slice().reverse();
  for(const id of orderRev){
    const t=id2[id]; if(!t) continue; const dur=parseDuration(t.duration).days||0; let baseLF = projectFinish; const succs = succMap.get(id)||[]; if(succs.length===0){ baseLF = projectFinish; }
      for(const arc of succs){ const s=arc.to; const type=arc.type; const lag=arc.lag|0; const lsS = LS[s]; const lfS = LF[s]; if(lsS==null || lfS==null) continue;
        if(type==='FS') baseLF = Math.min(baseLF, lsS - lag);
        else if(type==='SS') baseLF = Math.min(baseLF, (LS[id]==null? (lsS - lag) + dur : Math.min(LF[id]||Infinity, (lsS - lag) + dur) ));
        else if(type==='FF') baseLF = Math.min(baseLF, lfS - lag);
        else if(type==='SF') baseLF = Math.min(baseLF, (lfS - lag));
      }
      LF[id] = baseLF; LS[id] = baseLF - dur; }

  const out = usable.map(t=>({ ...t,
    es:ES[t.id]||0, ef:EF[t.id]||parseDuration(t.duration).days||0,
    ls:LS[t.id]||0, lf:LF[t.id]||parseDuration(t.duration).days||0,
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
    self.postMessage({ type: 'result', cpm: cpmResult });
  }
};

