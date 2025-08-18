import { $, $$ } from './utils.js';
import { parseDurationStrict, parseDepToken, stringifyDep } from './parsers.js';
import SM from './state.js';
import { showToast } from './utils.js';
import { esc } from './utils.js';

export const SEL = new Set();
let LAST_SEL = null;

export function updateSelBadge() {
    $('#selBadge').textContent = `${SEL.size} selected`;
    $('#bulkCount').textContent = String(SEL.size);
    if ($('#inlineCount')) {
        $('#inlineCount').textContent = String(SEL.size);
    }
    renderInlineEditor();
    // Assuming renderContextPanel is imported and available where this is called from
    window.dispatchEvent(new CustomEvent('render-context', { detail: { selectedId: LAST_SEL } }));
}

export function toggleSelect(id) {
    if (SEL.has(id)) {
        SEL.delete(id);
        if (LAST_SEL === id) LAST_SEL = null;
    } else {
        SEL.add(id);
        LAST_SEL = id;
    }
    updateSelBadge();
}

export function selectOnly(id) {
    SEL.clear();
    SEL.add(id);
    LAST_SEL = id;
    updateSelBadge();
}

export function clearSelection() {
    SEL.clear();
    LAST_SEL = null;
    updateSelBadge();
}

export function moveSelection(dir) {
    const tasks = SM.get().tasks.filter(t => matchesFilters(t)); // matchesFilters needs to be available
    if (!tasks.length) return;
    let idx = tasks.findIndex(t => t.id === LAST_SEL);
    if (idx === -1) idx = dir > 0 ? 0 : tasks.length - 1;
    else idx = (idx + dir + tasks.length) % tasks.length;
    selectOnly(tasks[idx].id);
    window.dispatchEvent(new CustomEvent('refresh-needed'));
}

export function deleteSelected() {
    if (!SEL.size) return;
    const ids = new Set(SEL);
    const s = SM.get();
    const remaining = s.tasks.filter(t => !ids.has(t.id));
    for (const t of remaining) {
        if (t.deps) {
            t.deps = t.deps.filter(tok => {
                const e = parseDepToken(tok);
                return !(e && ids.has(e.pred));
            });
        }
    }
    SM.replaceTasks(remaining, { name: `Delete ${ids.size} Task(s)` });
    clearSelection();
    showToast(`Deleted ${ids.size} task${ids.size>1?'s':''}`);
    window.dispatchEvent(new CustomEvent('refresh-needed'));
}

export function duplicateSelected() {
    if (!SEL.size) return;
    const s = SM.get();
    const tasks = [...s.tasks];
    const ids = new Set(tasks.map(t => t.id));
    const originals = tasks.filter(t => SEL.has(t.id));
    const mapOldToNew = new Map();
    const clones = [];
    for (const t of originals) {
        let id = t.id + '_copy';
        while (ids.has(id)) id = uid('t');
        ids.add(id);
        const clone = JSON.parse(JSON.stringify(t));
        clone.id = id;
        clone.name = (t.name || t.id) + ' (copy)';
        mapOldToNew.set(t.id, id);
        clones.push(clone);
    }
    for (const c of clones) {
        if (c.deps) {
            c.deps = c.deps.map(tok => {
                const e = parseDepToken(tok);
                if (!e) return tok;
                if (mapOldToNew.has(e.pred)) e.pred = mapOldToNew.get(e.pred);
                return stringifyDep(e);
            });
        }
    }
    for (let i = originals.length - 1; i >= 0; i--) {
        const idx = tasks.findIndex(t => t.id === originals[i].id);
        tasks.splice(idx + 1, 0, clones[i]);
    }
    SM.replaceTasks(tasks, { name: `Duplicate ${clones.length} Task(s)` });
    SEL.clear();
    clones.forEach(c => SEL.add(c.id));
    LAST_SEL = clones.length ? clones[clones.length - 1].id : null;
    updateSelBadge();
    showToast(`Duplicated ${clones.length} task${clones.length>1?'s':''}`);
    window.dispatchEvent(new CustomEvent('refresh-needed'));
}

const SUBS = ['power/VRM', 'PCIe', 'BMC', 'BIOS', 'FW', 'Mech', 'Thermal', 'System'];

function renderInlineEditor() {
    const box = $('#inlineEdit');
    if (!box) return;
    box.innerHTML = '';
    if (SEL.size === 0) return;
    const s = SM.get();
    for (const id of SEL) {
        const t = s.tasks.find(x => x.id === id);
        if (!t) continue;
        const row = document.createElement('div');
        row.className = 'row';
        const dur = parseDurationStrict(t.duration).days || 0;
        row.innerHTML = `<input type="text" data-id="${id}" data-field="name" value="${esc(t.name)}">
      <input type="number" min="0" data-id="${id}" data-field="duration" value="${dur}">
      <input type="number" min="0" max="100" data-id="${id}" data-field="pct" value="${t.pct||0}">
      <input type="text" data-id="${id}" data-field="phase" value="${esc(t.phase||'')}">
      <select data-id="${id}" data-field="subsystem">${SUBS.map(sub=>`<option${sub===t.subsystem?' selected':''}>${esc(sub)}</option>`).join('')}</select>
      <select data-id="${id}" data-field="active"><option value="true"${t.active!==false?' selected':''}>true</option><option value="false"${t.active===false?' selected':''}>false</option></select>`;
        box.appendChild(row);
    }
    box.querySelectorAll('input,select').forEach(inp => {
        inp.addEventListener('change', () => {
            const id = inp.dataset.id;
            const field = inp.dataset.field;
            let val = inp.value;
            if (field === 'duration') val = parseInt(val, 10) || 0;
            else if (field === 'active') val = (val === 'true');
            else if (field === 'pct') val = Math.min(100, Math.max(0, parseInt(val, 10) || 0));
            SM.updateTask(id, {
                [field]: val
            }, { name: `Edit ${field}` });
            window.dispatchEvent(new CustomEvent('refresh-needed'));
        });
    });
}

export function applyBulk() {
    if (SEL.size === 0) {
        showToast('Select some tasks first');
        return;
    }
    const s = SM.get();
    const ids = new Set(SEL);
    let changed = 0;
    for (const t of s.tasks) {
        if (!ids.has(t.id)) continue;
        changed++;
        const phase = $('#bulkPhase').value.trim();
        if (phase) t.phase = phase;
        const sub = $('#bulkSub').value;
        if (sub) t.subsystem = sub;
        const act = $('#bulkActive').value;
        if (act !== '') t.active = (act === 'true');
        const pfx = $('#bulkPrefix').value || '';
        if (pfx) t.name = pfx + ' ' + (t.name || '');
        const addDep = $('#bulkAddDep').value.trim();
        if (addDep) {
            t.deps = (t.deps || []).concat([addDep]);
        }
        if ($('#bulkClearDeps').checked) t.deps = [];
        const durV = $('#bulkDur').value;
        if (durV !== '') {
            const n = parseInt(durV, 10) || 0;
            if ($('#bulkDurMode').value === 'set') t.duration = n;
            else t.duration = Math.max(0, parseDurationStrict(t.duration).days + n);
        }
        const shift = $('#bulkShift').value;
        if (shift !== '') {
            const d = parseInt(shift, 10) || 0;
            const es = t.es || 0;
            t.startConstraint = { type: 'SNET', day: Math.max(0, es + d) };
        }
        const pctV = $('#bulkPct').value;
        if (pctV !== '') {
            const n = Math.min(100, Math.max(0, parseInt(pctV, 10) || 0));
            t.pct = n;
        }
    }
    SM.replaceTasks(s.tasks, { name: `Bulk Edit ${changed} task(s)` });
    showToast(`Bulk applied to ${changed} tasks`);
    window.dispatchEvent(new CustomEvent('refresh-needed'));
}

function matchesFilters(t) {
    const txt = ($('#filterText').value || '').toLowerCase();
    if (txt) {
        const inName = (t.name || '').toLowerCase().includes(txt);
        const inPhase = (t.phase || '').toLowerCase().includes(txt);
        if (!inName && !inPhase) return false;
    }
    const act = $$('#subsysFilters input[type="checkbox"]').filter(x => x.checked).map(x => x.value);
    if (act.length && !act.includes(t.subsystem || 'System')) return false;
    return true;
}
