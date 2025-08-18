import { todayStr, uid } from './utils.js';

const SCHEMA_VERSION = '1.0.0';

export function parseDurationStrict(v) {
  if (typeof v === 'number') {
    if (!Number.isInteger(v) || v < 0) return { error: 'Duration must be a non‑negative integer (days).' };
    return { days: v };
  }
  const s = String(v || '').trim();
  if (s === '') return { error: 'Duration is required.' };
  const m = s.match(/^(\d+)\s*([dw])?$/i);
  if (!m) return { error: 'Use number of days or Nd/Nw (e.g., 10 or 3w).' };
  const n = parseInt(m[1], 10);
  const u = (m[2] || 'd').toLowerCase();
  if (n < 0) return { error: 'Duration cannot be negative.' };
  const days = u === 'w' ? n * 5 : n;
  return { days };
}

export function validateProject(project) {
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

export function parseDepToken(token) {
  const s = String(token || '').trim();
  if (!s) return null;
  let type = 'FS';
  let rest = s;
  const colon = s.indexOf(':');
  if (colon > 0) {
    const t = s.slice(0, colon).toUpperCase();
    if (['FS', 'SS', 'FF', 'SF'].includes(t)) {
      type = t;
      rest = s.slice(colon + 1);
    }
  }
  let pred = rest;
  let lag = 0;
  const m = rest.match(/^(.*?)([+-])(\d+)([dw])?$/i);
  if (m) {
    pred = m[1];
    const sign = m[2] === '-' ? -1 : 1;
    const n = parseInt(m[3], 10);
    const u = (m[4] || 'd').toLowerCase();
    lag = sign * (u === 'w' ? n * 5 : n);
  }
  pred = pred.trim();
  return { type, pred, lag };
}

export function stringifyDep(e) {
  const lagStr = e.lag ? ((e.lag > 0 ? '+' : '') + Math.round(e.lag) + 'd') : '';
  return (e.type === 'FS' && !lagStr ? e.pred : `${e.type}:${e.pred}${lagStr}`);
}

export function normalizeDeps(task) {
  const raw = task.deps || [];
  const arr = [];
  for (const tok of raw) {
    const p = parseDepToken(tok);
    if (!p) continue;
    arr.push(p);
  }
  return arr;
}

export function adjustIncomingLags(task, delta) {
  const out = [];
  for (const tok of (task.deps || [])) {
    const e = parseDepToken(tok);
    if (!e) {
      out.push(tok);
      continue;
    }
    if (e.type === 'FS' || e.type === 'SS') {
      e.lag = (e.lag | 0) + delta;
      out.push(stringifyDep(e));
    } else {
      out.push(tok);
    }
  }
  return out;
}
