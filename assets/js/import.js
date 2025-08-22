// Simple CSV import with column mapping
// Allows user to select a CSV file, map columns and create tasks

document.addEventListener('DOMContentLoaded', () => {
  const input = document.getElementById('csvImport');
  if (!input) return;

  input.addEventListener('change', async () => {
    const file = input.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const lines = text.trim().split(/\r?\n/);
      if (lines.length < 2) {
        alert('CSV appears empty');
        return;
      }
      const headers = lines[0]
        .match(/"([^"\\]|\\"|"")*"|[^,]+/g)
        .map(h => h.replace(/^"|"$/g, '').replaceAll('""', '"'));

      // Ask user to map columns
      const ask = (field, def) => {
        const resp = prompt(`Column for "${field}"?\nOptions: ${headers.join(', ')}`, def);
        return headers.indexOf(resp);
      };
      const idx = {
        id: ask('id', 'id'),
        name: ask('name', 'name'),
        duration: ask('duration (days)', 'duration(d)'),
        deps: ask('deps', 'deps'),
        phase: ask('phase', 'phase'),
        subsystem: ask('subsystem', 'subsystem')
      };

      const tasks = lines.slice(1).map(row => {
        const cols = row
          .match(/"([^"\\]|\\"|"")*"|[^,]+/g)
          .map(c => c.replace(/^"|"$/g, '').replaceAll('""', '"'));
        const dur = parseDuration(cols[idx.duration] || '').days || 1;
        return {
          id: idx.id >= 0 ? cols[idx.id] || uid('t') : uid('t'),
          name: idx.name >= 0 ? cols[idx.name] : '',
          duration: dur,
          deps: idx.deps >= 0 ? (cols[idx.deps] || '').split(/[\s;]/).filter(Boolean) : [],
          phase: idx.phase >= 0 ? cols[idx.phase] : '',
          subsystem: idx.subsystem >= 0 ? cols[idx.subsystem] : '',
          active: true
        };
      });

      SM.set({ startDate: todayStr(), calendar: 'workdays', holidays: [], tasks }, { name: 'Import CSV' });
      alert('Imported ' + tasks.length + ' tasks');
      input.value = '';
    } catch (e) {
      console.warn('CSV import failed', e);
      alert('Failed to import CSV');
    }
  });
});
