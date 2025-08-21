'use strict';

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

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { parseDepToken, stringifyDep, normalizeDeps };
}
