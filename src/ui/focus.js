import { $, $$ } from '../utils.js';
import { esc, fmtDate, parseDate } from '../utils.js';
import { renderIssues } from './issues.js';
import { makeCalendar } from '../calendar.js';

export function renderFocus(project, cpm) {
    $('#countMetric').textContent = String(cpm.tasks.length);
    const cal = makeCalendar(project.calendar, new Set(project.holidays || []));
    const finishDate = cal.add(parseDate(project.startDate), cpm.finishDays || 0);
    $('#finishMetric').textContent = fmtDate(finishDate);
    $('#critMetric').textContent = String(cpm.tasks.filter(t => t.critical).length);
    const th = +($('#slackThreshold').value || 0);
    const near = cpm.tasks.filter(t => t.slack <= th && !t.critical).sort((a, b) => a.slack - b.slack);
    const L = $('#nearList');
    L.innerHTML = '';
    for (const t of near) {
        const row = document.createElement('div');
        row.className = 'row';
        row.innerHTML = `<span>${esc(t.name)}</span><span class="slack">slack ${t.slack}d</span>`;
        L.appendChild(row);
    }
    // focus warnings = same as issues filter
    renderIssues(project, cpm, '#focusWarnings');
}
