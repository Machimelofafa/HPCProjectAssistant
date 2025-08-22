(function(){
'use strict';

function parseCSV(text){
  const lines=text.trim().split(/\r?\n/);
  return lines.map(line=>{
    const cols=[]; let cur=''; let inQ=false;
    for(let i=0;i<line.length;i++){
      const ch=line[i];
      if(ch==='"'){
        if(inQ && line[i+1]==='"'){ cur+='"'; i++; }
        else inQ=!inQ;
      }else if(ch===',' && !inQ){ cols.push(cur); cur=''; }
      else{ cur+=ch; }
    }
    cols.push(cur);
    return cols.map(c=>c.replace(/^"|"$/g,'').replace(/""/g,'"'));
  });
}

function mapColumns(headers){
  const fields=[
    {key:'id', label:'Task ID'},
    {key:'name', label:'Name'},
    {key:'duration', label:'Duration (days)'},
    {key:'deps', label:'Dependencies'},
    {key:'phase', label:'Phase'},
    {key:'subsystem', label:'Subsystem'}
  ];
  const map={};
  for(const f of fields){
    let idx=headers.findIndex(h=>h.trim().toLowerCase()===f.label.toLowerCase().replace(/ \(.*\)/,''));
    if(idx<0) idx=headers.findIndex(h=>h.trim().toLowerCase()===f.key.toLowerCase());
    if(idx<0){
      const answer=prompt(`Column for ${f.label}?\nHeaders: ${headers.join(', ')}`,'');
      idx=headers.indexOf(answer);
    }
    map[f.key]=idx;
  }
  return map;
}

async function handleFile(file){
  const text=await file.text();
  const rows=parseCSV(text);
  if(!rows.length) return;
  const headers=rows[0];
  const mapping=mapColumns(headers);
  const tasks=[];
  for(let i=1;i<rows.length;i++){
    const r=rows[i];
    if(r.every(c=>!c.trim())) continue;
    const t={active:true};
    if(mapping.id>=0) t.id=r[mapping.id];
    if(mapping.name>=0) t.name=r[mapping.name];
    if(mapping.duration>=0){ const d=parseDuration(r[mapping.duration]||''); t.duration=d.error?1:d.days; }
    else t.duration=1;
    if(mapping.deps>=0) t.deps=r[mapping.deps].split(/[\s;]+/).filter(Boolean);
    if(mapping.phase>=0) t.phase=r[mapping.phase];
    if(mapping.subsystem>=0) t.subsystem=r[mapping.subsystem];
    tasks.push(t);
  }
  if(tasks.length){
    SM.addTasks(tasks,{name:'Import CSV'});
    if(typeof showToast==='function') showToast(`Imported ${tasks.length} tasks`);
  }
}

const fileInput=document.getElementById('inputImportCSV');
const btn=document.getElementById('btnImportCSV');
if(btn && fileInput){
  btn.addEventListener('click',()=>fileInput.click());
  fileInput.addEventListener('change',()=>{
    const f=fileInput.files[0];
    if(f) handleFile(f);
    fileInput.value='';
  });
}
})();
