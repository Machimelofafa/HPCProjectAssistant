// A collection of small, reusable utility functions.
export const $ = (q, el = document) => el.querySelector(q);
export const $$ = (q, el = document) => Array.from(el.querySelectorAll(q));

export function todayStr() {
  const d = new Date();
  return [d.getDate().toString().padStart(2, '0'), (d.getMonth() + 1).toString().padStart(2, '0'), d.getFullYear()].join('-');
}

export function parseDate(s) {
  const [d, m, y] = s.split('-');
  return new Date(`${y}-${m}-${d}T00:00:00`);
}

export function fmtDate(d) {
  return [d.getDate().toString().padStart(2, '0'), (d.getMonth() + 1).toString().padStart(2, '0'), d.getFullYear()].join('-');
}

export function yyyymmdd_to_ddmmyyyy(s) {
  if (!s) return '';
  const [y, m, d] = s.split('-');
  return `${d}-${m}-${y}`;
}

export function ddmmyyyy_to_yyyymmdd(s) {
  if (!s) return '';
  const [d, m, y] = s.split('-');
  return `${y}-${m}-${d}`;
}

export function addDays(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

export function isWeekend(d) {
  const x = d.getDay();
  return x === 0 || x === 6;
}

export function daysBetween(a, b) {
  return Math.round((b - a) / 86400000);
}

export function esc(s) {
  return String(s ?? '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}

export function uid(prefix = 't') {
  return prefix + '_' + Math.random().toString(36).slice(2, 8);
}

export function slug(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

export function clone(o) {
  return JSON.parse(JSON.stringify(o));
}

export function deepFreeze(o) {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const k of Object.keys(o)) {
      deepFreeze(o[k]);
    }
  }
  return o;
}

export function debounce(fn, delay) {
  let timeoutId;
  return function (...args) {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn.apply(this, args), delay);
  };
}

export function showToast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.style.display = 'block';
  clearTimeout(showToast._h);
  showToast._h = setTimeout(() => {
    t.style.display = 'none';
  }, 2600);
}

export function showHint(x, y, msg) {
  const h = $('#hint');
  h.textContent = msg;
  h.style.left = (x + 12) + 'px';
  h.style.top = (y + 12) + 'px';
  h.style.display = 'block';
}

export function hideHint() {
  $('#hint').style.display = 'none';
}

export function showContextMenu(x, y, id) {
  const m = $('#ctxMenu');
  m.dataset.id = id;
  m.style.display = 'block';
  m.style.left = x + 'px';
  m.style.top = y + 'px';
}

export function hideContextMenu() {
  $('#ctxMenu').style.display = 'none';
}
