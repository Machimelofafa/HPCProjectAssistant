import { $, $$ } from '../utils.js';
import { esc } from '../utils.js';
import { parseDurationStrict, normalizeDeps, stringifyDep } from '../parsers.js';
import { renderIssues } from './issues.js';
import SM from '../state.js';
import { selectOnly, deleteSelected, duplicateSelected } from '../selection.js';

let lastCPMResult = null;

export function setLastCPMResult(cpm) {
    lastCPMResult = cpm;
}

export function renderContextPanel(selectedId) {
    const sidePanel = $('#side');
    if (!selectedId) {
        sidePanel.innerHTML = `<h3>Context</h3><div class="skeleton"></div><p style="text-align:center; color: var(--c-text-muted); padding: var(--space-4) 0;">No task selected.</p>`;
        return;
    }

    if (!lastCPMResult) {
        sidePanel.innerHTML = `<h3>Context</h3><div class="skeleton"></div><p style="text-align:center; color: var(--c-text-muted); padding: var(--space-4) 0;">Calculating...</p>`;
        return;
    }
    const project = SM.get();
    const cpm = lastCPMResult;
    const task = cpm.tasks.find(t => t.id === selectedId);

    if (!task) {
        sidePanel.innerHTML = `<h3>Context</h3><div class="skeleton"></div><p style="text-align:center; color: var(--c-text-muted); padding: var(--space-4) 0;">Task details not available.</p>`;
        return;
    }

    const duration = parseDurationStrict(task.duration).days || 0;
    const deps = normalizeDeps(task).map(d => stringifyDep(d)).join(', ') || 'None';
    const activeBtnText = task.active !== false ? 'Deactivate' : 'Activate';

    const html = `
    <h3 class="flex justify-between items-center" style="margin-bottom: var(--space-4);">
      <span>Task Details</span>
      ${task.critical ? '<span class="badge" style="background:var(--crit); color:white;">Critical</span>' : ''}
    </h3>
    <div class="context-panel-content" aria-live="polite">
      <div class="card" style="margin-bottom: var(--space-4);">
        <div class="card-content">
          <div class="card-label" style="font-weight: 700; color: var(--c-text); margin-bottom: var(--space-1);">${esc(task.name)}</div>
          <code style="color: var(--c-text-muted); font-size: 0.8em;">ID: ${esc(task.id)}</code>
        </div>
      </div>

      <div class="list" style="display: grid; gap: var(--space-2); margin-bottom: var(--space-6);">
        <div class="row" style="justify-content: space-between;"><strong>Duration</strong> <span class="badge">${duration} days</span></div>
        <div class="row" style="justify-content: space-between;"><strong>Slack</strong> <span class="badge">${task.slack} days</span></div>
        <div class="row" style="justify-content: space-between;"><strong>Status</strong> <span>${task.active !== false ? 'Active' : 'Inactive'}</span></div>
        <div class="row" style="flex-direction: column; align-items: flex-start; border-top: 1px solid var(--c-border); padding-top: var(--space-2); margin-top: var(--space-2);">
          <strong>Dependencies</strong>
          <code style="word-break: break-all; background: var(--c-bg); padding: var(--space-2); border-radius: var(--radius-sm); margin-top: var(--space-1); width: 100%;">${esc(deps)}</code>
        </div>
      </div>

      <h4 style="font-size: 0.9em; text-transform: uppercase; color: var(--c-text-muted); border-bottom: 1px solid var(--c-border); padding-bottom: var(--space-1); margin-bottom: var(--space-3);">CPM Timings (days)</h4>
      <div class="cards" style="grid-template-columns: 1fr 1fr; gap: var(--space-2); font-size: var(--font-size-sm); margin-bottom: var(--space-6);">
          <div class="card metric-card" style="padding: var(--space-2); text-align: center;"><div class="card-content"><div class="card-label">ES</div><div class="metric" style="font-size: 1.2rem;">${task.es}</div></div></div>
          <div class="card metric-card" style="padding: var(--space-2); text-align: center;"><div class="card-content"><div class="card-label">EF</div><div class="metric" style="font-size: 1.2rem;">${task.ef}</div></div></div>
          <div class="card metric-card" style="padding: var(--space-2); text-align: center;"><div class="card-content"><div class="card-label">LS</div><div class="metric" style="font-size: 1.2rem;">${task.ls}</div></div></div>
          <div class="card metric-card" style="padding: var(--space-2); text-align: center;"><div class="card-content"><div class="card-label">LF</div><div class="metric" style="font-size: 1.2rem;">${task.lf}</div></div></div>
      </div>

      <div id="context-panel-warnings"></div>

      <h4 style="font-size: 0.9em; text-transform: uppercase; color: var(--c-text-muted); border-bottom: 1px solid var(--c-border); padding-bottom: var(--space-1); margin-bottom: var(--space-3);">Actions</h4>
      <div class="button-group" style="display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-2);">
        <button class="btn" id="ctx-btn-edit" title="Focus the editor fields for this task in the left sidebar">Edit</button>
        <button class="btn" id="ctx-btn-duplicate">Duplicate</button>
        <button class="btn" id="ctx-btn-toggle-active">${activeBtnText}</button>
        <button class="btn error" id="ctx-btn-delete">Delete</button>
      </div>
    </div>
  `;
    sidePanel.innerHTML = html;

    const { issues } = renderIssues(project, cpm);
    const taskIssues = issues.filter(it => it.taskId === selectedId);
    const warningsContainer = sidePanel.querySelector('#context-panel-warnings');

    if (taskIssues.length > 0 && warningsContainer) {
        warningsContainer.innerHTML = `
        <h4 style="font-size: 0.9em; text-transform: uppercase; color: var(--c-text-muted); border-bottom: 1px solid var(--c-border); padding-bottom: var(--space-1); margin-bottom: var(--space-3); margin-top: var(--space-6);">Warnings for this Task</h4>
        <div class="issues" style="margin:0; padding:0; max-height: 150px; overflow-y: auto;">
            ${taskIssues.map(it => `
                <div class="issue sev-${it.sev}" style="margin-bottom: var(--space-2);">
                    <div class="msg">${esc(it.msg)}</div>
                </div>
            `).join('')}
        </div>
      `;
    }

    $('#ctx-btn-edit').addEventListener('click', () => {
        selectOnly(task.id);
        window.dispatchEvent(new CustomEvent('refresh-needed'));
        const inlineEditor = $('#inlineEdit');
        if (inlineEditor) {
            inlineEditor.scrollIntoView({ behavior: 'smooth', block: 'center' });
            inlineEditor.style.transition = 'none';
            inlineEditor.style.backgroundColor = 'var(--accent-light)';
            setTimeout(() => {
                inlineeEditor.style.transition = 'background-color 0.5s';
                inlineEditor.style.backgroundColor = '';
            }, 500);
        }
    });

    $('#ctx-btn-duplicate').addEventListener('click', () => {
        selectOnly(task.id);
        duplicateSelected();
    });

    $('#ctx-btn-toggle-active').addEventListener('click', () => {
        const currentStatus = task.active !== false;
        SM.updateTask(task.id, { active: !currentStatus }, { name: currentStatus ? 'Deactivate Task' : 'Activate Task' });
        window.dispatchEvent(new CustomEvent('refresh-needed'));
    });

    $('#ctx-btn-delete').addEventListener('click', () => {
        if (confirm(`Are you sure you want to delete task "${task.name}"?`)) {
            selectOnly(task.id);
            deleteSelected();
        }
    });
}
