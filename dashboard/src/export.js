/* ===== Data export: CSV and JSON =====
   On the published page it uses the "downloads" capability (the viewer confirms the save);
   in the local HTML file it downloads directly through a temporary link. */
(function () {
  const BOM = '﻿';
  const csvCell = v => { if (v == null) return ''; let s = String(v); if (/^[=+\-@\t\r]/.test(s) && isNaN(Number(s))) s = "'" + s;   // neutralise spreadsheet formulas (CSV injection)
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const toCSV = (rows, cols) => { cols = cols || Object.keys(rows[0] || {}); return BOM + [cols.join(',')].concat(rows.map(r => cols.map(c => csvCell(r[c])).join(','))).join('\r\n') + '\r\n'; };
  const kv = o => Object.entries(o).map(([k, v]) => ({ metric: k, value: v }));
  const stamp = () => new Date().toISOString().slice(0, 10);

  let toastEl, toastT;
  function toast(msg) {
    if (!toastEl) { toastEl = document.createElement('div'); toastEl.className = 'xtoast'; toastEl.setAttribute('role', 'status'); document.body.appendChild(toastEl); }
    toastEl.textContent = msg; toastEl.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => toastEl.classList.remove('on'), 3200);
  }
  async function saveFile(name, text, mime) {
    let dl = null;
    try { dl = (window.claude && claude.use) ? await claude.use('downloads') : null; } catch (e) { dl = null; }
    if (dl) {
      try { await dl.save({ filename: name, data: text }); toast('File ready: ' + name); }
      catch (e) { if (e && e.code === 'declined') return; toast('Could not save ' + name); }
      return;
    }
    try {
      const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: mime })); a.download = name;
      document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      toast('Downloaded: ' + name);
    } catch (e) { toast('Your browser blocked the download'); }
  }

  const X = () => window.STV_X;
  const labelRows = () => { const x = X(), d = x.dims; return x.rows().map(r => ({ month: x.months[r[0]], region: d.region[r[1]], segment: d.segment[r[2]], tier: d.tier[r[3]], root_cause: d.category[r[4]], severity: d.severity[r[5]], sla_outcome: x.outcomes[r[6]] })); };
  const flowRows = () => { const x = X(), d = x.dims, m = {}; const add = (a, b) => { const k = a + '\u0000' + b; m[k] = (m[k] || 0) + 1; };
    x.rows().forEach(r => { add('cause:' + d.category[r[4]], 'severity:' + d.severity[r[5]]); add('severity:' + d.severity[r[5]], 'outcome:' + x.outcomes[r[6]]); });
    return Object.entries(m).map(([k, v]) => { const [a, b] = k.split('\u0000'); return { source: a, target: b, incidents: v }; }); };
  const causeRows = () => { const x = X(), d = x.dims, rs = x.rows(), q = rs.filter(r => r[6] < 2), br = q.filter(r => r[6] === 1).length;
    return d.category.map((c, i) => { const a = rs.filter(r => r[4] === i), ar = a.filter(r => r[6] < 2), ab = ar.filter(r => r[6] === 1).length;
      return { root_cause: c, incidents: a.length, pct_incidents: rs.length ? +(100 * a.length / rs.length).toFixed(2) : 0, breaches: ab, pct_breaches: br ? +(100 * ab / br).toFixed(2) : 0, breach_rate_pct: ar.length ? +(100 * ab / ar.length).toFixed(2) : '' }; }); };
  const scope = () => { const x = X(), f = x.filters(), d = x.dims; const p = [f.region != null && d.region[f.region], f.segment != null && d.segment[f.segment], f.tier != null && d.tier[f.tier]].filter(Boolean).join('_'); return p ? p.replace(/[^\w]+/g, '-').toLowerCase() : 'all'; };

  const SETS = {
    'x-incidents': { name: () => `incidents_${scope()}_${stamp()}.csv`, build: () => { const r = labelRows(); return [toCSV(r, ['month', 'region', 'segment', 'tier', 'root_cause', 'severity', 'sla_outcome']), r.length]; } },
    'x-flow': { name: () => `sankey_flow_${scope()}_${stamp()}.csv`, build: () => { const r = flowRows(); return [toCSV(r, ['source', 'target', 'incidents']), r.length]; } },
    'x-causes': { name: () => `root_causes_${scope()}_${stamp()}.csv`, build: () => { const r = causeRows(); return [toCSV(r), r.length]; } },
    kpi: { name: () => `kpis_${stamp()}.csv`, build: () => { const r = kv(D.kpi); return [toCSV(r), r.length]; } },
    monthly: { name: () => `monthly_trend_${stamp()}.csv`, build: () => [toCSV(D.monthly), D.monthly.length] },
    pareto: { name: () => `root_causes_total_${stamp()}.csv`, build: () => [toCSV(D.pareto), D.pareto.length] },
    region: { name: () => `region_summary_${stamp()}.csv`, build: () => [toCSV(D.region), D.region.length] },
    segment: { name: () => `segment_summary_${stamp()}.csv`, build: () => [toCSV(D.segment), D.segment.length] },
    forecast: { name: () => `forecast_13_weeks_${stamp()}.csv`, build: () => [toCSV(D.fc.forecast), D.fc.forecast.length] },
    history: { name: () => `weekly_history_${stamp()}.csv`, build: () => [toCSV(D.fc.history), D.fc.history.length] },
    anomalies: { name: () => `recent_anomalies_${stamp()}.csv`, build: () => { const r = D.anom.latest_flags.map(x => (typeof x === 'object' ? x : { value: x })); return [toCSV(r), r.length]; } },
    events: { name: () => `public_milestones_${stamp()}.csv`, build: () => [toCSV(D.events), D.events.length] },
    all: { name: () => `streaming_ops_data_${stamp()}.json`, json: true, build: () => { const { explorer, ...rest } = D; return [JSON.stringify(rest, null, 1), Object.keys(rest).length]; } }
  };
  async function run(key) {
    const s = SETS[key]; if (!s) return;
    let out; try { out = s.build(); } catch (e) { toast('No data to export'); return; }
    if (!out[1] && !s.json) { toast('No rows with these filters'); return; }
    await saveFile(s.name(), out[0], s.json ? 'application/json' : 'text/csv;charset=utf-8');
  }

  /* header menu */
  const btn = $('#exportBtn'), menu = $('#exportMenu');
  const ITEMS = [['Full dashboard', [['all', 'All dashboard data · JSON']]],
  ['SQL results', [['kpi', 'Overall KPIs · CSV'], ['monthly', 'Monthly trend · CSV'], ['pareto', 'Root causes (total) · CSV'], ['region', 'Region summary · CSV'], ['segment', 'Segment summary · CSV'], ['events', 'Public milestones and their effect · CSV']]],
  ['Models', [['forecast', '13-week forecast · CSV'], ['history', 'Weekly history · CSV'], ['anomalies', 'Recent anomalies · CSV']]],
  ['Explorer', [['x-incidents', 'Incidents in the current slice · CSV'], ['x-flow', 'Sankey flow · CSV'], ['x-causes', 'Causes in the current slice · CSV']]]];
  menu.innerHTML = ITEMS.map(g => `<div class="xg">${g[0]}</div>` + g[1].map(i => `<button type="button" role="menuitem" data-exp="${i[0]}">${i[1]}</button>`).join('')).join('');
  const setOpen = o => { menu.hidden = !o; btn.setAttribute('aria-expanded', o); };
  btn.addEventListener('click', e => { e.stopPropagation(); setOpen(menu.hidden); });
  document.addEventListener('click', e => { if (!menu.hidden && !e.target.closest('.xmenu-wrap')) setOpen(false); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !menu.hidden) { setOpen(false); btn.focus(); } });
  document.addEventListener('click', e => { const b = e.target.closest('[data-exp]'); if (b) { setOpen(false); run(b.dataset.exp); } });
})();
