(function(){
'use strict';

function uid(prefix='t'){ return prefix+'_'+Math.random().toString(36).slice(2,8); }

function parseCSVLine(line){
  return line.match(/"([^"\\]|\\"|"")*"|[^,]+/g).map(s=>s.replace(/^"|"$/g,'').replace(/""/g,'"'));
}

function showMappingDialog(headers, done){
  const dlg=document.createElement('dialog');
  dlg.id='csvImportDialog';
  const fields=[
    {key:'id', label:'ID'},
    {key:'name', label:'Name'},
    {key:'duration', label:'Duration (days)'},
    {key:'deps', label:'Dependencies'},
    {key:'phase', label:'Phase'},
    {key:'subsystem', label:'Subsystem'}
  ];
  let html='<form method="dialog"><h3>Map CSV Columns</h3>';
  for(const f of fields){
    html+=`<label>${f.label}: <select data-field="${f.key}">`;
    html+='<option value="">(none)</option>';
    headers.forEach((h,i)=>{
      const norm=h.replace(/\W+/g,'').toLowerCase();
      const match=(norm===f.key)|| (f.key==='duration' && norm.startsWith('duration'));
      html+=`<option value="${i}"${match?' selected':''}>${h}</option>`;
    });
    html+='</select></label><br />';
  }
  html+='<menu><button value="cancel">Cancel</button><button id="csvImportGo" value="default">Import</button></menu></form>';
  dlg.innerHTML=html;
  document.body.appendChild(dlg);
  dlg.showModal();
  dlg.addEventListener('close',()=>{
    if(dlg.returnValue!=='default'){ dlg.remove(); return; }
    const mapping={};
    dlg.querySelectorAll('select').forEach(sel=>{ if(sel.value!=='') mapping[sel.dataset.field]=parseInt(sel.value,10); });
    dlg.remove();
    done(mapping);
  });
}

function importFromCSV(){
  const inp=document.createElement('input');
  inp.type='file';
  inp.accept='.csv';
  inp.onchange=async()=>{
    const f=inp.files[0];
    if(!f) return;
    const txt=await f.text();
    const lines=txt.trim().split(/\r?\n/);
    if(lines.length<2){ alert('No data found'); return; }
    const headers=parseCSVLine(lines[0]);
    showMappingDialog(headers, mapping=>{
      const tasks=[];
      for(let i=1;i<lines.length;i++){
        const line=lines[i];
        if(!line.trim()) continue;
        const cols=parseCSVLine(line);
        const t={
          id: mapping.id!=null? cols[mapping.id] : uid('t'),
          name: mapping.name!=null? cols[mapping.name] : '',
          duration: mapping.duration!=null? (parseDuration(cols[mapping.duration]).days||0) : 1,
          deps: mapping.deps!=null? (cols[mapping.deps]||'').split(/[\s;]/).filter(Boolean) : [],
          phase: mapping.phase!=null? cols[mapping.phase] : '',
          subsystem: mapping.subsystem!=null? cols[mapping.subsystem] : 'System',
          active: true
        };
        tasks.push(t);
      }
      if(tasks.length){
        if(typeof SM!=='undefined' && SM.addTasks){ SM.addTasks(tasks,{name:'Import CSV'}); }
        if(typeof showToast==='function') showToast(`Imported ${tasks.length} tasks`);
      }
    });
  };
  inp.click();
}

document.addEventListener('DOMContentLoaded',()=>{
  const btn=document.getElementById('btnImportCSV');
  if(btn) btn.addEventListener('click', importFromCSV);
});

window.importCSV=importFromCSV;

})();
