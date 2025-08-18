import { $, $$ } from './utils.js';
import { todayStr, yyyymmdd_to_ddmmyyyy, ddmmyyyy_to_yyyymmdd, parseDate, fmtDate } from './utils.js';
import { validateProject } from './parsers.js';
import SM from './state.js';
import { renderGantt } from './ui/gantt.js';
import { renderGraph } from './ui/graph.js';
import { renderIssues } from './ui/issues.js';
import { renderFocus } from './ui/focus.js';
import { renderContextPanel, setLastCPMResult as setContextCPM } from './ui/context.js';
import { updateScenarioUI, updateBaselineUI, buildCompare, setBaseline, setLastCPMResult as setScenarioCPM } from './ui/scenario.js';
import { SEL, selectOnly, toggleSelect, clearSelection, moveSelection, deleteSelected, duplicateSelected, applyBulk } from './selection.js';
import { saveFile, openFile, exportCSV, insertTemplate } from './data.js';
import { InteractionManager } from './ui/interaction.js';
import { matchesFilters, getGroupKey } from './filter.js';

let cpmWorker;
let cpmRequestActive = false;
let lastCPMResult = null;
let graphInitialized = false;

function createCPMWorker() {
    return new Worker('./cpm-worker.js', { type: 'module' });
}

function setupLegend() {
    const box = $('#subsysFilters');
    box.innerHTML = '';
    const SUBS = ['power/VRM', 'PCIe', 'BMC', 'BIOS', 'FW', 'Mech', 'Thermal', 'System'];
    SUBS.forEach(name => {
        const cls = name.toLowerCase().replace(/[^a-z0-9]+/g, '_');
        const div = document.createElement('label');
        div.className = 'tag';
        div.innerHTML = `<input type="checkbox" checked value="${name}"><span class="dot ${cls}" style="background:var(--${cls.replace('_','')})"></span> ${name}`;
        box.appendChild(div);
    });
    $('#btnSubAll').onclick = () => $$('#subsysFilters input[type="checkbox"]').forEach(c => c.checked = true);
    $('#btnSubNone').onclick = () => $$('#subsysFilters input[type="checkbox"]').forEach(c => c.checked = false);
    $$('#subsysFilters input[type="checkbox"]').forEach(c => c.onchange = refresh);
}

function parseHolidaysInput() {
    const raw = $('#holidayInput').value || '';
    const tokens = raw.split(/[\s,]+/).filter(Boolean);
    const out = [];
    for (const t of tokens) {
        const m = t.match(/^\d{2}-\d{2}-\d{4}$/);
        if (m) {
            out.push(t);
        }
    }
    return out;
}

function triggerCPM(project) {
    if (!cpmWorker) {
        console.error("CPM Worker not initialized.");
        return;
    }
    if (cpmRequestActive) {
        return;
    }
    cpmRequestActive = true;
    const statusBadge = $('#cpmStatusBadge');
    if (statusBadge) statusBadge.style.display = 'inline-flex';
    cpmWorker.postMessage({ type: 'compute', project: SM.get() });
}

function renderAll(project, cpm) {
    if (!cpm) return;
    renderGantt(project, cpm);
    if ($('.tab[data-tab="graph"]').classList.contains('active')) {
        renderGraph(project, cpm);
    }
    renderFocus(project, cpm);
    renderIssues(project, cpm);
    renderContextPanel(null); // Initially no selection
    $('#boot').style.display = 'none';
    $('#appRoot').style.display = 'grid';
    if ($('.tab.active').dataset.tab === 'compare') buildCompare();
}

function refresh() {
    triggerCPM(SM.get());
}

function newProject() {
    SM.set({ startDate: todayStr(), calendar: 'workdays', holidays: [], tasks: [] }, { name: 'New Project' });
    $('#startDate').value = todayStr();
    $('#calendarMode').value = 'workdays';
    $('#holidayInput').value = '';
    clearSelection();
    refresh();
}

window.addEventListener('DOMContentLoaded', () => {
    try {
        if (window.Worker) {
            cpmWorker = createCPMWorker();
            cpmWorker.onmessage = function(e) {
                if (e.data.type === 'result') {
                    cpmRequestActive = false;
                    const statusBadge = $('#cpmStatusBadge');
                    if (statusBadge) statusBadge.style.display = 'none';
                    lastCPMResult = e.data.cpm;
                    SM.setCPMWarnings(lastCPMResult.warnings || []);
                    setContextCPM(lastCPMResult);
                    setScenarioCPM(lastCPMResult);
                    renderAll(SM.get(), lastCPMResult);
                }
            };
            cpmWorker.onerror = function(error) {
                console.error("CPM Worker Error:", error);
                cpmRequestActive = false;
            };
        } else {
            console.error("Web Workers are not supported in this browser.");
        }

        setupLegend();
        const saved = localStorage.getItem('hpc-project-planner-data');
        if (saved) {
            try {
                const project = JSON.parse(saved);
                SM.set(project, { record: false, noSave: true });
            } catch (e) {
                SM.set({ startDate: todayStr(), calendar: 'workdays', holidays: [], tasks: [] }, { record: false, name: 'Load Sample Project' });
            }
        } else {
            SM.set({ startDate: todayStr(), calendar: 'workdays', holidays: [], tasks: [] }, { record: false, name: 'Load Sample Project' });
        }

        const loadedState = SM.get();
        $('#startDate').value = ddmmyyyy_to_yyyymmdd(loadedState.startDate || todayStr());
        $('#calendarMode').value = loadedState.calendar || 'workdays';
        $('#holidayInput').value = (loadedState.holidays || []).join(', ');

        refresh();

        SM.onChange(() => {
            $('#btnUndo').disabled = !SM.canUndo();
            $('#btnRedo').disabled = !SM.canRedo();
        });

        $$('.tab').forEach(t => t.onclick = () => {
            $$('.tab').forEach(x => x.classList.remove('active'));
            t.classList.add('active');
            $$('.view').forEach(v => v.classList.remove('active'));
            const viewId = t.dataset.tab;
            $('#' + viewId).classList.add('active');
            if (viewId === 'graph' && !graphInitialized) {
                if (lastCPMResult) {
                    renderGraph(SM.get(), lastCPMResult);
                    graphInitialized = true;
                } else {
                    refresh();
                }
            }
            if (viewId === 'compare') {
                buildCompare();
            }
        });

        // Event Listeners
        $('#slackThreshold').onchange = refresh;
        $('#calendarMode').onchange = () => {
            SM.setProjectProps({ calendar: $('#calendarMode').value }, { name: 'Change Calendar' });
            refresh();
        };
        $('#startDate').addEventListener('change', () => {
            SM.setProjectProps({ startDate: yyyymmdd_to_ddmmyyyy($('#startDate').value) }, { name: 'Change Start Date' });
            refresh();
        });
        $('#holidayInput').onchange = () => {
            SM.setProjectProps({ holidays: parseHolidaysInput() }, { name: 'Update Holidays' });
            refresh();
        };
        $('#severityFilter').onchange = () => renderIssues(SM.get(), lastCPMResult);
        $('#filterText').oninput = refresh;
        $('#groupBy').onchange = refresh;
        $('#btnFilterClear').onclick = () => {
            $('#filterText').value = '';
            $$('#subsysFilters input[type="checkbox"]').forEach(c => c.checked = true);
            refresh();
        };
        $('#btnSelectFiltered').onclick = () => {
            if (!lastCPMResult) return;
            const ids = new Set(lastCPMResult.tasks.filter(matchesFilters).map(t => t.id));
            ids.forEach(id => SEL.add(id));
            window.dispatchEvent(new CustomEvent('refresh-needed'));
        };
        $('#btnClearSel').onclick = () => {
            clearSelection();
            refresh();
        };
        $('#btnApplyBulk').onclick = applyBulk;
        $('#btnNew').onclick = newProject;
        $('#btnPrint').onclick = () => window.print();
        $('#btnGuide').onclick = () => document.getElementById('help-modal').style.display = 'flex';
        $('#btnUndo').onclick = () => { SM.undo(); refresh(); };
        $('#btnRedo').onclick = () => { SM.redo(); refresh(); };
        $('#btnSave').onclick = () => saveFile(JSON.stringify(SM.get(), null, 2));
        $('#btnLoad').onclick = async () => {
            const data = await openFile();
            if (!data) return;
            const { ok, project } = validateProject(data);
            if (ok) {
                SM.set(project, { name: 'Load Project' });
                refresh();
            }
        };
        $('#btnInsertTpl').onclick = () => {
            insertTemplate($('#tplSelect').value);
            refresh();
        };

        window.addEventListener('keydown', (e) => {
            const tag = (e.target.tagName || '').toLowerCase();
            if (e.target.isContentEditable || ['input', 'textarea', 'select'].includes(tag)) return;
            const k = e.key;
            if ((e.ctrlKey || e.metaKey) && !e.shiftKey && k.toLowerCase() === 'z') {
                e.preventDefault();
                SM.undo();
                refresh();
            } else if ((e.ctrlKey || e.metaKey) && (k.toLowerCase() === 'y' || (e.shiftKey && k.toLowerCase() === 'z'))) {
                e.preventDefault();
                SM.redo();
                refresh();
            } else if (k === 'Delete') {
                e.preventDefault();
                deleteSelected();
            } else if ((e.ctrlKey || e.metaKey) && k.toLowerCase() === 'd') {
                e.preventDefault();
                duplicateSelected();
            }
        });

        window.addEventListener('refresh-needed', refresh);
        window.addEventListener('render-context', (e) => renderContextPanel(e.detail.selectedId));

    } catch (err) {
        console.error(err);
        const box = $('#fatal');
        box.style.display = 'block';
        box.textContent = 'Startup error:\n' + (err && err.stack || String(err));
    }
});
