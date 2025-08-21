'use strict';

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

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { parseDate, fmtDate, yyyymmdd_to_ddmmyyyy, ddmmyyyy_to_yyyymmdd, addDays, isWeekend, daysBetween, makeCalendar };
}
