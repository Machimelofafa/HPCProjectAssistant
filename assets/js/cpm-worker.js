'use strict';

// Load shared helpers and CPM engine.
importScripts('core/date-cal.js', 'core/duration.js', 'core/deps.js', 'core/cpm.js');

// --- GRAPH & DEPENDENCY HELPERS ---
function findCycles(tasks){
  const id2=Object.fromEntries(tasks.map(t=>[t.id,t]));
  const deps=Object.fromEntries(tasks.map(t=>[t.id, normalizeDeps(t).map(x=>x.pred).filter(x=>id2[x]) ]));
  const color={}; const stack=[]; const cycles=[];
  function dfs(u){ color[u]=1; stack.push(u); for(const v of (deps[u]||[])){ if(color[v]==null){ dfs(v); } else if(color[v]===1){ const idx=stack.indexOf(v); cycles.push(stack.slice(idx).concat(v)); } } stack.pop(); color[u]=2; }
  for(const t of tasks){ if(color[t.id]==null) dfs(t.id); }
  return cycles;
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
