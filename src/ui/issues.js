import { $, $$ } from '../utils.js';
import { esc } from '../utils.js';
import { parseDurationStrict, parseDepToken } from '../parsers.js';
import SM from '../state.js';
import { selectOnly } from '../selection.js';

const WarningEngine = (function() {
    let seq = 0;

    function _push(warnings, FIX, sev, msg, opts = {}) {
        const id = 'w_' + (++seq);
        const it = { id, sev, msg, ...opts };
        if (opts.fix) {
            FIX[id] = opts.fix;
            it.hasFix = true;
        }
        warnings.push(it);
    }

    function checkTaskProperties(project, cpm, warnings, FIX) {
        const push = (...args) => _push(warnings, FIX, ...args);
        const seenIds = new Set();
        const dupIds = new Set();
        for (const t of project.tasks) {
            if (t.id && seenIds.has(t.id)) dupIds.add(t.id);
            if (t.id) seenIds.add(t.id);
        }

        if (dupIds.size > 0) {
            push('critical', `Duplicate task ID(s) found: ${Array.from(dupIds).join(', ')}`, {
                fix: () => {
                    const s = SM.get();
                    const used = new Set();
                    s.tasks.forEach(t => {
                        if (t.id && used.has(t.id)) {
                            t.id = uid('t');
                        }
                        used.add(t.id);
                    });
                    SM.replaceTasks(s.tasks, { name: 'Fix Duplicate IDs' });
                }
            });
        }

        for (const t of project.tasks) {
            if (!t.id || String(t.id).trim() === '') {
                push('error', `Task found with missing ID.`, { taskId: t.id,
                    fix: () => { SM.updateTask(t.id, { id: uid('t') }, { name: 'Assign Missing ID' }); }
                });
            }
            if (!t.name || String(t.name).trim() === '') {
                push('error', `Task has a missing name.`, { taskId: t.id,
                    fix: () => { SM.updateTask(t.id, { name: `Task ${t.id}` }, { name: 'Assign Missing Name' }); }
                });
            }
            const pd = parseDurationStrict(t.duration);
            if (pd.error) {
                push('error', `Invalid duration: ${pd.error}`, { taskId: t.id,
                    fix: () => { SM.updateTask(t.id, { duration: 1 }, { name: 'Fix Invalid Duration' }); }
                });
            }
        }
    }

    function checkDependencies(project, cpm, warnings, FIX) {
        const push = (...args) => _push(warnings, FIX, ...args);
        const id2 = Object.fromEntries(project.tasks.map(t => [t.id, t]));

        for (const t of project.tasks) {
            const depStrings = t.deps || [];
            const seen = new Set();
            for (const tok of depStrings) {
                const d = parseDepToken(tok);
                if (!d) continue;
                if (d.pred === t.id) {
                    push('critical', `Self-dependency is not allowed.`, { taskId: t.id,
                        fix: () => { SM.updateTask(t.id, { deps: (t.deps || []).filter(x => x !== tok) }, { name: 'Remove Self-Dependency' }); }
                    });
                }
                if (!id2[d.pred]) {
                    push('error', `Links to missing dependency: "${d.pred}".`, { taskId: t.id,
                        fix: () => { SM.addTasks([{ id: d.pred, name: `New: ${d.pred}`, duration: 1, deps: [] }], { name: 'Add Missing Dependency' }); }
                    });
                }
                if (seen.has(d.pred)) {
                    push('warn', `Duplicate dependency on "${d.pred}".`, { taskId: t.id,
                        fix: () => {
                            const s = SM.get();
                            const T = s.tasks.find(x => x.id === t.id);
                            const seen2 = new Set();
                            T.deps = (T.deps || []).filter(x => {
                                const p = parseDepToken(x);
                                if (!p || seen2.has(p.pred)) return false;
                                seen2.add(p.pred);
                                return true;
                            });
                            SM.replaceTasks(s.tasks, { name: 'Remove Duplicate Dependency' });
                        }
                    });
                }
                seen.add(d.pred);
                if (id2[d.pred] && id2[d.pred].active === false) {
                    push('warn', `Predecessor "${d.pred}" is inactive.`, { taskId: t.id,
                        fix: () => { SM.updateTask(d.pred, { active: true }, { name: 'Activate Predecessor' }); }
                    });
                }
            }
        }
    }

    function checkCycles(project, cpm, warnings, FIX) {
        const push = (...args) => _push(warnings, FIX, ...args);
        if (cpm && cpm.tasks.length !== project.tasks.filter(t => t.active !== false).length) {
            push('critical', `Circular dependency detected or invalid graph structure. Some tasks are excluded from calculation.`);
        }
    }

    function checkSchedule(project, cpm, warnings, FIX) {
        const push = (...args) => _push(warnings, FIX, ...args);
        if (!project.startDate) {
            push('error', 'Project start date is missing.', {
                fix: () => SM.setProjectProps({ startDate: todayStr() }, { name: 'Set Start Date' })
            });
        }

        if (!cpm || !cpm.tasks) return;
        const cpmMap = Object.fromEntries(cpm.tasks.map(t => [t.id, t]));
        const id2 = Object.fromEntries(project.tasks.map(t => [t.id, t]));

        for (const t of cpm.tasks) {
            const cur = id2[t.id];
            if (!cur) continue;

            if (cur.startConstraint && cur.startConstraint.type === 'MSO') {
                const esReq = 0; // Simplified
                if (esReq > (cur.startConstraint.day | 0)) {
                    push('error', `MSO violated: must start on/after day ${esReq}, but set to ${cur.startConstraint.day}.`, { taskId: t.id,
                        fix: () => { SM.updateTask(t.id, { startConstraint: { ...cur.startConstraint, day: esReq } }, { name: 'Fix MSO Violation' }); }
                    });
                }
            }
            const dur = parseDurationStrict(cur.duration).days || 0;
            const isMilestone = String(cur.name || '').toLowerCase().includes('gate') || String(cur.phase || '').toLowerCase().includes('gate');
            if (dur === 0 && !isMilestone) {
                push('info', `Zero-duration task. Consider making it a milestone or setting duration to 1d.`, { taskId: t.id,
                    fix: () => { SM.updateTask(t.id, { duration: 1 }, { name: 'Set Duration to 1d' }); }
                });
            }
        }
    }

    function run(project, cpm) {
        const warnings = [];
        const FIX = {};
        seq = 0;

        checkTaskProperties(project, cpm, warnings, FIX);
        checkDependencies(project, cpm, warnings, FIX);
        checkCycles(project, cpm, warnings, FIX);
        checkSchedule(project, cpm, warnings, FIX);

        const cpmWarnings = SM.lastCPMWarns() || [];
        warnings.push(...cpmWarnings);

        const seen = new Set();
        const uniqueWarnings = [];
        for (const w of warnings) {
            const key = `${w.sev}|${w.msg}|${w.taskId || ''}`;
            if (!seen.has(key)) {
                seen.add(key);
                uniqueWarnings.push(w);
            }
        }

        return { warnings: uniqueWarnings, FIX };
    }

    return { run };
})();

function collectIssues(project, cpm) {
    const { warnings, FIX } = WarningEngine.run(project, cpm);
    return { issues: warnings, FIX };
}

export function renderIssues(project, cpm, targetSel) {
    const { issues, FIX } = collectIssues(project, cpm);

    const counts = { critical: 0, error: 0, warn: 0, info: 0 };
    for (const it of issues) {
        if (counts[it.sev] !== undefined) {
            counts[it.sev]++;
        }
    }
    const badgesContainer = $('#warning-badges');
    if (badgesContainer) {
        badgesContainer.innerHTML = ['critical', 'error', 'warn', 'info'].map(sev => {
            if (counts[sev] > 0) {
                return `<span class="badge sev-${sev}" style="background:var(--${sev});color:white;margin-left:4px;border-radius:6px;padding:2px 6px;font-size:0.8em;" title="${counts[sev]} ${sev} issues">${counts[sev]}</span>`;
            }
            return '';
        }).join('');
    }

    const filter = $('#severityFilter').value || 'all';
    const box = $(targetSel || '#issues');
    box.innerHTML = '';

    const rank = { info: 1, warn: 2, error: 3, critical: 4 };
    const filterRankMap = { 'critical': 4, 'error': 3, 'warn': 2, 'info': 1 };
    const filterRank = filterRankMap[filter.split(' ')[0]] || 0;

    const filteredIssues = issues.filter(it => {
        if (filter === 'all') return true;
        if (filter === 'info') return it.sev === 'info';
        return rank[it.sev] >= filterRank;
    });

    if (!filteredIssues.length) {
        const ok = document.createElement('div');
        ok.className = 'issue sev-info';
        ok.innerHTML = '<span class="msg">No validation issues for this filter.</span>';
        box.appendChild(ok);
        return;
    }

    const groups = new Map();
    for (const it of filteredIssues) {
        if (!groups.has(it.msg)) {
            groups.set(it.msg, []);
        }
        groups.get(it.msg).push(it);
    }

    for (const [msg, items] of groups) {
        const details = document.createElement('details');
        details.open = true;

        const firstItem = items[0];
        const sev = firstItem.sev;
        const hasFix = items.some(it => it.hasFix);

        const summary = document.createElement('summary');
        summary.className = `issue sev-${sev}`;
        summary.style.display = 'grid';
        summary.style.gridTemplateColumns = '1fr auto';
        summary.style.alignItems = 'center';

        const badge = `<span class="badge" style="background:var(--${sev});color:white;margin-left:8px;border-radius:6px;padding:2px 6px;font-size:0.8em;">${items.length}</span>`;
        const fixButtonGroup = hasFix && !targetSel && items.length > 1 ? `<button class="btn small fix-btn" data-fix-group="${esc(msg)}">Fix All</button>` : '';

        summary.innerHTML = `
            <div class="msg">${esc(msg)} ${badge}</div>
            <div class="actions">${fixButtonGroup}</div>
        `;

        details.appendChild(summary);

        const list = document.createElement('div');
        list.style.paddingLeft = '20px';
        list.style.borderTop = '1px solid var(--line)';
        list.style.paddingTop = '8px';
        list.style.marginTop = '4px';


        for (const it of items) {
            const row = document.createElement('div');
            row.className = 'row';
            row.style.justifyContent = 'space-between';
            const taskName = it.taskId ? (project.tasks.find(t => t.id === it.taskId)?.name || it.taskId) : 'Project-wide';
            const fixBtn = it.hasFix && !targetSel ? `<button class="btn small fix-btn" data-i="${it.id}">Fix</button>` : '';
            row.innerHTML = `
                <span class="meta" style="cursor:pointer; text-decoration:underline;" data-task-id="${it.taskId}">Task: ${esc(taskName)}</span>
                <div class="actions">${fixBtn}</div>
            `;
            list.appendChild(row);
        }
        details.appendChild(list);
        box.appendChild(details);
    }

    if (!targetSel) {
        box.onclick = (e) => {
            const b = e.target.closest('.fix-btn');
            if (b) {
                e.preventDefault();
                const groupId = b.dataset.fixGroup;
                if (groupId) {
                    const itemsToFix = issues.filter(it => it.msg === groupId && it.hasFix);
                    let fixedCount = 0;
                    itemsToFix.forEach(it => {
                        const fn = FIX[it.id];
                        if (typeof fn === 'function') {
                            fn();
                            fixedCount++;
                        }
                    });
                    if (fixedCount > 0) {
                        showToast(`Applied ${fixedCount} fix(es).`);
                        window.dispatchEvent(new CustomEvent('refresh-needed'));
                    }
                } else {
                    const id = b.dataset.i;
                    const fn = FIX[id];
                    if (typeof fn === 'function') {
                        fn();
                        showToast('Applied fix');
                        window.dispatchEvent(new CustomEvent('refresh-needed'));
                    }
                }
                return;
            }

            const taskLink = e.target.closest('[data-task-id]');
            if (taskLink) {
                e.preventDefault();
                const taskId = taskLink.dataset.taskId;
                if (taskId) {
                    selectOnly(taskId);
                    window.dispatchEvent(new CustomEvent('refresh-needed'));
                    const bar = document.querySelector(`.bar[data-id="${taskId}"]`);
                    if (bar) {
                        bar.scrollIntoView({ behavior: 'smooth', block: 'center' });
                        bar.style.transition = 'outline 0.1s';
                        bar.style.outline = '2px solid var(--accent)';
                        setTimeout(() => bar.style.outline = '', 1000);
                    }
                }
            }
        };

        $('#btnAutoFix').onclick = () => {
            let fixedCount = 0;
            for (const it of issues) {
                if (it.hasFix && rank[it.sev] >= 3) {
                    const fn = FIX[it.id];
                    if (typeof fn === 'function') {
                        fn();
                        fixedCount++;
                    }
                }
            }
            if (fixedCount > 0) {
                showToast(`Auto-fix pass finished, applied ${fixedCount} fixes.`);
                window.dispatchEvent(new CustomEvent('refresh-needed'));
            } else {
                showToast('No critical issues to auto-fix.');
            }
        };
    }
}
