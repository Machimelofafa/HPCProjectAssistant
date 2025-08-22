'use strict';

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

export { parseDuration };
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { parseDuration };
}
