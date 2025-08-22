(function(){
  'use strict';

  const $ = (sel, el=document) => el.querySelector(sel);

  function uid(prefix='t'){
    return prefix+'_'+Math.random().toString(36).slice(2,8);
  }

  function parseCSV(text){
    const lines = text.trim().split(/\r?\n/);
    return lines.map(r => {
      const cols = r.match(/"([^" ]|""")*"|[^,]+/g) || [];
      return cols.map(s => s.replace(/^"|"$/g,'').replaceAll('""','"'));
    });
  }

  function showMapping(headers, rows){
    const overlay = document.createElement('div');
    overlay.id = 'csv-import-overlay';
    overlay.style.position = 'fixed';
    overlay.style.top = '20%';
    overlay.style.left = '50%';
    overlay.style.transform = 'translateX(-50%)';
    overlay.style.background = 'white';
    overlay.style.border = '1px solid #ccc';
    overlay.style.padding = '1em';
    overlay.style.zIndex = 1000;

    const fields = [
      {key:'id', label:'ID'},
      {key:'name', label:'Name'},
      {key:'duration', label:'Duration'},
      {key:'deps', label:'Dependencies'},
      {key:'phase', label:'Phase'},
      {key:'subsystem', label:'Subsystem'}
    ];

    const selects = {};
    let html = '<h3>Map CSV Columns</h3>';
    for(const f of fields){
      html += `<label style="display:block;margin-bottom:4px">${f.label}: <select id="map-${f.key}"></select></label>`;
    }
    html += '<div style="text-align:right;margin-top:8px"><button id="csvImportOk">Import</button> <button id="csvImportCancel">Cancel</button></div>';
    overlay.innerHTML = html;
    document.body.appendChild(overlay);

    for(const f of fields){
      const sel = overlay.querySelector(`#map-${f.key}`);
      sel.innerHTML = headers.map((h,i)=>`<option value="${i}">${h}</option>`).join('');
      const idx = headers.findIndex(h => h.replace(/\W+/g,'').toLowerCase().includes(f.key));
      if(idx>=0) sel.value = String(idx);
      selects[f.key] = sel;
    }

    overlay.querySelector('#csvImportCancel').onclick = () => document.body.removeChild(overlay);
    overlay.querySelector('#csvImportOk').onclick = () => {
      const tasks = rows.map(cols => ({
        id: cols[+selects.id.value] || uid('t'),
        name: cols[+selects.name.value] || '',
        duration: (()=>{ const d = parseDuration(cols[+selects.duration.value] || ''); return d.error ? 1 : d.days; })(),
        deps: (cols[+selects.deps.value] || '').split(/[\s;]/).filter(Boolean),
        phase: cols[+selects.phase.value] || '',
        subsystem: cols[+selects.subsystem.value] || 'System',
        active: true
      }));
      SM.set({ ...SM.get(), tasks }, { name: 'Import CSV' });
      document.body.removeChild(overlay);
    };
  }

  function startImport(){
    const fileInput = $('#csvImportInput');
    if(!fileInput) return;
    fileInput.onchange = async () => {
      const f = fileInput.files[0];
      if(!f) return;
      const text = await f.text();
      const [header, ...rows] = parseCSV(text);
      showMapping(header, rows);
      fileInput.value = '';
    };
    fileInput.click();
  }

  document.addEventListener('DOMContentLoaded', () => {
    const btn = $('#btnImportCSV');
    if(btn) btn.addEventListener('click', startImport);
  });

})();
