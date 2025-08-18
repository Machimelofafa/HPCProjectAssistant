import { uid, slug } from './utils.js';
import { parseDurationStrict, parseDepToken, stringifyDep } from './parsers.js';
import SM from './state.js';

export async function saveFile(json) {
  const blob = new Blob([json], { type: 'application/json' });
  if (window.showSaveFilePicker) {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: 'project.hpc.json',
        types: [{ description: 'JSON', accept: { 'application/json': ['.json'] } }]
      });
      const w = await handle.createWritable();
      await w.write(blob);
      await w.close();
      return;
    } catch (e) {
      console.warn(e);
    }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'project.hpc.json';
  a.click();
  URL.revokeObjectURL(a.href);
}

export async function openFile() {
  if (window.showOpenFilePicker) {
    try {
      const [h] = await window.showOpenFilePicker({
        types: [{ description: 'JSON/CSV', accept: { 'application/json': ['.json'], 'text/csv': ['.csv'] } }]
      });
      const f = await h.getFile();
      const txt = await f.text();
      return f.name.endsWith('.csv') ? csvToProject(txt) : JSON.parse(txt);
    } catch (e) {
      console.warn(e);
    }
  }
  return new Promise((res) => {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = '.json,.csv';
    inp.onchange = async () => {
      const f = inp.files[0];
      const txt = await f.text();
      if (f.name.endsWith('.csv')) res(csvToProject(txt));
      else res(JSON.parse(txt));
    };
    inp.click();
  });
}

export function exportCSV() {
  const rows = [['id', 'name', 'duration(d)', 'deps', 'phase', 'subsystem']];
  for (const t of SM.get().tasks) {
    if (t.active === false) continue;
    rows.push([t.id, t.name, parseDurationStrict(t.duration).days || 0, (t.deps || []).join(' '), t.phase || '', t.subsystem || ''].map(x => `"${String(x).replaceAll('"', '""')}"`));
  }
  const csv = rows.map(r => r.join(',')).join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  a.download = 'project.csv';
  a.click();
  URL.revokeObjectURL(a.href);
}

export function csvToProject(csv) {
  const lines = csv.trim().split(/\r?\n/);
  const [header, ...rows] = lines;
  const idx = (k) => header.split(',').map(s => s.replace(/\W+/g, '').toLowerCase()).indexOf(k.toLowerCase());
  const iId = idx('id'),
    iName = idx('name'),
    iDur = idx('durationd'),
    iDeps = idx('deps'),
    iPhase = idx('phase'),
    iSub = idx('subsystem');
  const tasks = rows.map(r => {
    const cols = r.match(/\"([^\"]|\"\")*\"|[^,]+/g).map(s => s.replace(/^\"|\"$/g, '').replaceAll('""', '"'));
    const d = parseDurationStrict(+cols[iDur] || cols[iDur] || '');
    return {
      id: cols[iId] || uid('t'),
      name: cols[iName],
      duration: d.error ? 1 : d.days,
      deps: (cols[iDeps] || '').split(/[\s;]/).filter(Boolean),
      phase: cols[iPhase] || '',
      subsystem: cols[iSub] || 'System',
      active: true
    };
  });
  return { startDate: new Date().toLocaleDateString('en-CA'), calendar: 'workdays', holidays: [], tasks };
}

function ensureIds(list) {
  return list.map(t => ({ ...t, id: t.id || uid('t'), active: t.active !== false }));
}

function w(n) { return n * 5; }
function d(n) { return n; }

function templateHPC() {
  return ensureIds([
    { id: 'mobo_assembly', name: 'Carte mère assemblée (PCB+ASM)', duration: w(1), subsystem: 'System', phase: 'EVT L1' },
    { id: 'mobo_bringup_air', name: 'Bring-up carte mère (à air, pas de méca)', duration: w(8), deps: ['mobo_assembly'], subsystem: 'power/VRM', phase: 'EVT L1' },
    { id: 'power_bringup_bench', name: 'Bring-up power (banc)', duration: w(4), subsystem: 'power/VRM', phase: 'EVT L1' },
    { id: 'power_full_load', name: 'Power en puissance', duration: w(2), deps: ['power_bringup_bench'], subsystem: 'power/VRM', phase: 'EVT L1' },
    { id: 'power_rails_validated', name: 'Power rails validés (gate)', duration: d(0), deps: ['power_full_load'], subsystem: 'power/VRM', phase: 'EVT L1' },
    { id: 'bringup_other_cards', name: 'Bring-up autres cartes', duration: w(4), deps: ['mobo_bringup_air'], subsystem: 'System', phase: 'EVT L1' },
    { id: 'mech_deliveries', name: 'Livraison méca', duration: w(4), subsystem: 'Mech', phase: 'EVT L1' },
    { id: 'first_blade_assembly', name: '1ère lame assembly & corrections méca', duration: w(1), deps: ['mech_deliveries', 'mobo_bringup_air', 'bringup_other_cards', 'power_full_load'], subsystem: 'System', phase: 'EVT L1' },
    { id: 'remaining_blades_assembly', name: 'Assemblage lames restantes (~5)', duration: w(2), deps: ['first_blade_assembly'], subsystem: 'System', phase: 'EVT L1' },
    { id: 'mech_lvl1_lab', name: 'Méca L1 labo (WaterBox sans lame)', duration: w(1), deps: ['mech_deliveries'], subsystem: 'Mech', phase: 'EVT L1' },
    { id: 'blade_watercool_setup', name: 'Setup water cooling', duration: w(1), deps: ['remaining_blades_assembly', 'mech_lvl1_lab'], subsystem: 'Thermal', phase: 'EVT L2' },
    { id: 'l2_integration_evt', name: 'L2 tests (intégration lame)', duration: w(3), deps: ['blade_watercool_setup'], subsystem: 'System', phase: 'EVT L2' },
    { id: 'bmc_fw_evt', name: 'Dev FW BMC (EVT)', duration: w(4), deps: ['mobo_bringup_air'], subsystem: 'BMC', phase: 'EVT L2' },
    { id: 'bios_dev_evt', name: 'Dev BIOS (EVT)', duration: w(4), deps: ['power_rails_validated', 'blade_watercool_setup'], subsystem: 'BIOS', phase: 'EVT L2' },
    { id: 'sw_hal_evt', name: 'Dev SW HAL (EVT 20j)', duration: d(20), deps: ['blade_watercool_setup'], subsystem: 'FW', phase: 'EVT L2' },
    { id: 'evt_done', name: 'Fin EVT → GreenLight DVT', duration: d(0), deps: ['l2_integration_evt'], subsystem: 'System', phase: 'EVT' },
    { id: 'make_15_blades', name: 'Préparer ~15 lames DVT', duration: w(4), deps: ['evt_done'], subsystem: 'System', phase: 'DVT L3' },
    { id: 'fw_dev_dvt', name: 'Dev FW (BMC/BIOS) continue', duration: w(4), deps: ['make_15_blades'], subsystem: 'FW', phase: 'DVT L3' },
    { id: 'l2_integration_dvt', name: 'L2 intégration + interconnect (8w)', duration: w(8), deps: ['make_15_blades'], subsystem: 'System', phase: 'DVT L3' },
    { id: 'l1_thermal_cont', name: 'L1 thermique (TC) continue', duration: w(4), deps: ['make_15_blades'], subsystem: 'Thermal', phase: 'DVT L3' },
    { id: 'sw_hal_dvt', name: 'Dev SW HAL (DVT 60j)', duration: d(60), deps: ['make_15_blades', 'sw_hal_evt'], subsystem: 'FW', phase: 'DVT L3' },
    { id: 'l3_system_test', name: 'L3 tests système (8w)', duration: w(8), deps: ['l2_integration_dvt', 'fw_dev_dvt', 'sw_hal_dvt'], subsystem: 'System', phase: 'DVT L3' },
    { id: 'blade_for_angers', name: 'Lame pour Angers (usine)', duration: w(1), deps: ['make_15_blades'], subsystem: 'System', phase: 'DVT L3' },
    { id: 'dvt_done', name: 'Fin DVT', duration: d(0), deps: ['l3_system_test'], subsystem: 'System', phase: 'DVT' },
    { id: 'transfer_factory', name: 'Transfert à Angers / CdP usine', duration: w(1), deps: ['dvt_done'], subsystem: 'System', phase: 'PVT' },
    { id: 'train_assembly', name: 'Former montage lames', duration: w(1), deps: ['transfer_factory'], subsystem: 'System', phase: 'PVT' },
    { id: 'build_card_tester', name: 'Construire testeur carte', duration: w(3), deps: ['transfer_factory'], subsystem: 'System', phase: 'PVT' },
    { id: 'pretest_bench', name: 'Banc de pré‑test mémoire', duration: w(2), deps: ['transfer_factory'], subsystem: 'System', phase: 'PVT' },
    { id: 'pvt_launch_mfg', name: 'Lancer MFG PVT (cartes + méca)', duration: w(2), deps: ['transfer_factory'], subsystem: 'System', phase: 'PVT' },
    { id: 'parts_received', name: 'Réception pièces', duration: w(3), deps: ['pvt_launch_mfg'], subsystem: 'System', phase: 'PVT' },
    { id: 'mfg_process', name: 'Process MFG (ramp‑up)', duration: w(4), deps: ['parts_received'], subsystem: 'System', phase: 'PVT' },
    { id: 'pvt_done', name: 'Fin PVT', duration: d(0), deps: ['mfg_process'], subsystem: 'System', phase: 'PVT' }
  ]);
}

export function templateLib(which) {
  if (which === 'hpc') return templateHPC();
  if (which === 'sw') return ensureIds([
    { id: 'sw_backlog', name: 'Backlog grooming', duration: d(1), phase: 'Sprint‑0', subsystem: 'System' },
    { id: 'sw_planning', name: 'Sprint planning', duration: d(1), deps: ['sw_backlog'], phase: 'Sprint‑0', subsystem: 'System' },
    { id: 'sw_dev', name: 'Development', duration: d(8), deps: ['sw_planning'], phase: 'Sprint‑1', subsystem: 'FW' },
    { id: 'sw_ci', name: 'CI & Code review', duration: d(2), deps: ['sw_dev'], phase: 'Sprint‑1', subsystem: 'FW' },
    { id: 'sw_test', name: 'Testing', duration: d(2), deps: ['sw_ci'], phase: 'Sprint‑1', subsystem: 'System' },
    { id: 'sw_release', name: 'Release & Retro', duration: d(1), deps: ['sw_test'], phase: 'Sprint‑1', subsystem: 'System' }
  ]);
  if (which === 'hw') return ensureIds([
    { id: 'schematic', name: 'Schematic update', duration: w(2), subsystem: 'System', phase: 'SPIN' },
    { id: 'layout', name: 'PCB layout changes', duration: w(3), deps: ['schematic'], subsystem: 'System', phase: 'SPIN' },
    { id: 'fabrication', name: 'Fabrication', duration: w(2), deps: ['layout'], subsystem: 'System', phase: 'SPIN' },
    { id: 'bringup', name: 'Board bring‑up', duration: w(3), deps: ['fabrication'], subsystem: 'power/VRM', phase: 'BRINGUP' }
  ]);
  return [];
}

export function insertTemplate(which) {
  const lib = templateLib(which);
  const s = SM.get();
  const base = slug(which) + '_';
  const used = new Set(s.tasks.map(t => t.id));
  const toAdd = lib.map((t, i) => {
    let id = (t.id || uid('t'));
    if (used.has(id)) id = base + id;
    while (used.has(id)) id = base + uid('t');
    used.add(id);
    return { ...t, id };
  });
  // Remap dependencies if they reference other tasks within the template
  const mapOldToNew = new Map(lib.map((t, i) => [t.id, toAdd[i].id]));
  toAdd.forEach((t, i) => {
    if (t.deps) {
      t.deps = t.deps.map(tok => {
        const e = parseDepToken(tok);
        if (!e) return tok;
        if (mapOldToNew.has(e.pred)) e.pred = mapOldToNew.get(e.pred);
        return stringifyDep(e);
      });
    }
  });
  SM.addTasks(toAdd, { name: `Insert ${which} Template` });
  showToast(`Inserted ${toAdd.length} tasks from ${which}`);
}
