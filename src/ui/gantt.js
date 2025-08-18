import { $, $$ } from '../utils.js';
import { parseDurationStrict } from '../parsers.js';
import { colorFor } from './colors.js';
import { SEL, selectOnly, toggleSelect } from '../selection.js';
import SM from '../state.js';
import { showContextMenu, showHint, hideHint, esc } from '../utils.js';
import { matchesFilters, getGroupKey } from '../filter.js';

export function renderGantt(project, cpm) {
    const svg = $('#gantt');
    svg.innerHTML = '';
    const W = (svg.getBoundingClientRect().width || 800);
    const H = (svg.getBoundingClientRect().height || 500);
    const tasksAll = cpm.tasks.slice();
    const tasks = tasksAll.filter(t => matchesFilters(t));

    const maxLen = Math.max(20, ...tasks.map(t => (t.name || '').length));
    const P = Math.min(400, 10 + maxLen * 8.5);

    const groups = {};
    const order = [];
    for (const t of tasks) {
        const k = getGroupKey(t);
        if (k == null) {
            order.push(['', [t]]);
            continue;
        }
        if (!groups[k]) groups[k] = [];
        groups[k].push(t);
    }
    if (Object.keys(groups).length) {
        for (const k of Object.keys(groups).sort()) {
            order.push([k, groups[k].sort((a, b) => (a.es - b.es) || (a.name || '').localeCompare(b.name || ''))]);
        }
    }
    if (!order.length) order.push(['', tasks.sort((a, b) => (a.es - b.es) || (a.name || '').localeCompare(b.name || ''))]);

    const rows = [];
    order.forEach(([k, arr]) => {
        if (k) {
            rows.push({ type: 'group', label: k });
        }
        arr.forEach(t => rows.push({ type: 'task', t }));
    });

    const rowH = 28;
    const chartH = Math.max(H, rows.length * rowH + 60);
    svg.setAttribute('viewBox', `0 0 ${W} ${chartH}`);
    svg.setAttribute('height', chartH);

    const finish = Math.max(10, cpm.finishDays || 10);
    const scale = (x) => P + (x * (W - P - 20)) / finish;
    const scaleInv = (px) => Math.round((px - P) * finish / (W - P - 20));

    const gAxis = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    gAxis.setAttribute('class', 'axis');
    const ticks = 10;
    for (let i = 0; i <= ticks; i++) {
        const x = scale(i * (finish / ticks));
        const l = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        l.setAttribute('x1', x);
        l.setAttribute('y1', 20);
        l.setAttribute('x2', x);
        l.setAttribute('y2', chartH - 20);
        l.setAttribute('stroke', '#e5e7eb');
        gAxis.appendChild(l);
        const t = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        t.setAttribute('x', x + 2);
        t.setAttribute('y', 14);
        t.textContent = Math.round(i * (finish / ticks)) + 'd';
        gAxis.appendChild(t);
    }
    svg.appendChild(gAxis);

    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    svg.appendChild(g);

    let y = 30;
    rows.forEach((r) => {
        if (r.type === 'group') {
            const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
            rect.setAttribute('x', 0);
            rect.setAttribute('y', y - 6);
            rect.setAttribute('width', P - 10);
            rect.setAttribute('height', 22);
            rect.setAttribute('class', 'groupHeader');
            g.appendChild(rect);
            const tx = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            tx.setAttribute('x', 8);
            tx.setAttribute('y', y + 8);
            tx.setAttribute('class', 'groupLabel');
            tx.textContent = r.label;
            g.appendChild(tx);
            y += 22;
            return;
        }
        const t = r.t;
        const x = scale(Math.max(0, t.es || 0)),
            w = Math.max(4, scale(Math.max(0, t.ef || 1)) - scale(Math.max(0, t.es || 0)));
        const bar = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        bar.setAttribute('class', 'bar' + (t.critical ? ' critical' : ''));
        bar.setAttribute('data-id', t.id);
        bar.setAttribute('role', 'listitem');
        const durVal = parseDurationStrict(t.duration).days || 0;
        const labelText = `${t.name}, phase ${t.phase || 'N/A'}, duration ${durVal} days, ${t.critical ? 'critical path' : 'slack ' + t.slack + ' days'}`;
        bar.setAttribute('aria-label', labelText);
        if (SEL.has(t.id)) bar.classList.add('selected');

        const col = colorFor(t.subsystem);
        const isMilestone = (parseDurationStrict(t.duration).days || 0) === 0;

        if (isMilestone) {
            bar.setAttribute('data-ms', '1');
            const diamond = document.createElementNS("http://www.w3.org/2000/svg", "rect");
            diamond.setAttribute("x", x - 6);
            diamond.setAttribute("y", y + 2);
            diamond.setAttribute("width", 12);
            diamond.setAttribute("height", 12);
            diamond.setAttribute("transform", `rotate(45 ${x} ${y+8})`);
            diamond.setAttribute("class", "milestone" + (t.critical ? ' critical' : ''));
            diamond.setAttribute("style", `stroke:${col}`);
            bar.appendChild(diamond);
        } else {
            const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
            rect.setAttribute("x", x);
            rect.setAttribute("y", y);
            rect.setAttribute("width", w);
            rect.setAttribute("height", 16);
            rect.setAttribute("style", `stroke:${col}`);
            bar.appendChild(rect);

            if (t.critical) {
                const overlay = document.createElementNS("http://www.w3.org/2000/svg", "rect");
                overlay.setAttribute('class', 'overlay');
                overlay.setAttribute('x', x);
                overlay.setAttribute('y', y);
                overlay.setAttribute('width', w);
                overlay.setAttribute('height', 16);
                bar.appendChild(overlay);
            }

            const progW = Math.max(0, Math.min(w, w * (t.pct || 0) / 100));
            if (progW > 0) {
                const prog = document.createElementNS("http://www.w3.org/2000/svg", "rect");
                prog.setAttribute("x", x);
                prog.setAttribute("y", y);
                prog.setAttribute("width", progW);
                prog.setAttribute("height", 16);
                prog.setAttribute("class", "progress");
                prog.setAttribute("fill", col);
                bar.appendChild(prog);
            }
            const left = document.createElementNS("http://www.w3.org/2000/svg", "rect");
            left.setAttribute("x", x - 3);
            left.setAttribute("y", y);
            left.setAttribute("width", 3);
            left.setAttribute("height", 16);
            left.setAttribute("class", "handle");
            left.setAttribute("data-side", "left");
            bar.appendChild(left);
            const right = document.createElementNS("http://www.w3.org/2000/svg", "rect");
            right.setAttribute("x", x + w);
            right.setAttribute("y", y);
            right.setAttribute("width", 3);
            right.setAttribute("height", 16);
            right.setAttribute("class", "handle");
            right.setAttribute("data-side", "right");
            bar.appendChild(right);
        }

        const nameBg = document.createElementNS("http://www.w3.org/2000/svg", "rect");
        const nameWidth = Math.max(80, (t.name || '').length * 8.5);
        nameBg.setAttribute("x", P - 10 - nameWidth);
        nameBg.setAttribute("y", y - 4);
        nameBg.setAttribute("width", nameWidth + 4);
        nameBg.setAttribute("height", 24);
        nameBg.setAttribute("fill", "var(--bg)");
        nameBg.setAttribute("rx", "4");
        nameBg.setAttribute("class", "taskNameBg");
        nameBg.style.pointerEvents = 'none';
        bar.appendChild(nameBg);

        const label = document.createElementNS("http://www.w3.org/2000/svg", "text");
        label.setAttribute("class", "label");
        label.setAttribute("x", P - 8);
        label.setAttribute("y", y + 12);
        label.setAttribute("text-anchor", "end");
        bar.appendChild(label);

        const titleEl = document.createElementNS("http://www.w3.org/2000/svg", "title");
        titleEl.textContent = t.name;
        label.appendChild(titleEl);

        const name = t.name || '';
        const maxCharsPerLine = Math.floor((P - 20) / 8.5);

        if (name.length > maxCharsPerLine) {
            let breakPoint = name.lastIndexOf(' ', maxCharsPerLine);
            if (breakPoint === -1) breakPoint = maxCharsPerLine;

            const line1 = name.substring(0, breakPoint);
            const line2 = name.substring(breakPoint).trim();

            label.setAttribute("y", y + 6);

            const tspan1 = document.createElementNS("http://www.w3.org/2000/svg", "tspan");
            tspan1.textContent = line1;
            tspan1.setAttribute("x", P - 8);
            label.appendChild(tspan1);

            const tspan2 = document.createElementNS("http://www.w3.org/2000/svg", "tspan");
            tspan2.textContent = line2.length > maxCharsPerLine ? line2.substring(0, maxCharsPerLine - 1) + '…' : line2;
            tspan2.setAttribute("x", P - 8);
            tspan2.setAttribute("dy", "1.2em");
            label.appendChild(tspan2);

            nameBg.setAttribute('height', '40');
            nameBg.setAttribute('y', y - 6);

        } else {
            label.textContent = name;
        }
        const dur = document.createElementNS("http://www.w3.org/2000/svg", "text");
        dur.setAttribute("class", "label duration-label");
        dur.setAttribute("x", isMilestone ? x + 6 : x + w + 6);
        dur.setAttribute("y", y + 12);
        dur.textContent = String(t.duration) + "d";
        bar.appendChild(dur);
        if (!isMilestone) {
            if (w > 40 || (t.pct || 0) > 0) {
                const pct = document.createElementNS("http://www.w3.org/2000/svg", "text");
                pct.setAttribute("class", "label inbar");
                pct.setAttribute("x", x + 4);
                pct.setAttribute("y", y + 12);
                pct.textContent = (t.pct || 0) + "%";
                bar.appendChild(pct);
            }
        }
        bar.addEventListener('click', (ev) => {
            if (ev.shiftKey || ev.metaKey || ev.ctrlKey) {
                toggleSelect(t.id);
            } else {
                selectOnly(t.id);
            }
            window.dispatchEvent(new CustomEvent('refresh-needed'));
        });
        bar.addEventListener('contextmenu', (ev) => {
            ev.preventDefault();
            selectOnly(t.id);
            showContextMenu(ev.clientX, ev.clientY, t.id);
        });
        g.appendChild(bar);
        y += rowH;
    });

    // drag and drop logic
    let drag = null;
    svg.onpointerdown = (ev) => {
        const tgt = ev.target;
        const gg = tgt.closest('.bar');
        if (!gg || gg.dataset.ms) return;
        const id = gg.getAttribute('data-id');
        const rect = gg.querySelector('rect');
        const x0 = +rect.getAttribute('x');
        const w0 = +rect.getAttribute('width');
        const side = tgt.classList.contains('handle') ? tgt.getAttribute('data-side') : 'move';
        drag = { id, side, x0, w0, px0: ev.clientX, py0: ev.clientY, moved: false };
        gg.classList.add('moved');
    };
    svg.onpointermove = (ev) => {
        if (!drag) return;
        const dx = ev.clientX - drag.px0;
        const dy = ev.clientY - drag.py0;
        if (!drag.moved) {
            if (Math.abs(dx) < 2 && Math.abs(dy) < 2) return;
            drag.moved = true;
            svg.setPointerCapture(ev.pointerId);
        }
        const gg = $(`.bar[data-id="${drag.id}"]`, svg);
        const rect = gg.querySelector('rect');
        const labelNext = gg.querySelectorAll('text')[1];
        if (drag.side === 'right') {
            const newW = Math.max(4, drag.w0 + dx);
            rect.setAttribute('width', newW);
            const dur = scaleInv(+rect.getAttribute('x') + newW) - (cpm.tasks.find(t => t.id === drag.id).es || 0);
            labelNext.textContent = Math.max(1, dur) + 'd';
            hideHint();
            gg.classList.remove('invalid', 'valid');
        } else {
            const newX = Math.max(P, drag.x0 + dx);
            rect.setAttribute('x', newX);
            const esCand = scaleInv(newX);
            const cur = cpm.tasks.find(t => t.id === drag.id);
            const dur = cur.ef - cur.es;
            const allowed = 0; // Simplified for now
            const ok = (esCand >= allowed) || ev.shiftKey;
            labelNext.textContent = (cur.duration) + 'd';
            if (ok) {
                gg.classList.add('valid');
                gg.classList.remove('invalid');
                hideHint();
            } else {
                gg.classList.add('invalid');
                gg.classList.remove('valid');
                showHint(ev.clientX, ev.clientY, `Blocked: earliest ${allowed}d`);
            }
        }
    };
    svg.onpointerup = (ev) => {
        if (!drag) return;
        if (svg.hasPointerCapture && svg.hasPointerCapture(ev.pointerId)) svg.releasePointerCapture(ev.pointerId);
        hideHint();
        const gg = $(`.bar[data-id="${drag.id}"]`, svg);
        if (!drag.moved) {
            gg.classList.remove('moved', 'invalid', 'valid');
            drag = null;
            return;
        }
        const rect = gg.querySelector('rect');
        const x = +rect.getAttribute('x');
        const w = +rect.getAttribute('width');
        const esNew = scaleInv(x);
        const efNew = scaleInv(x + w);
        const durNew = Math.max(1, efNew - esNew);
        const cur = cpm.tasks.find(t => t.id === drag.id);
        if (drag.side === 'right') {
            SM.updateTask(drag.id, { duration: durNew }, { name: 'Update Duration' });
            showToast('Duration updated');
        } else {
            // Simplified logic
            const sc = { type: 'SNET', day: Math.max(0, esNew) };
            SM.updateTask(drag.id, { startConstraint: sc }, { record: true, name: 'Add SNET Constraint' });
            showToast('Added SNET to honor move');
        }
        gg.classList.remove('invalid', 'valid');
        drag = null;
        setTimeout(() => {
            window.dispatchEvent(new CustomEvent('refresh-needed'));
        }, 0);
    };

    const summaryContainer = $('#gantt-accessible-summary');
    if (summaryContainer) {
        summaryContainer.innerHTML = '';
        const list = document.createElement('ul');
        list.setAttribute('aria-label', 'List of project tasks');
        for (const r of rows) {
            if (r.type !== 'task') continue;
            const t = r.t;
            const li = document.createElement('li');
            const durVal = parseDurationStrict(t.duration).days || 0;
            li.innerHTML = `Task: <strong>${esc(t.name)}</strong> (Phase: ${esc(t.phase) || 'N/A'}).
        <span class="duration">Duration: ${durVal} days</span>.
        <span class="slack">Slack: ${t.slack} days</span>.
        Status: ${t.critical ? 'Critical' : 'Not Critical'}.`;
            list.appendChild(li);
        }
        summaryContainer.appendChild(list);
    }
}
