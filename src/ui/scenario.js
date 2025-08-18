import { $, $$ } from '../utils.js';
import { esc, fmtDate, parseDate } from '../utils.js';
import SM from '../state.js';
import { makeCalendar } from '../calendar.js';

let lastCPMResult = null;

export function setLastCPMResult(cpm) {
    lastCPMResult = cpm;
}

const SC = (function() {
    const scenarios = {};
    let current = 'Working';

    function snapshot() {
        return SM.get();
    }

    function saveAs(name) {
        scenarios[name] = snapshot();
        current = name;
        updateScenarioUI();
        showToast(`Saved as "${name}"`);
    }

    function switchTo(name) {
        if (!scenarios[name]) return;
        SM.set(scenarios[name], { name: `Switch to ${name}` });
        current = name;
        updateScenarioUI();
        showToast(`Switched to "${name}"`);
    }

    function get(name) {
        return scenarios[name] ? scenarios[name] : null;
    }

    function list() {
        return Object.keys(scenarios);
    }
    return { saveAs, switchTo, get, list, current: () => current };
})();

export function updateScenarioUI() {
    const sel = $('#scenarioSelect');
    if (sel) {
        sel.innerHTML = '';
        const items = SC.list();
        for (const name of items) {
            const opt = document.createElement('option');
            opt.value = name;
            opt.textContent = name;
            sel.appendChild(opt);
        }
        const badge = $('#scenarioBadge');
        if (badge) badge.textContent = `Scenario: ${SC.current()}`;
    }
}

export function updateBaselineUI() {
    const sel = $('#baselineSelect');
    if (sel) {
        sel.innerHTML = '';
        const items = SM.listBaselines();
        for (const b of items) {
            const opt = document.createElement('option');
            opt.value = b.id;
            opt.textContent = b.name;
            sel.appendChild(opt);
        }
    }
}

let CURRENT_BASELINE = null;

export function setBaseline(id) {
    CURRENT_BASELINE = id;
}

export function buildCompare() {
    const baseProj = CURRENT_BASELINE ? SM.getBaseline(CURRENT_BASELINE) : null;
    const curProj = SM.get();
    const L = $('#cmpList');
    if (!baseProj) {
        $('#cmpFinishA').textContent = '—';
        $('#cmpFinishB').textContent = '—';
        $('#cmpFinishDelta').textContent = '—';
        $('#cmpCritDelta').textContent = '—';
        L.innerHTML = '<div class="issue sev-info"><div class="msg">Select a baseline.</div></div>';
        return;
    }
    if (!lastCPMResult) {
        L.innerHTML = '<div class="issue sev-info"><div class="msg">Calculating current project...</div></div>';
        return;
    }
    const B = lastCPMResult;
    const calB = makeCalendar(curProj.calendar, new Set(curProj.holidays || []));
    const finishB = fmtDate(calB.add(parseDate(curProj.startDate), B.finishDays || 0));
    $('#cmpFinishB').textContent = finishB;
    const A = computeCPM(baseProj); // This is a temporary solution for the baseline
    const calA = makeCalendar(baseProj.calendar, new Set(baseProj.holidays || []));
    const finishA = fmtDate(calA.add(parseDate(baseProj.startDate), A.finishDays || 0));
    const delta = (B.finishDays || 0) - (A.finishDays || 0);
    const critA = new Set(A.tasks.filter(t => t.critical).map(t => t.id));
    const critB = new Set(B.tasks.filter(t => t.critical).map(t => t.id));
    const critDelta = Math.abs(critA.size - critB.size);
    $('#cmpFinishA').textContent = finishA;
    $('#cmpFinishDelta').textContent = String(delta);
    $('#cmpCritDelta').textContent = String(critDelta);
    L.innerHTML = '';
    const meta = SM.listBaselines().find(b => b.id === CURRENT_BASELINE);
    const header = document.createElement('div');
    header.className = 'issue sev-info';
    header.innerHTML = `<div class="msg"><b>${esc(meta?meta.name:'Baseline')}</b> • Δfinish ${delta}d • Δcritical ${critDelta}</div>`;
    L.appendChild(header);
    const mapA = Object.fromEntries(A.tasks.map(t => [t.id, t]));
    const mapB = Object.fromEntries(B.tasks.map(t => [t.id, t]));
    const rows = [];
    for (const id of Object.keys(mapB)) {
        const a = mapA[id];
        const b = mapB[id];
        if (!b) continue;
        const ds = (b.es || 0) - (a ? a.es || 0 : 0);
        const df = (b.ef || 0) - (a ? a.ef || 0 : 0);
        const dsl = (b.slack || 0) - (a ? a.slack || 0 : 0);
        rows.push({ name: b.name || id, ds, df, dsl });
    }
    rows.sort((x, y) => Math.abs(y.df) - Math.abs(x.df));
    rows.forEach(r => {
        const div = document.createElement('div');
        div.className = 'row';
        div.innerHTML = `<span>${esc(r.name)}</span><span class="slack">Δstart ${r.ds}d • Δfinish ${r.df}d • Δslack ${r.dsl}d</span>`;
        L.appendChild(div);
    });
}
