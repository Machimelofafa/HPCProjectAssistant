import { $, $$ } from '../utils.js';
import { esc } from '../utils.js';
import { normalizeDeps } from '../parsers.js';
import { colorFor } from './colors.js';
import { SEL, selectOnly, toggleSelect } from '../selection.js';
import { matchesFilters } from '../filter.js';

function wrapText(text, maxChars) {
    if (!text) return [''];
    const words = String(text).split(' ');
    const lines = [];
    let currentLine = '';
    for (const word of words) {
        if ((currentLine + ' ' + word).length > maxChars && currentLine.length > 0) {
            lines.push(currentLine);
            currentLine = word;
        } else {
            if (currentLine.length > 0) currentLine += ' ';
            currentLine += word;
        }
    }
    if (currentLine.length > 0) {
        lines.push(currentLine);
    }
    return lines.length > 0 ? lines : [''];
}

function layoutDAG(tasks) {
    const byLevel = new Map();
    const K = 120; // Increased vertical spacing
    const nodeSpacing = 40; // Explicit horizontal spacing
    const charWidth = 8.5; // Estimated width of a character
    const minWidth = 180;
    const maxWidth = 320; // Max width before wrapping

    for (const t of tasks) {
        const lvl = t.es;
        const y = Math.round(lvl / 5);
        if (!byLevel.has(y)) byLevel.set(y, []);
        byLevel.get(y).push(t);
    }

    const pos = new Map();
    for (const [lvl, arr] of byLevel) {
        arr.sort((a, b) => (a.phase || '').localeCompare(b.phase || ''));
        let x = 40;
        for (const t of arr) {
            const name = t.name || '';
            // Determine width first
            const calculatedWidth = name.length * charWidth + 20;
            const width = Math.max(minWidth, Math.min(maxWidth, calculatedWidth));

            // Now determine height based on wrapping with the chosen width
            const charLimit = Math.floor((width - 20) / charWidth);
            const lines = wrapText(name, charLimit);
            const height = 28 + lines.length * 16;

            pos.set(t.id, { x, y: 40 + lvl * K, width, height });
            x += width + nodeSpacing;
        }
    }
    return pos;
}

export function renderGraph(project, cpm) {
    const svg = $('#graphSvg');
    svg.innerHTML = '';
    const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
    defs.innerHTML = `<marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#94a3b8"/></marker>`;
    svg.appendChild(defs);
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    svg.appendChild(g);
    const tasks = cpm.tasks.filter(matchesFilters);
    const id2 = Object.fromEntries(cpm.tasks.map(t => [t.id, t]));
    const pos = layoutDAG(tasks);

    for (const t of tasks) {
        const edges = normalizeDeps(t);
        for (const e of edges) {
            const d = e.pred;
            if (!id2[d] || !matchesFilters(id2[d])) continue;
            const p1 = pos.get(d),
                p2 = pos.get(t.id);
            if (!p1 || !p2) continue;
            const line = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            line.setAttribute('d', `M ${p1.x + p1.width} ${p1.y + p1.height / 2} L ${p2.x - 12} ${p2.y + p2.height / 2}`);
            line.setAttribute('class', 'edge arrow' + (t.critical && id2[d].critical ? ' critical' : ''));
            g.appendChild(line);
        }
    }

    for (const t of tasks) {
        const p = pos.get(t.id);
        if (!p) continue;
        const node = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        node.setAttribute('class', 'node' + (t.critical ? ' critical' : ''));
        node.setAttribute('data-id', t.id);
        if (SEL.has(t.id)) node.classList.add('selected');
        const color = colorFor(t.subsystem);

        const charLimit = Math.floor((p.width - 20) / 8.5);
        const titleLines = wrapText(esc(t.name), charLimit);

        const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        rect.setAttribute('x', p.x);
        rect.setAttribute('y', p.y);
        rect.setAttribute('width', p.width);
        rect.setAttribute('height', p.height);
        rect.setAttribute('style', `stroke:${color}`);
        rect.setAttribute('rx', "8");
        rect.setAttribute('fill', "#fff");
        node.appendChild(rect);

        const titleText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        titleText.setAttribute('x', p.x + 10);
        titleText.setAttribute('y', p.y + 20);
        titleText.setAttribute('class', 'title');

        titleLines.forEach((line, i) => {
            const tspan = document.createElementNS('http://www.w3.org/2000/svg', 'tspan');
            tspan.setAttribute('x', p.x + 10);
            tspan.setAttribute('dy', i === 0 ? '0' : '1.2em');
            tspan.textContent = line;
            titleText.appendChild(tspan);
        });
        node.appendChild(titleText);

        const metaText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        metaText.setAttribute('x', p.x + 10);
        metaText.setAttribute('y', p.y + p.height - 8);
        metaText.setAttribute('fill', '#64748b');
        metaText.textContent = `${esc(t.phase||'')} • ${esc(String(t.duration))}d • slack ${esc(String(t.slack))}`;
        node.appendChild(metaText);

        node.addEventListener('click', (ev) => {
            if (ev.shiftKey || ev.metaKey || ev.ctrlKey) {
                toggleSelect(t.id);
            } else {
                selectOnly(t.id);
            }
            window.dispatchEvent(new CustomEvent('refresh-needed'));
        });
        g.appendChild(node);
    }
}
