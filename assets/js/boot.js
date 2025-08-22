import './state/store.js';
import './app.js';

window.addEventListener('DOMContentLoaded', ()=>{
  const ss = SettingsStore.get();
  rafBatch(()=>{
    if (UI_FLAGS.topSettingsToolbar) {
      document.body.classList.add('top-toolbar');
    }
    setValue($('#slackThreshold'), ss.slackThreshold);
    setValue($('#filterText'), ss.filters.text);
    setValue($('#groupBy'), ss.filters.groupBy);
    setValue($('#calendarMode'), ss.calendar.mode);
    setValue($('#startDate'), ss.calendar.startDate);
    setValue($('#holidayInput'), (ss.calendar.holidays || []).join(', '));
  });
  SettingsStore.on('settings:changed', ()=> refresh());
  SettingsStore.on('filters:changed', ()=> refresh());
  try{
    if (window.Worker) {
        cpmWorker = createCPMWorker();

        cpmWorker.onmessage = function(e) {
            if (e.data.type === 'result') {
                cpmRequestActive = false;
                const statusBadge = $('#cpmStatusBadge');
                if(statusBadge) setStyle(statusBadge,'display','none');

                lastCPMResult = e.data.cpm;
                SM.setCPMWarnings(lastCPMResult.warnings || []);

                const s = SM.get();
                renderAll(s, lastCPMResult);
            }
        };

        cpmWorker.onerror = function(error) {
            console.error("CPM Worker Error:", error);
            cpmRequestActive = false;
            const statusBadge = $('#cpmStatusBadge');
            if(statusBadge) {
                setText(statusBadge,'Error!');
                setStyle(statusBadge,'backgroundColor','var(--error)');
            }
        };
    } else {
        console.error("Web Workers are not supported in this browser.");
        // Fallback or error message could be implemented here.
    }

    // Fallback for browsers that do not support input[type="date"]
    (function() {
      var input = document.createElement('input');
      input.setAttribute('type', 'date');
      var notADateValue = 'not-a-date';
      input.setAttribute('value', notADateValue);
      if (input.value === notADateValue) {
        var startDateInput = document.getElementById('startDate');
        if (startDateInput) {
          startDateInput.setAttribute('type', 'text');
          startDateInput.setAttribute('placeholder', 'DD-MM-YYYY');
          startDateInput.setAttribute('pattern', '\\d{2}-\\d{2}-\\d{4}');
        }
      }
    })();

    setupLegend();
    // seed with sample HPC flow
    const saved = localStorage.getItem('hpc-project-planner-data');
    if (saved) {
      try {
        const project = JSON.parse(saved);
        SM.set(project, {record: false, noSave: true});
        const lastSavedBadge = $('#lastSavedBadge');
        if (lastSavedBadge) {
          lastSavedBadge.innerHTML = `<span class="pill-icon" aria-hidden="true">💾</span> Loaded from storage`;
        }
        showToast('Loaded project from last session.');
      } catch (e) {
        console.warn('Failed to parse saved data, starting fresh.', e);
        SM.set({startDate: todayStr(), calendar:'workdays', holidays:[], tasks: templateHPC()},{record:false, name: 'Load Sample Project'});
      }
    } else {
      SM.set({startDate: todayStr(), calendar:'workdays', holidays:[], tasks: templateHPC()},{record:false, name: 'Load Sample Project'});
    }

    // Sync UI to loaded state, which also handles empty/missing start date
    const loadedState = SM.get();
    $('#startDate').value = ddmmyyyy_to_yyyymmdd(loadedState.startDate || todayStr());
    $('#calendarMode').value = loadedState.calendar || 'workdays';
    $('#holidayInput').value = (loadedState.holidays || []).join(', ');

    refresh();

    // reactive
    SM.onChange(()=>{ $('#btnUndo').disabled=!SM.canUndo(); $('#btnRedo').disabled=!SM.canRedo(); updateSelBadge(); });

    // tabs
    $$('.tab').forEach(t=> t.onclick=()=>{
        $$('.tab').forEach(x=>x.classList.remove('active'));
        t.classList.add('active');
        $$('.view').forEach(v=>v.classList.remove('active'));
        const viewId = t.dataset.tab;
        $('#'+viewId).classList.add('active');

        if (viewId === 'graph' && !graphInitialized) {
            if (lastCPMResult) {
                renderGraph(SM.get(), lastCPMResult);
                graphInitialized = true;
            } else {
                $('#graphSvg').innerHTML = '<text x="50%" y="50%" text-anchor="middle">Calculating graph data...</text>';
                refresh();
            }
        }

        if(viewId==='compare') {
            buildCompare();
        }
        if(viewId==='tasks') {
            renderTaskTable(SM.get(), lastCPMResult);
        }
    });

    // controls
    $('#slackThreshold').onchange = ()=>{ SettingsStore.set({slackThreshold: parseInt($('#slackThreshold').value,10)||0}); refresh(); };
    $('#calendarMode').onchange = ()=>{ SM.setProjectProps({calendar: $('#calendarMode').value}, {name: 'Change Calendar'}); SettingsStore.setCalendar({mode: $('#calendarMode').value}); refresh(); };
    const startDateInput = $('#startDate');
    const startDateError = $('#startDateError');

    function handleStartDateChange() {
      let value = startDateInput.value;
      if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        value = yyyymmdd_to_ddmmyyyy(value);
      }
      const dateRegex = /^\d{2}-\d{2}-\d{4}$/;

      const d = parseDate(value);
      if (!d || !dateRegex.test(value) || fmtDate(d) !== value) {
        startDateError.textContent = 'Invalid date. Please use DD-MM-YYYY format for a valid date.';
        startDateError.style.display = 'block';
        startDateInput.classList.add('error');
        return;
      }

      startDateError.style.display = 'none';
      startDateInput.classList.remove('error');
      SM.setProjectProps({startDate: value}, {name: 'Change Start Date'});
      SettingsStore.setCalendar({startDate: startDateInput.value});
      refresh();
    }

    startDateInput.addEventListener('change', handleStartDateChange);
    startDateInput.addEventListener('blur', handleStartDateChange);
    $('#holidayInput').onchange = ()=>{ SM.setProjectProps({holidays: parseHolidaysInput()}, {name: 'Update Holidays'}); SettingsStore.setCalendar({holidays: parseHolidaysInput()}); refresh(); };
    $('#severityFilter').onchange = ()=>{ renderIssues(SM.get(), lastCPMResult); };
    $('#filterText').oninput = ()=>{ SettingsStore.setFilters({text: $('#filterText').value}); refresh(); };
    $('#groupBy').onchange = ()=>{ SettingsStore.setFilters({groupBy: $('#groupBy').value}); refresh(); };
    $('#btnFilterClear').onclick=()=>{ $('#filterText').value=''; SettingsStore.setFilters({text: ''}); $$('#subsysFilters input[type="checkbox"]').forEach(c=>c.checked=true); refresh(); };
    $('#btnSelectFiltered').onclick=()=>{ if(!lastCPMResult) return; const ids=new Set(lastCPMResult.tasks.filter(matchesFilters).map(t=>t.id)); ids.forEach(id=>SEL.add(id)); updateSelBadge(); refresh(); };
    $('#btnClearSel').onclick=()=>{ clearSelection(); refresh(); };

    // bulk
    $('#btnApplyBulk').onclick=applyBulk; $('#btnBulkReset').onclick=()=>{ ['bulkPhase','bulkSub','bulkActive','bulkDur','bulkDurMode','bulkPrefix','bulkPct','bulkAddDep','bulkClearDeps','bulkShift'].forEach(id=>{ const el=document.getElementById(id); if(!el) return; if(el.type==='checkbox') el.checked=false; else if(el.tagName==='SELECT') el.selectedIndex=0; else el.value=''; }); };

    // scenarios
    updateScenarioUI();
    updateBaselineUI();
    $('#scenarioSelect') && ($('#scenarioSelect').onchange=(e)=>{ SC.switchTo(e.target.value); refresh(); });
    $('#btnScenarioNew') && ($('#btnScenarioNew').onclick=()=>{ const name=prompt('New scenario name'); if(!name) return; SC.saveAs(name); refresh(); });
    $('#btnScenarioSaveAs') && ($('#btnScenarioSaveAs').onclick=()=>{ const name=prompt('Save current as…'); if(!name) return; SC.saveAs(name); refresh(); });
    $('#btnOpenCompare') && ($('#btnOpenCompare').onclick=()=>{ $$('.tab').forEach(x=>x.classList.remove('active')); $('[data-tab="compare"]').classList.add('active'); $$('.view').forEach(v=>v.classList.remove('active')); $('#compare').classList.add('active'); buildCompare(); });
    $('#btnUseBaseline') && ($('#btnUseBaseline').onclick=()=>{ const id=$('#baselineSelect').value; CURRENT_BASELINE=id; buildCompare(); });
    $('#btnAddBaseline') && ($('#btnAddBaseline').onclick=()=>{ const name=prompt('Baseline name'); if(!name) return; SM.addBaseline(name); updateBaselineUI(); });

    // I/O
    $('#btnExportCSV').onclick=exportCSV;
    $('#btnExportJSON').onclick=()=>{ const project = SM.get(); project.schemaVersion = SCHEMA_VERSION; const json=JSON.stringify(project, null, 2); const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([json],{type:'application/json'})); a.download='project.json'; a.click(); URL.revokeObjectURL(a.href); };
    $('#btnSave').onclick=()=> { const project = SM.get(); project.schemaVersion = SCHEMA_VERSION; saveFile(JSON.stringify(project, null, 2)); };
    $('#btnLoad').onclick=async()=>{
      const data=await openFile();
      if(!data) return;

      const { ok, errors, warnings, project, migrated } = validateProject(data);

      if (errors.length > 0 || warnings.length > 0) {
        let message = '';
        if (errors.length > 0) {
          message += 'Errors found during import:\n' + errors.map(e => `- ${e.msg}`).join('\\n');
        }
        if (warnings.length > 0) {
          message += '\\n\\nWarnings:\\n' + warnings.map(w => `- ${w.msg}`).join('\\n');
        }

        if (!ok) {
          alert('Import failed!\\n\\n' + message);
          return;
        } else {
          if (!confirm('Project imported with some issues. Import anyway?\\n\\n' + message)) {
            return;
          }
        }
      }

      SM.set(project, {name: 'Load Project'});
      $('#startDate').value=SM.get().startDate;
      $('#calendarMode').value=SM.get().calendar;
      $('#holidayInput').value=(SM.get().holidays||[]).join(', ');
      clearSelection();
      refresh();
      if (migrated) {
        showToast('Project data was migrated to the latest version.');
      } else {
        showToast('Project loaded successfully.');
      }
    };
    $('#btnNew').onclick=newProject; $('#btnPrint').onclick=()=>window.print();
    $('#btnGuide').onclick=()=>document.getElementById('help-modal').style.display = 'flex';

    // theme
    const btnToggleTheme = $('#btnToggleTheme');
    btnToggleTheme.addEventListener('click', () => {
      const html = document.documentElement;
      html.classList.toggle('dark-mode');
      const isDarkMode = html.classList.contains('dark-mode');
      localStorage.setItem('theme', isDarkMode ? 'dark' : 'light');
      btnToggleTheme.querySelector('.btn-icon').textContent = isDarkMode ? '☀️' : '🌙';
    });
    if (document.documentElement.classList.contains('dark-mode')) {
        btnToggleTheme.querySelector('.btn-icon').textContent = '☀️';
    }


    // history
    $('#btnUndo').onclick=()=>{ SM.undo(); refresh(); };
    $('#btnRedo').onclick=()=>{ SM.redo(); refresh(); };
    window.addEventListener('keydown', (e)=>{
      const tag=(e.target.tagName||'').toLowerCase();
      if(e.target.isContentEditable || ['input','textarea','select'].includes(tag)) return;
      const k=e.key;
      if((e.ctrlKey||e.metaKey)&&!e.shiftKey && k.toLowerCase()==='z'){
        e.preventDefault(); SM.undo(); refresh();
      }else if((e.ctrlKey||e.metaKey) && (k.toLowerCase()==='y' || (e.shiftKey && k.toLowerCase()==='z'))){
        e.preventDefault(); SM.redo(); refresh();
      }else if(k==='Delete'){
        e.preventDefault(); deleteSelected();
      }else if((e.ctrlKey||e.metaKey) && k.toLowerCase()==='d'){
        e.preventDefault(); duplicateSelected();
      } else if (e.key === '?' || e.key === 'F1') {
        e.preventDefault();
        const helpModal = document.getElementById('new-help-modal');
        helpModal.style.display = helpModal.style.display === 'flex' ? 'none' : 'flex';
      } else if (e.ctrlKey || e.metaKey) {
        switch(k.toLowerCase()) {
          case 's': e.preventDefault(); $('#btnSave').click(); break;
          case 'o': e.preventDefault(); $('#btnLoad').click(); break;
          case 'p': e.preventDefault(); $('#btnPrint').click(); break;
        }
      }
    });

    // Guide modal
    (function(){ let step=1; const max=5; const modal=$('#guided-workflow'); function showStep(){ for(let i=1;i<=max;i++){ $('#wz'+i).style.display = (i===step)?'block':'none'; } $('#wzPrev').disabled = step===1; $('#wzNext').textContent = step===max? 'Done' : 'Next'; }
      $('#wzPrev').onclick=()=>{ if(step>1) step--; showStep(); };
      $('#wzNext').onclick=()=>{ if(step<max) step++; else modal.style.display='none'; showStep(); };
    })();

    // Zoom/Pan controls
    ZTL=InteractionManager($('#gantt')); const ZGR=InteractionManager($('#graphSvg'));
    $('#zoomInTL').onclick=ZTL.zoomIn; $('#zoomOutTL').onclick=ZTL.zoomOut; $('#zoomResetTL').onclick=ZTL.fit;
    $('#zoomInGR').onclick=ZGR.zoomIn; $('#zoomOutGR').onclick=ZGR.zoomOut; $('#zoomResetGR').onclick=ZGR.fit;

    // View-specific keyboard navigation
    const viewKeydownHandler = (e) => {
      if (['ArrowDown', 'ArrowRight'].includes(e.key)) {
        e.preventDefault();
        moveSelection(1);
      } else if (['ArrowUp', 'ArrowLeft'].includes(e.key)) {
        e.preventDefault();
        moveSelection(-1);
      } else if (e.key === 'Enter') {
        if (LAST_SEL) {
          e.preventDefault();
          const sidePanel = $('#side');
          sidePanel.focus();
          // Flash the panel to give a visual cue
          sidePanel.style.transition = 'none';
          sidePanel.style.boxShadow = '0 0 0 2px var(--c-accent)';
          setTimeout(() => {
            sidePanel.style.transition = 'box-shadow 0.4s ease-out';
            sidePanel.style.boxShadow = '';
          }, 400);
        }
      }
    };
    $('#timeline').addEventListener('keydown', viewKeydownHandler);
    $('#graph').addEventListener('keydown', viewKeydownHandler);

    // Templates
    $('#btnInsertTpl').onclick=()=> {
      insertTemplate($('#tplSelect').value);
      // The SM.addTasks in insertTemplate doesn't trigger a refresh, so force one.
      setTimeout(() => refresh(), 0);
    };
    $('#ctxMenu').onclick=(e)=>{ const act=e.target.dataset.action; const id=$('#ctxMenu').dataset.id; hideContextMenu(); if(!id||!act) return; if(act==='edit'){ selectOnly(id); refresh(); const inp=$('#inlineEdit input'); inp&&inp.focus(); } else if(act==='duplicate'){ selectOnly(id); duplicateSelected(); } else if(act==='delete'){ selectOnly(id); deleteSelected(); } else if(act==='adddep'){ const tok=prompt('Dependency token (e.g. FS:pred+2d)'); if(tok){ const s=SM.get(); const t=s.tasks.find(x=>x.id===id); if(t){ t.deps=(t.deps||[]).concat([tok]); SM.replaceTasks(s.tasks, {name: 'Add Dependency'}); refresh(); } } } };

    // --- Action Menu Handlers ---

    // 1. Export JSON
    $('#action-export-json').addEventListener('click', () => {
      const project = SM.get();
      project.schemaVersion = SCHEMA_VERSION;
      const json = JSON.stringify(project, null, 2);
      const blob = new Blob([json], {type: 'application/json'});
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'project.json';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(a.href);
      showToast('Project data exported to project.json');
    });

    // 2. Import JSON
    $('#action-import-json').addEventListener('click', async () => {
      try {
        const data = await openFile();
        if (!data) return; // User cancelled

        const { ok, errors, warnings, project, migrated } = validateProject(data);

        if (errors.length > 0 || warnings.length > 0) {
          let message = '';
          if (errors.length > 0) {
            message += 'Errors found during import:\\n' + errors.map(e => `- ${e.msg}`).join('\\n');
          }
          if (warnings.length > 0) {
            message += '\\n\\nWarnings:\\n' + warnings.map(w => `- ${w.msg}`).join('\\n');
          }

          if (!ok) {
            alert('Import failed!\\n\\n' + message);
            return;
          } else {
            if (!confirm('Project imported with some issues. Import anyway?\\n\\n' + message)) {
              return;
            }
          }
        }

        SM.set(project, { name: 'Import Project' });

        // Sync UI to new state
        $('#startDate').value = SM.get().startDate;
        $('#calendarMode').value = SM.get().calendar;
        $('#holidayInput').value = (SM.get().holidays || []).join(', ');
        clearSelection();
        refresh();

        if (migrated) {
          showToast('Project data was migrated to the latest version.');
        } else {
          showToast('Project imported successfully.');
        }
      } catch (e) {
        console.error("Import failed:", e);
        showToast('Error: Could not import file.');
        $('#fatal').textContent = `Import Error: ${e.message}. Please ensure the file is valid JSON.`;
        $('#fatal').style.display = 'block';
      }
    });

    // 3. Export PNG
    async function exportGanttToPng() {
      const svg = $('#gantt');
      if (!svg) {
        showToast('Error: Timeline SVG not found.');
        return;
      }
      showToast('Generating PNG...');

      // Clone the SVG to avoid modifying the original
      const svgClone = svg.cloneNode(true);

      // Collect all relevant CSS rules from all stylesheets
      let css = '';
      const selectors = [
        '.gantt', '.bar', '.axis', '.label', '.critical', '.milestone',
        '.progress', '.handle', '.groupHeader', '.groupLabel', '.taskNameBg',
        '#timeline', '.stripes-bg', '.stripes-line'
      ];
      for (const sheet of document.styleSheets) {
          try {
              for (const rule of sheet.cssRules) {
                  if (rule.selectorText && selectors.some(s => rule.selectorText.includes(s))) {
                      css += rule.cssText + '\n';
                  }
              }
          } catch (e) {
              console.warn("Could not read CSS rules from stylesheet:", e);
          }
      }

      // Add a style element to the SVG clone
      const styleEl = document.createElement('style');
      styleEl.textContent = css;
      svgClone.insertBefore(styleEl, svgClone.firstChild);

      const { width, height } = svg.getBoundingClientRect();
      svgClone.setAttribute('width', width);
      svgClone.setAttribute('height', height);

      // Serialize the SVG to a string and create a data URL
      const svgString = new XMLSerializer().serializeToString(svgClone);
      const svgBlob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
      const url = URL.createObjectURL(svgBlob);

      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        // Add padding for better aesthetics
        const padding = 20;
        canvas.width = width + padding * 2;
        canvas.height = height + padding * 2;
        const ctx = canvas.getContext('2d');

        // Fill background with current theme color
        const bgColor = getComputedStyle(document.documentElement).getPropertyValue('--c-bg').trim();
        ctx.fillStyle = bgColor || '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // Draw the SVG image onto the canvas
        ctx.drawImage(img, padding, padding);
        URL.revokeObjectURL(url);

        // Trigger download
        const pngUrl = canvas.toDataURL('image/png');
        const a = document.createElement('a');
        a.href = pngUrl;
        a.download = `timeline-export-${todayStr()}.png`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        showToast('PNG export complete.');
      };
      img.onerror = (err) => {
        console.error("PNG Export: Image loading failed.", err);
        showToast('Error exporting PNG. Check console for details.');
        URL.revokeObjectURL(url);
      };
      img.src = url;
    }
    $('#action-export-png').addEventListener('click', exportGanttToPng);

    // 4. Reset Demo Data
    $('#action-reset-demo').addEventListener('click', () => {
      if (confirm('Are you sure you want to reset to the demo project? All unsaved changes will be lost.')) {
        SM.set({
          startDate: todayStr(),
          calendar: 'workdays',
          holidays: [],
          tasks: templateHPC()
        }, { record: true, name: 'Reset to Demo' });
        refresh();
        showToast('Project has been reset to the demo data.');
      }
    });

    // 5. Toggle Theme
    $('#action-toggle-theme').addEventListener('click', () => {
      $('#toggle-theme').click(); // Reuse existing button's logic
      const isDark = document.documentElement.classList.contains('dark-mode');
      showToast(`Theme switched to ${isDark ? 'Dark' : 'Light'} Mode.`);
    });

    // 6. Help Modal
    $('#btn-help').addEventListener('click', () => {
      const helpModal = document.getElementById('new-help-modal');
      helpModal.style.display = 'flex';
    });

  }catch(err){
    console.error(err);
    const box=$('#fatal'); box.style.display='block'; box.textContent='Startup error:\n'+(err&&err.stack||String(err));
  }
});
