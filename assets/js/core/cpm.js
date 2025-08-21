'use strict';

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

