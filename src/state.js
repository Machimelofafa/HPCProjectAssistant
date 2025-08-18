import { deepFreeze, clone, uid } from './utils.js';
import { $ } from './utils.js';

const SM = (function () {
  let state = deepFreeze({ startDate: new Date().toLocaleDateString('en-CA'), calendar: 'workdays', holidays: [], tasks: [] });
  let listeners = [];
  let lastCPMWarns = [];
  const undo = [];
  const redo = [];
  const MAX = 100;
  const BASE_KEY = 'hpc-project-baselines';
  let baselines = [];
  try {
    baselines = JSON.parse(localStorage.getItem(BASE_KEY)) || [];
  } catch (e) {
    baselines = [];
  }

  function saveBaselines() {
    try {
      localStorage.setItem(BASE_KEY, JSON.stringify(baselines));
    } catch (e) {
      console.warn('Failed to save baselines', e);
    }
  }

  function get() {
    return clone(state);
  }

  function _apply(next) {
    state = deepFreeze(clone(next));
    for (const fn of listeners) {
      try {
        fn(get());
      } catch (e) {
        console.warn(e);
      }
    }
  }

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

  function set(next, opts = {}) {
    const prev = get();
    _apply(next);
    if (opts.record !== false) {
      const actionName = opts.name || 'Unknown action';
      undo.push({ state: prev, name: actionName });
      if (undo.length > MAX) undo.shift();
      redo.length = 0;
    }
    window.dispatchEvent(new CustomEvent('state:changed', { detail: { sourceIds: opts.sourceIds || [] } }));
    if (opts.noSave !== true) {
      saveState(next);
    }
    updateUndoUI();
  }

  function setProjectProps(props, opts = {}) {
    const cur = get();
    Object.assign(cur, props);
    set(cur, opts);
  }

  function addTasks(list, opts = {}) {
    const cur = get();
    const ids = new Set(cur.tasks.map(t => t.id));
    const add = list.map(t => {
      let id = t.id || uid('t');
      while (ids.has(id)) id = uid('t');
      ids.add(id);
      return { ...t, id };
    });
    cur.tasks = cur.tasks.concat(add);
    set(cur, opts);
  }

  function replaceTasks(tasks, opts = {}) {
    const cur = get();
    cur.tasks = tasks;
    set(cur, opts);
  }

  function updateTask(id, patch, opts = {}) {
    const cur = get();
    const i = cur.tasks.findIndex(t => t.id === id);
    if (i < 0) return;
    cur.tasks = cur.tasks.slice();
    cur.tasks[i] = { ...cur.tasks[i], ...patch };
    set(cur, { sourceIds: [id], ...opts });
  }

  function onChange(fn) {
    listeners.push(fn);
  }

  function setCPMWarnings(list) {
    lastCPMWarns = list || [];
  }

  function canUndo() {
    return undo.length > 0;
  }

  function canRedo() {
    return redo.length > 0;
  }

  function undoOp() {
    if (!canUndo()) return;
    const record = undo.pop();
    const cur = { state: get(), name: record.name };
    redo.push(cur);
    _apply(record.state);
    updateUndoUI();
  }

  function redoOp() {
    if (!canRedo()) return;
    const record = redo.pop();
    const cur = { state: get(), name: record.name };
    undo.push(cur);
    _apply(record.state);
    updateUndoUI();
  }

  function listBaselines() {
    return baselines.map(b => ({ id: b.id, name: b.name, createdAt: b.createdAt }));
  }

  function getBaseline(id) {
    const b = baselines.find(x => x.id === id);
    return b ? clone(b.projectSnapshot) : null;
  }

  function addBaseline(name) {
    const id = uid('b');
    const projectSnapshot = get();
    baselines.push({ id, name, createdAt: new Date().toISOString(), projectSnapshot });
    if (baselines.length > 5) baselines = baselines.slice(-5);
    saveBaselines();
    return id;
  }

  function removeBaseline(id) {
    baselines = baselines.filter(b => b.id !== id);
    saveBaselines();
  }

  return {
    get,
    set,
    setProjectProps,
    addTasks,
    replaceTasks,
    updateTask,
    onChange,
    setCPMWarnings,
    lastCPMWarns: () => lastCPMWarns,
    undo: undoOp,
    redo: redoOp,
    canUndo,
    canRedo,
    addBaseline,
    removeBaseline,
    getBaseline,
    listBaselines
  };
})();

export default SM;
