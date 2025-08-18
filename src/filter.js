import { $, $$ } from './utils.js';

export function matchesFilters(t) {
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

export function getGroupKey(t) {
    const g = $('#groupBy').value || 'none';
    if (g === 'phase') return t.phase || '(no phase)';
    if (g === 'subsystem') return t.subsystem || 'System';
    return null;
}
