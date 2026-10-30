/* ===== dashboard sections (everything is fed from DATA) ===== */
const D = DATA, K = D.kpi, C = D.cls, A = D.anom, F = D.fc;
const root = document.documentElement;
const curTheme = () => root.dataset.theme || 'dark';
const themeLabel = () => { $('#themeBtn').textContent = curTheme() === 'dark' ? 'Light theme' : 'Dark theme'; };
root.dataset.theme = 'dark';
try { const t = localStorage.getItem('stv-theme3'); if (t) root.dataset.theme = t; } catch (e) { }
themeLabel();
$('#themeBtn').addEventListener('click', () => {
  const n = curTheme() === 'dark' ? 'light' : 'dark'; root.dataset.theme = n;
  try { localStorage.setItem('stv-theme3', n); } catch (e) { } themeLabel();
});
const M = D.monthly, mi = ds => { const [y, m, d] = ds.split('-').map(Number); return (y - 2023) * 12 + (m - 6) + (d - 1) / 30; };
const T0 = Date.parse('2023-06-05'), wx = ds => Math.round((Date.parse(ds) - T0) / (7 * 864e5));
const par = Object.fromEntries(D.pareto.map(p => [p.category, p]));
const MODEL_ES = { 'Logistic Regression': 'Logistic regression', 'Random Forest': 'Random Forest', 'Gradient Boosting': 'Gradient Boosting' };
const bestAuc = C.models[C.best_model].auc;

/* ----- hero and KPIs ----- */
$('#chips').innerHTML = [
  `<span class="chip warn">Simulated operational data</span>`,
  `<span class="chip">${fdate(K.data_from)} → ${fdate(K.data_to)}</span>`,
  `<span class="chip">${nf(K.clients)} clients · ${nf(K.feeds)} feeds</span>`,
  `<span class="chip">${nf(K.feed_days)} feed-days</span>`].join('');
donut($('#heroRing'), { sw: 13, aria: 'Share of resolved incidents outside the SLA', segs: [{ label: 'Outside SLA', value: K.sla_breaches, grad: true }, { label: 'Within SLA', value: K.incidents_resolved - K.sla_breaches, color: 'var(--surface2)' }], center: { big: pct(K.sla_breach_pct), cap: 'outside SLA' } });
$('#ringNote').textContent = `${nf(K.sla_breaches)} of ${nf(K.incidents_resolved)} resolved incidents took longer than the SLA for their severity and tier.`;
$('#kpis').innerHTML = [
  ['Incidents', cnt(K.incidents_total), '', `${nf(K.incidents_open)} still open at cutoff`, 'ks0'],
  ['SLA breach rate', cnt(K.sla_breach_pct, 1), '%', `${nf(K.sla_breaches)} cases`, 'ks1'],
  ['Median resolution', cnt(K.median_resolution_h, 1), 'h', `P90: ${nf(K.p90_resolution_h, 0)} h`, ''],
  ['Faulty deliveries', cnt(K.bad_delivery_pct, 2), '%', 'feed-days DEGRADED or FAILED', 'ks2'],
  ['Escalated to dev/ops', cnt(K.escalation_pct, 1), '%', `First response: ${nf(K.mean_first_response_min, 0)} min`, '']
].map(k => `<div class="kpi"><div class="k">${k[0]}</div><div class="v">${k[1]}${k[2] ? `<small>${k[2]}</small>` : ''}</div>${k[4] ? `<div class="s" id="${k[4]}"></div>` : ''}<div class="d">${k[3]}</div></div>`).join('');
spark($('#ks0'), M.map(r => r.incidents), 'var(--brand)');
spark($('#ks1'), M.map(r => r.breach_pct || 0), 'var(--brand2)');
spark($('#ks2'), M.map(r => r.bad_delivery_pct), 'var(--s1)');

/* ----- context ----- */
$('#problem').innerHTML = `<p style="color:var(--ink2)">When a metadata feed fails, the client sees empty guides, broken images or duplicated catalogs. Every incident has a resolution SLA based on its severity and the client's tier. The team needs to know:</p>
<ol class="plain" style="margin-top:10px"><li><a href="#diagnostico">Where do breaches concentrate, and why?</a></li><li><a href="#riesgo">Can they be anticipated when the ticket opens?</a></li><li><a href="#pronostico">How much volume is coming?</a></li><li><a href="#anomalias">Are there degradations nobody is seeing?</a></li></ol>`;
const facts = [
  ['Website', '5 segments (TV Operators, Streaming, Broadcasters, Research, Hospitality) and more than 300 platforms served.'],
  ['Website', 'Products: video metadata, sports, keywords and discovery, streaming, FAST with unified IDs, and EPG correction.'],
  ['2019', 'Founded in Copenhagen by two former Gracenote executives.'],
  ['Aug 2022', 'Acquires GVIDI, with about 25 EPG clients.'],
  ['Jun 2023', 'Opens operations in Latin America with native Spanish and Portuguese editors.'],
  ['Jul 2024', 'Acquires InFlow Media (35 Nordic experts) and signs Allente (~1 million subscribers).'],
  ['Jun 2026', 'Joins Deutsche TV-Plattform.']];
$('#pubfacts').innerHTML = `<ul class="src">${facts.map(f => `<li><span class="dt">${f[0]}</span><span>${f[1]}</span></li>`).join('')}</ul>`;
const Q = D.dq, logDrop = Q['deliveries.log_lines_total'] - Q['deliveries.rows_loaded'];
$('#pipeline').innerHTML = [
  ['Sources', 'extract', [`<b>${nf(Q['deliveries.log_lines_total'])}</b> log lines`, `<b>${nf(Q['incidents.raw_rows'])}</b> JSON tickets`, 'Catalog CSV · milestone XML']],
  ['Python ETL', 'transform', [`<b>−${nf(Q['incidents.duplicates_removed'])}</b> duplicate tickets`, `<b>−${nf(logDrop)}</b> invalid or repeated log lines`, `<b>4</b> date formats unified`, `<b>${nf(Q['incidents.negative_duration_flagged'])}</b> impossible closures flagged`]],
  ['SQL warehouse', 'load', [`<b>8</b> tables · <b>2</b> views`, `<b>${nf(Q['deliveries.rows_loaded'])}</b> feed-days`, `<b>${nf(Q['incidents.rows_loaded'])}</b> incidents`, '<b>18</b> queries with CTEs and window functions']],
  ['Models', 'analyze', [`NLP triage: <b>${nf(D.nlp.n_unlabeled)}</b> causes filled in`, 'SLA risk and ETA', 'Weekly forecast', 'Anomalies']],
  ['Dashboard', 'serve', ['This document', 'Data in <b>data.json</b>', 'Code in <b>src/</b> and <b>sql/</b>']]
].map(n => `<div class="node"><div class="nt"><i></i>${n[0]}</div><div class="nl">${n[1]}</div><ul>${n[2].map(x => `<li>${x}</li>`).join('')}</ul></div>`).join('');

/* ----- diagnosis: trend ----- */
const evs = D.events.filter(e => e.event_date >= '2023-06-01');
const mtip = i => { const r = M[Math.round(i)]; return `<b>${fmon(r.month)}</b>` + row('var(--brand)', 'Incidents / 1,000 feed-days', nf(r.incidents_per_1k_feeddays, 1)) + row('', 'Incidents', nf(r.incidents)) + row('var(--brand2)', 'Outside SLA', r.breach_pct == null ? '—' : pct(r.breach_pct)) + row('', 'Active feeds', nf(r.active_feeds)); };
const xt = M.map((r, i) => i % 6 === 0 ? { v: i, label: fmon(r.month) } : null).filter(Boolean);
const vl = evs.map(e => ({ x: mi(e.event_date), color: e.kind === 'corporate' ? 'var(--muted)' : 'var(--brand2)', fill: e.kind === 'corporate' ? 'var(--surface)' : 'var(--brand2)', href: e.url, name: e.name, tip: `<b>${esc(e.name)}</b><div class="m">${fdate(e.event_date)} · ${esc(e.region_scope === 'ALL' ? 'control event' : e.region_scope.replace(/\|/g, ' · '))}</div><div class="m">Click: open the source ↗</div>` }));
$('#trendT').textContent = `${nf(K.incidents_total)} incidents in ${M.length} months: the per-feed rate holds steady as the base grows`;
lineChart($('#chTrend1'), { series: [{ pts: M.map((r, i) => [i, r.incidents_per_1k_feeddays]), color: 'var(--brand)', area: true, end: true }], h: 200, xTicks: xt, yMin: 0, yFmt: v => nf(v), tip: mtip, vlines: vl, aria: 'Incidents per 1,000 feed-days by month' });
lineChart($('#chTrend2'), { series: [{ pts: M.map((r, i) => [i, r.breach_pct == null ? 0 : r.breach_pct]), color: 'var(--brand2)', end: true }], h: 150, xTicks: xt, yMin: 0, yFmt: v => nf(v) + '%', tip: mtip, aria: 'Percentage outside SLA by month' });
$('#evLegend').innerHTML = evs.map(e => `<a href="${esc(e.url)}" target="_blank" rel="noopener" style="color:var(--ink2);text-decoration:none"><i class="ring-i" style="border-color:${e.kind === 'corporate' ? 'var(--muted)' : 'var(--brand2)'};width:10px;height:10px;display:inline-block;margin-right:6px;border-radius:50%;border:2px solid"></i>${fdate(e.event_date)} · ${esc(e.name)}</a>`).join('');

/* ----- cause Pareto ----- */
const topGap = [...D.pareto].filter(p => p.category !== 'unclassified').sort((a, b) => (b.breach_share_pct - b.share_pct) - (a.breach_share_pct - a.share_pct))[0];
$('#paretoT').textContent = `${CAT[topGap.category]}: ${pct(topGap.share_pct, 0)} of incidents but ${pct(topGap.breach_share_pct, 0)} of breaches`;
const pmax = Math.max(...D.pareto.flatMap(p => [p.share_pct, p.breach_share_pct]));
barRows($('#pareto'), D.pareto.map(p => ({
  label: CAT[p.category], hl: p.category === topGap.category,
  vals: [{ v: p.share_pct, color: 'var(--s1)', fmt: pct(p.share_pct) }, { v: p.breach_share_pct, color: 'var(--s2)', fmt: pct(p.breach_share_pct) }],
  right: `${pct(p.breach_pct, 0)} breach`,
  tip: `<b>${CAT[p.category]}</b>` + row('', 'Incidents', nf(p.n)) + row('', 'Breach SLA', pct(p.breach_pct)) + row('', 'Mean resolution', nf(p.mean_h, 0) + ' h') + row('', 'Escalated', pct(p.esc_pct, 0))
})), { max: pmax });

/* ----- heatmap ----- */
const DAYS = [1, 2, 3, 4, 5, 6, 0], DN = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'], DF = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const BL = ['00–04', '04–08', '08–12', '12–16', '16–20', '20–24'];
const hm = {}; D.heat.forEach(r => { hm[r.dow + '-' + r.block] = r; });
const hv = D.heat.map(r => r.breach_pct), hmin = Math.min(...hv), hmax = Math.max(...hv);
let hh = '<div></div>' + BL.map(b => `<div class="hh">${b}</div>`).join('');
DAYS.forEach((d, ri) => {
  hh += `<div class="hh">${DN[ri]}</div>`;
  for (let b = 0; b < 6; b++) {
    const r = hm[d + '-' + b];
    if (!r) { hh += '<div class="hc"></div>'; continue; }
    const t = (r.breach_pct - hmin) / ((hmax - hmin) || 1);
    hh += `<div class="hc${t > .55 ? ' hi' : ''}" style="background:color-mix(in oklab,var(--heat-hi) ${(t * 100).toFixed(0)}%,var(--heat-lo))" data-tip="${esc(`<b>${DF[ri]} ${BL[b]} UTC</b>` + row('', 'Incidents', nf(r.incidents)) + row('', 'Outside SLA', pct(r.breach_pct)))}">${nf(r.breach_pct, 0)}</div>`;
  }
});
$('#heat').innerHTML = hh;
const worst = D.heat.filter(r => r.incidents >= 80).sort((a, b) => b.breach_pct - a.breach_pct)[0];
$('#heatT').textContent = `Incidents opened on ${DF[DAYS.indexOf(worst.dow)]}s between ${BL[worst.block]} UTC breach the most: ${pct(worst.breach_pct, 0)}`;
$('#hLo').textContent = pct(hmin, 0); $('#hHi').textContent = pct(hmax, 0);

/* ----- regions, clients, age, detection ----- */
const rg = D.region, rmax = Math.max(...rg.map(r => r.incidents_per_1k_feeddays));
$('#regionT').textContent = `${rg[0].region} and ${rg[1].region} lead the incident rate`;
barRows($('#region'), rg.map((r, i) => ({
  label: r.region, sub: `${r.clients} clients · ${r.feeds} feeds`, hl: i < 2,
  vals: [{ v: r.incidents_per_1k_feeddays, color: i < 2 ? 'var(--brand)' : 'var(--s1)', fmt: nf(r.incidents_per_1k_feeddays, 1) }],
  right: `${pct(r.breach_pct, 0)} SLA`,
  tip: `<b>${r.region}</b>` + row('', 'Incidents', nf(r.incidents)) + row('', 'Faulty deliveries', pct(r.bad_delivery_pct, 2)) + row('', 'Mean resolution', nf(r.mean_resolution_h, 0) + ' h')
})), { max: rmax });
const cp = D.clientPareto, c20 = cp[1].cum_share_pct;
$('#clientT').textContent = `20% of clients account for ${pct(c20, 0)} of breaches`;
const cpts = [[0, 0]].concat(cp.map(r => [r.decile * 10, r.cum_share_pct]));
lineChart($('#chClient'), {
  series: [{ pts: cpts, color: 'var(--brand)', area: true }, { pts: [[0, 0], [100, 100]], color: 'var(--muted)', dash: '4 4', w: 1.5, hover: false }],
  h: 230, xDomain: [0, 100], yMin: 0, yMax: 100, yTicks: [0, 25, 50, 75, 100], yFmt: v => v + '%', xTicks: [0, 20, 40, 60, 80, 100].map(v => ({ v, label: v + '%' })),
  xTitle: 'clients, from most to least problematic', dots: [{ x: 20, y: c20, color: 'var(--brand)', r: 5 }],
  labels: [{ x: 20, y: c20, text: `20% → ${pct(c20, 0)}`, dx: 10, dy: 16 }],
  tip: x => `<b>${x}% of clients</b>` + row('var(--brand)', 'Accumulate', pct(cpts.find(p => p[0] === x)[1])), aria: 'Cumulative concentration of breaches by client'
});
const fa = D.feedAge;
$('#ageT').textContent = `Feeds under 30 days old fail ${nf(fa[0].bad_delivery_pct / fa[fa.length - 1].bad_delivery_pct, 1)}× more than feeds over a year old`;
barRows($('#age'), fa.map((r, i) => ({ label: r.feed_age, sub: `${nf(r.feed_days)} feed-days`, vals: [{ v: r.bad_delivery_pct, color: i === 0 ? 'var(--brand)' : 'var(--s1)', fmt: pct(r.bad_delivery_pct, 2) }] })), { big: true });
const dl = Object.fromEntries(D.delay.map(r => [r.detection, r])), dt = Object.fromEntries(D.detection.map(r => [r.detection, r]));
const missN = D.missed.reduce((a, r) => a + r.no_incident, 0), badN = D.missed.reduce((a, r) => a + r.bad_deliveries, 0);
$('#detT').textContent = `What the client detects arrives ${nf(dl.client.mean_detection_delay_h / dl.auto.mean_detection_delay_h, 0)}× later than what monitoring detects`;
$('#det').innerHTML = [
  ['Automatic detection', `${nf(dl.auto.mean_detection_delay_h * 60, 0)}<small> min</small>`, `${nf(dt.auto.incidents)} incidents · ${pct(dt.auto.breach_pct)} outside SLA`],
  ['Reported by the client', `${nf(dl.client.mean_detection_delay_h, 1)}<small> h</small>`, `${nf(dt.client.incidents)} incidents · ${pct(dt.client.breach_pct)} outside SLA`],
  ['Mean resolution', `${nf(dt.auto.mean_resolution_h, 0)} → ${nf(dt.client.mean_resolution_h, 0)}<small> h</small>`, 'automatic → reported by the client'],
  ['Bad deliveries with no ticket', cnt(missN), `${pct(100 * missN / badN)} of ${nf(badN)} DEGRADED or FAILED`]
].map(s => `<div class="stat"><div class="k">${s[0]}</div><div class="v">${s[1]}</div><div class="d">${s[2]}</div></div>`).join('');

/* ----- milestone impact ----- */
const sig = D.events.filter(e => e.status === 'sig').length;
$('#evT').textContent = sig === 0 ? 'No public milestone leaves a statistically detectable effect' : `${sig} milestones leave a statistically detectable effect`;
$('#evTable').innerHTML = `<thead><tr><th>Milestone</th><th>Date</th><th>Scope</th><th class="n">Before</th><th class="n">After</th><th class="n">Ratio</th><th class="n">p</th><th>Reading</th></tr></thead><tbody>` +
  D.events.map(e => { const ok = e.ratio != null; return `<tr><td><a href="${esc(e.url)}" target="_blank" rel="noopener">${esc(e.name)}</a></td><td class="mono">${fdate(e.event_date)}</td><td>${e.region_scope === 'ALL' ? 'All (control)' : esc(e.region_scope.replace(/\|/g, ' · '))}</td>
  <td class="n">${ok ? nf(e.rate_before, 1) : '—'}</td><td class="n">${ok ? nf(e.rate_after, 1) : '—'}</td><td class="n">${ok ? nf(e.ratio, 2) + '×' : '—'}</td><td class="n">${ok && e.p != null ? nf(e.p, 2) : '—'}</td>
  <td>${!ok ? '<span class="pill mute">No baseline</span>' : e.status === 'sig' ? '<span class="pill warn">▲ Detectable effect</span>' : '<span class="pill mute">No detectable effect</span>'}</td></tr>`; }).join('') + '</tbody>';
$('#evTable').closest('.card').insertAdjacentHTML('beforeend', '<p class="foot">With few feeds before each event (for example, 8 Nordic feeds before InFlow) the test has low power: failing to detect an effect does not prove there is none. Milestones from 2021 to 2023 have no prior data in this window.</p>');

/* ===== risk model ===== */
$('#cmpT').textContent = `${MODEL_ES[C.best_model]}: AUC ${nf(bestAuc, 2)} vs ${nf(C.baseline.auc, 2)} for the historical rule`;
barRows($('#modelCmp'), [{ label: 'Historical rule', sub: 'rate by severity × tier × cause', vals: [{ v: C.baseline.auc, color: 'var(--muted)', fmt: nf(C.baseline.auc, 3) }] }].concat(
  Object.entries(C.models).map(([k, m]) => ({ label: MODEL_ES[k], sub: k === C.best_model ? 'chosen on validation' : '', hl: k === C.best_model, vals: [{ v: m.auc, color: k === C.best_model ? 'var(--brand)' : 'var(--s1)', fmt: nf(m.auc, 3) }] }))), { min: .5, max: .8 });
const cf = C.confusion;
$('#confT').textContent = `At the threshold chosen on validation (${nf(cf.threshold, 2)}):`;
$('#conf').innerHTML = `<div class="tw"><table><thead><tr><th></th><th class="n">Alert</th><th class="n">No alert</th></tr></thead><tbody><tr><td>Breached</td><td class="n">${nf(cf.tp)}</td><td class="n">${nf(cf.fn)}</td></tr><tr><td>Met SLA</td><td class="n">${nf(cf.fp)}</td><td class="n">${nf(cf.tn)}</td></tr></tbody></table></div><p class="sub">Catches ${pct(100 * cf.tp / (cf.tp + cf.fn), 0)} of breaches, with ${pct(100 * cf.tp / (cf.tp + cf.fp), 0)} of alerts being correct.</p>`;
const rocMap = new Map(C.roc.map(p => [p[0], p[1]]));
lineChart($('#chRoc'), {
  series: [{ pts: C.roc, color: 'var(--brand)', area: true }, { pts: [[0, 0], [1, 1]], color: 'var(--muted)', dash: '4 4', w: 1.5, hover: false }],
  h: 230, xDomain: [0, 1], yMin: 0, yMax: 1, yTicks: [0, .25, .5, .75, 1], yFmt: v => nf(v, 2), xTicks: [0, .25, .5, .75, 1].map(v => ({ v, label: nf(v, 2) })), xTitle: 'false positives',
  labels: [{ x: .55, y: .35, text: `AUC ${nf(bestAuc, 2)}`, anchor: 'start' }], tip: x => `<b>False-positive rate ${nf(x, 2)}</b>` + row('var(--brand)', 'Detects', pct(100 * rocMap.get(x), 0)), aria: 'ROC curve'
});
const g20 = C.top20_capture;
$('#gainT').textContent = `Reviewing the highest-risk 20% first captures ${pct(100 * g20, 0)} of breaches`;
const gpts = [[0, 0]].concat(C.gain.map(p => [p[0], 100 * p[1]]));
lineChart($('#chGain'), {
  series: [{ pts: gpts, color: 'var(--brand)', area: true }, { pts: [[0, 0], [100, 100]], color: 'var(--muted)', dash: '4 4', w: 1.5, hover: false }],
  h: 230, xDomain: [0, 100], yMin: 0, yMax: 100, yTicks: [0, 25, 50, 75, 100], yFmt: v => v + '%', xTicks: [0, 20, 40, 60, 80, 100].map(v => ({ v, label: v + '%' })), xTitle: 'incidents reviewed',
  dots: [{ x: 20, y: 100 * g20, color: 'var(--brand)', r: 5 }], labels: [{ x: 20, y: 100 * g20, text: `20% → ${pct(100 * g20, 0)}`, dx: 10, dy: 16 }],
  tip: x => `<b>Top ${x}% by risk</b>` + row('var(--brand)', 'Capture', pct(gpts.find(p => p[0] === x)[1], 0)), aria: 'Cumulative gain curve'
});
const FN = { category: 'Root cause', tier: 'Client tier', is_night: 'Opened at night', is_weekend: 'Weekend', load_24h: 'Load in the last 24 h', severity: 'Severity', detection: 'Who detected it', log_feed_age: 'Feed age', segment: 'Segment', region: 'Region', feed_type: 'Feed type', last_status: 'Last delivery status', client_prev7d: 'Client incidents (7 d)', feed_prev30d: 'Feed incidents (30 d)', completeness: 'Completeness', lat_ratio: 'Latency vs normal', checksum_bad: 'Invalid checksum', open_hour: 'Opening hour', days_since_event: 'Days since a milestone' };
const imp = C.importance.filter(i => i.auc_drop > 0).slice(0, 8);
barRows($('#imp'), imp.map((i, k) => ({ label: FN[i.feature] || i.feature, vals: [{ v: i.auc_drop, color: k === 0 ? 'var(--brand)' : 'var(--s1)', fmt: '−' + nf(i.auc_drop, 3) }], tip: `<b>${FN[i.feature] || i.feature}</b>` + row('', 'AUC drop', nf(i.auc_drop, 3) + ' ± ' + nf(i.std, 3)) })));
const dc = C.deciles;
lineChart($('#chCal'), {
  series: [{ pts: dc.map(d => [d.decile, 100 * d.pred]), color: 'var(--s1)', w: 2.2 }, { pts: dc.map(d => [d.decile, 100 * d.obs]), color: 'var(--s2)', w: 2.2 }],
  h: 220, xDomain: [1, 10], yMin: 0, yFmt: v => v + '%', xTicks: dc.map(d => ({ v: d.decile, label: d.decile })), xTitle: 'risk group (1 = highest)',
  tip: x => { const d = dc[x - 1]; return `<b>Group ${x}</b>` + row('var(--s1)', 'Predicted', pct(100 * d.pred, 0)) + row('var(--s2)', 'Observed', pct(100 * d.obs, 0)) + row('', 'Incidents', nf(d.n)); }, aria: 'Calibration by decile'
});


/* ----- robustness ----- */
(function () {
  const R = C.robustness, el = $('#rob'); if (!R || !el) return;
  const p1 = v => nf(100 * v, 1) + '%', a3 = v => nf(v, 3);
  const roll = R.rolling.map(r => `<tr><td>${r.window}</td><td style="text-align:right">${nf(r.n)}</td><td style="text-align:right">${a3(r.baseline)}</td><td style="text-align:right"><b>${a3(r.auc)}</b></td><td style="text-align:right">+${a3(r.auc - r.baseline)}</td></tr>`).join('');
  el.innerHTML = `<div class="two">
    <div class="vb"><b>1 · Is the lift real?</b><p class="sub">Bootstrap (1,000 resamples) of the test set. Model AUC ${a3(C.models[C.best_model].auc)} [${a3(R.auc_ci[0])}–${a3(R.auc_ci[1])}] vs baseline [${a3(R.baseline_auc_ci[0])}–${a3(R.baseline_auc_ci[1])}]. Difference +${a3(R.diff_mean)} with a 95% interval of ${a3(R.diff_ci[0])} to ${a3(R.diff_ci[1])}, which excludes zero. The model beat the baseline in ${p1(R.p_model_better)} of resamples.</p></div>
    <div class="vb"><b>2 · Calibration</b><p class="sub">When the model says 40%, about 40% breach: average gap ${p1(R.ece)} (ECE). Brier score ${a3(R.brier)} vs ${a3(R.brier_naive)} for always predicting the base rate.</p></div></div>
  <table class="tbl" style="margin-top:12px"><caption class="sub" style="text-align:left;caption-side:top"><b>3 · Does it hold over time?</b> Retrained on the past each time and tested on the next 120 days.</caption><thead><tr><th>Window</th><th style="text-align:right">Incidents</th><th style="text-align:right">Baseline AUC</th><th style="text-align:right">Model AUC</th><th style="text-align:right">Gain</th></tr></thead><tbody>${roll}</tbody></table>
  <div class="two" style="margin-top:12px"><div class="vb"><b>4 · Does acting on it pay off?</b><p class="sub">Threshold ${nf(R.cost.threshold, 2)} chosen on validation data, with ${R.cost.ratio}. Test cost: model ${nf(R.cost.model)} vs ${nf(R.cost.never_alert)} if never alerting and ${nf(R.cost.always_alert)} if always alerting (${nf(100 * (1 - R.cost.model / Math.min(R.cost.never_alert, R.cost.always_alert)), 0)}% lower than the best of those).</p></div>
    <div class="vb"><b>What did not help</b><p class="sub">${R.tried_without_gain.map(esc).join('; ')}. ${esc(R.note)}</p></div></div>`;
})();

/* ----- simulator ----- */
const S = C.simulator, base = K.sla_breach_pct / 100;
const opt = (arr, sel) => arr.map(a => `<option value="${esc(a[0])}"${a[0] === sel ? ' selected' : ''}>${esc(a[1])}</option>`).join('');
const catOpts = Object.keys(S.cat.category).map(k => [k, CAT[k] || k]).sort((a, b) => a[1].localeCompare(b[1], 'en'));
$('#simFields').innerHTML = `
 <div class="field"><label for="sTier">Client tier</label><select id="sTier">${opt(Object.keys(S.cat.tier).map(k => [k, k]), 'Silver')}</select></div>
 <div class="field"><label for="sSev">Severity</label><select id="sSev">${opt(Object.keys(S.cat.severity).map(k => [k, k]), 'P2')}</select></div>
 <div class="field"><label for="sCat">Root cause</label><select id="sCat">${opt(catOpts, 'schema_drift')}</select></div>
 <div class="field"><label for="sDet">Detection</label><select id="sDet">${opt([['auto', 'Automatic monitoring'], ['client', 'Reported by the client']], 'auto')}</select></div>
 <div class="field"><label for="sAge">Feed age</label><select id="sAge">${opt(Object.entries(S.feed_age_choices).map(([k, v]) => [String(v), k]), '90')}</select></div>
 <div class="field"><label for="sLoad">Incidents in the last 24 h: <span class="mono" id="sLoadV"></span></label><input id="sLoad" type="range" min="1" max="12" step="1" value="4"></div>
 <div class="field chk"><input id="sWk" type="checkbox"><label for="sWk">Opened on a weekend</label></div>
 <div class="field chk"><input id="sNt" type="checkbox"><label for="sNt">Opened at night (22–06 UTC)</label></div>`;
ring($('#simRing'), 0, { big: '', cap: 'breach prob.', anim: false });
function simCalc() {
  const g = id => $(id).value, nz = (k, x) => (x - S.num[k].mean) / S.num[k].scale * S.num[k].coef;
  let z = S.intercept + S.cat.tier[g('#sTier')] + S.cat.severity[g('#sSev')] + S.cat.category[g('#sCat')] + S.cat.detection[g('#sDet')]
    + nz('is_weekend', $('#sWk').checked ? 1 : 0) + nz('is_night', $('#sNt').checked ? 1 : 0) + nz('log_feed_age', Math.log1p(+g('#sAge'))) + nz('load_24h', +g('#sLoad'));
  const p = 1 / (1 + Math.exp(-z)), lv = p < .2 ? ['good', 'Low risk'] : p < .4 ? ['warn', 'Medium risk'] : ['bad', 'High risk'];
  $('#sLoadV').textContent = g('#sLoad');
  setRing($('#simRing'), p * 100, pct(p * 100, 0), 'breach prob.');
  $('#simVerdict').innerHTML = `<span class="pill ${lv[0]}">${lv[0] === 'good' ? '●' : lv[0] === 'warn' ? '▲' : '■'} ${lv[1]}</span><div class="sub" style="margin-top:6px">${nf(p / base, 1)}× the average rate of ${pct(base * 100)}</div>`;
}
$$('#simFields select, #simFields input').forEach(e => e.addEventListener('input', simCalc));
const presets = [['Hard case', { sTier: 'Bronze', sSev: 'P2', sCat: 'schema_drift', sDet: 'client', sAge: '20', sLoad: 8, sWk: true, sNt: true }], ['Easy case', { sTier: 'Gold', sSev: 'P3', sCat: 'delivery_endpoint', sDet: 'auto', sAge: '365', sLoad: 3, sWk: false, sNt: false }]];
$('#simPresets').innerHTML = presets.map((p, i) => `<button class="iconbtn" type="button" data-p="${i}">${p[0]}</button>`).join('');
$$('#simPresets button').forEach(b => b.addEventListener('click', () => { const v = presets[+b.dataset.p][1]; Object.entries(v).forEach(([k, x]) => { const el = $('#' + k); if (el.type === 'checkbox') el.checked = x; else el.value = x; }); simCalc(); }));
simCalc();

/* ----- scenario ----- */
let wTop = 20;
const grid = C.whatif.grid;
$('#wiTop').innerHTML = [10, 20, 30].map(v => `<button type="button" data-v="${v}" aria-pressed="${v === wTop}">${v}%</button>`).join('');
function wiUpdate() {
  const red = +$('#wiRed').value, g = grid.find(x => x.topk === wTop && x.reduction === red);
  $('#wiRedV').textContent = '−' + red + '%';
  $('#wiT').textContent = `Proactively handling the highest-risk ${wTop}% would avoid ${nf(g.avoided)} breaches`;
  $('#wiOut').innerHTML = `<div class="stat"><div class="k">Avoided</div><div class="v">${nf(g.avoided)}</div><div class="d">of ${nf(C.whatif.test_breaches)} (${pct(g.avoided_pct)})</div></div><div class="stat"><div class="k">Incidents to review</div><div class="v">${nf(C.whatif.test_incidents * wTop / 100, 0)}</div><div class="d">of ${nf(C.whatif.test_incidents)} in the test period</div></div>`;
}
$$('#wiTop button').forEach(b => b.addEventListener('click', () => { wTop = +b.dataset.v; $$('#wiTop button').forEach(x => x.setAttribute('aria-pressed', x === b)); wiUpdate(); }));
$('#wiRed').addEventListener('input', wiUpdate); wiUpdate();

/* ----- ETA and NLP ----- */
const E = C.eta;
$('#eta').innerHTML = [['Mean error', `${nf(E.mae_h, 1)}<small> h</small>`, `vs ${nf(E.mae_h_baseline, 1)} h with the historical median`], ['R² (log of hours)', nf(E.r2_log, 2), `vs ${nf(E.r2_log_baseline, 2)} for the historical median`]].map(s => `<div class="stat"><div class="k">${s[0]}</div><div class="v">${s[1]}</div><div class="d">${s[2]}</div></div>`).join('');
$('#eta').insertAdjacentHTML('afterend', '<p class="foot">Modest improvement: much of the variation in resolution hours does not depend on the variables available when the ticket opens.</p>');
const N = D.nlp;
$('#nlp').innerHTML = [['Accuracy (hold-out)', pct(100 * N.holdout_accuracy, 1), `Macro F1 ${nf(N.holdout_macro_f1, 2)}`], ['Causes filled in', nf(N.n_unlabeled), `${nf(N.imputed_confident)} with confidence ≥ ${nf(N.conf_threshold, 2)}; ${nf(N.imputed_unclassified)} left unclassified`], ['Accuracy when confident', pct(100 * N.acc_vs_truth_confident, 1), 'against simulation ground truth']].map(s => `<div class="stat"><div class="k">${s[0]}</div><div class="v">${s[1]}</div><div class="d">${s[2]}</div></div>`).join('');
$('#nlp').insertAdjacentHTML('afterend', '<p class="foot">Ticket text is synthetic and more regular than real text: these figures are a ceiling, not an expectation.</p>');

/* ===== forecast ===== */
const hist = F.history, fut = F.forecast, lastX = wx(hist[hist.length - 1].week), fx0 = wx(fut[0].week), fx1 = wx(fut[fut.length - 1].week);
const hp = hist.map(h => [wx(h.week), h.incidents]), fp = [[lastX, hist[hist.length - 1].incidents]].concat(fut.map(f => [wx(f.week), f.forecast]));
const bp = F.h1_backtest.map(b => [wx(b.week), b.pred]);
const hm_ = new Map(hp), fm_ = new Map(fut.map(f => [wx(f.week), f])), bm_ = new Map(bp);
const fxt = []; for (let y = 2023; y <= 2026; y++) [1, 7].forEach(m => { const ds = `${y}-${String(m).padStart(2, '0')}-01`; if (ds > '2023-06-05' && ds < '2027-01-01') fxt.push({ v: wx(ds), label: fmon(ds.slice(0, 7)) }); });
$('#fcH').textContent = `About ${nf(F.expected_incidents_13w, 0)} incidents are expected in the next 13 weeks`;
$('#fcT').textContent = 'Incidents per week: history, backtest and forecast through year-end';
lineChart($('#chFc'), {
  series: [{ pts: hp, color: 'var(--brand)', area: true, w: 2 }, { pts: bp, color: 'var(--muted)', dash: '2 3', w: 1.6, hover: false, op: .9 }, { pts: fp, color: 'var(--brand2)', dash: '6 4', w: 2.2 }],
  band: { pts: fut.map(f => [wx(f.week), f.lo, f.hi]), color: 'var(--brand2)' }, h: 280, xDomain: [0, fx1], xTicks: fxt, yMin: 0, yFmt: v => nf(v),
  vlines: [{ x: fx0 - .5, color: 'var(--brand2)', dash: '2 4', label: 'forecast' }],
  tip: x => { const h = hm_.get(x), f = fm_.get(x), b = bm_.get(x), d = new Date(T0 + x * 7 * 864e5).toISOString().slice(0, 10); return `<b>Week of ${fdate(d)}</b>` + (h != null ? row('var(--brand)', 'Incidents', nf(h)) : '') + (b != null ? row('var(--muted)', '1-wk backtest', nf(b, 0)) : '') + (f ? row('var(--brand2)', 'Forecast', nf(f.forecast, 0)) + row('', '80% range', `${nf(f.lo, 0)}–${nf(f.hi, 0)}`) : ''); }, aria: 'Weekly incidents and forecast'
});
$('#fcStats').innerHTML = [['Expected incidents', cnt(F.expected_incidents_13w), `vs ${nf(F.last_13w_actual)} in the previous 13 weeks`], ['Expected breaches', '~' + cnt(F.expected_breaches_13w), `at a recent rate of ${pct(100 * F.recent_breach_rate)}`]].map(s => `<div class="stat"><div class="k">${s[0]}</div><div class="v">${s[1]}</div><div class="d">${s[2]}</div></div>`).join('');
const bt = F.backtest, btk = Object.keys(bt);
barRows($('#fcBt'), btk.map(k => ({ label: k, hl: k === F.best_model, vals: [{ v: bt[k].mae, color: k === F.best_model ? 'var(--brand)' : 'var(--s1)', fmt: nf(bt[k].mae, 2) }] })), { max: Math.max(...btk.map(k => bt[k].mae)) });
$('#fcBt').insertAdjacentHTML('afterend', `<p class="foot">${F.best_model} improves ${pct(100 * (1 - bt[F.best_model].mae / bt['4-wk mean'].mae), 0)} over the 4-week mean: the series is nearly stable and the model does not invent a trend.</p>`);

/* ===== anomalies ===== */
const hyb = A.rows[A.rows.length - 1];
$('#anH').textContent = `${nf(A.silent_total)} deliveries with "OK" status were incomplete; the hybrid detector finds ${pct(100 * hyb.recall, 0)}`;
function scatter(el, pts) {
  const W = Math.max(el.clientWidth || 300, 240), H = 260, m = { l: 44, r: 12, t: 12, b: 30 };
  const xmin = .6, xmax = 1.2, ys = pts.map(p => p[1]), ymin = Math.floor(Math.min(...ys)), ymax = Math.ceil(Math.max(...ys));
  const sx = x => m.l + (Math.min(Math.max(x, xmin), xmax) - xmin) / (xmax - xmin) * (W - m.l - m.r), sy = y => m.t + (H - m.t - m.b) - (y - ymin) / ((ymax - ymin) || 1) * (H - m.t - m.b);
  let s = `<svg width="${W}" height="${H}" role="img" aria-label="Adjusted completeness vs latency">`;
  niceTicks(ymin, ymax, 4).forEach(v => { s += `<line x1="${m.l}" x2="${W - m.r}" y1="${sy(v)}" y2="${sy(v)}" style="stroke:var(--grid)"/><text x="${m.l - 8}" y="${sy(v) + 4}" text-anchor="end">${nf(v, 1)}</text>`; });
  [.6, .8, 1, 1.2].forEach(v => { s += `<text x="${sx(v)}" y="${H - 8}" text-anchor="middle">${nf(v * 100, 0)}%</text>`; });
  s += `<line x1="${sx(.92)}" x2="${sx(.92)}" y1="${m.t}" y2="${H - m.b}" style="stroke:var(--warn);stroke-dasharray:4 4;stroke-width:1.4"/><text x="${sx(.92) - 5}" y="${m.t + 10}" text-anchor="end" style="fill:var(--warn)">92% rule</text>`;
  const cls = p => p[2] && p[3] ? 'tp' : p[2] ? 'fp' : p[3] ? 'fn' : 'ok';
  const style = { ok: 'fill:var(--muted);opacity:.45', tp: 'fill:var(--s3)', fp: 'fill:none;stroke:var(--s2);stroke-width:2', fn: 'fill:var(--s7)' };
  const nm = { ok: 'Normal', tp: 'Degradation detected', fp: 'False alarm', fn: 'Degradation missed' };
  ['ok', 'fp', 'fn', 'tp'].forEach(c => pts.filter(p => cls(p) === c).forEach(p => { s += `<circle cx="${sx(p[0]).toFixed(1)}" cy="${sy(p[1]).toFixed(1)}" r="${c === 'ok' ? 2.6 : 4.2}" style="${style[c]}" data-tip="${esc('<b>' + nm[c] + '</b>' + row('', 'Adjusted completeness', nf(p[0] * 100, 0) + '%'))}"/>`; }));
  el.innerHTML = s + '</svg>';
  const cn = {}; pts.forEach(p => { cn[cls(p)] = (cn[cls(p)] || 0) + 1; });
  $('#scLeg').innerHTML = `<span><i style="background:var(--muted);opacity:.6;border-radius:50%"></i>Normal</span><span><i style="background:var(--s3);border-radius:50%"></i>Detected (${cn.tp || 0})</span><span><i class="ring-i" style="border-color:var(--s2)"></i>False alarm (${cn.fp || 0})</span><span><i style="background:var(--s7);border-radius:50%"></i>Missed (${cn.fn || 0})</span>`;
}
const scEl = $('#chScatter'); scatter(scEl, A.scatter);
if ('ResizeObserver' in window) { let lw = scEl.clientWidth; new ResizeObserver(() => { if (Math.abs(scEl.clientWidth - lw) > 2) { lw = scEl.clientWidth; scatter(scEl, A.scatter); } }).observe(scEl); }
const fsr = A.feed_series;
$('#feedT').textContent = `Feed ${fsr.feed}: degradations the "OK" status did not show`;
const fpts = fsr.points.map((p, i) => [i, p.c]);
lineChart($('#chFeed'), {
  series: [{ pts: fpts, color: 'var(--brand)', w: 1.8 }], h: 240, yMin: 0, yMax: 1.2, yTicks: [0, .4, .8, 1.2], yFmt: v => nf(v * 100, 0) + '%',
  xTicks: fsr.points.map((p, i) => i % 30 === 0 ? { v: i, label: `${MES[+p.d.slice(5, 7) - 1]} ${+p.d.slice(8, 10)}` } : null).filter(Boolean),
  dots: fsr.points.map((p, i) => p.st !== 'OK' ? { x: i, y: p.c, color: 'var(--bad)', r: 4 } : p.flag ? { x: i, y: p.c, color: 'var(--s3)', r: 6, ring: true } : null).filter(Boolean),
  tip: i => { const p = fsr.points[i]; return `<b>${fdate(p.d)}</b>` + row('var(--brand)', 'Adjusted completeness', nf(p.c * 100, 0) + '%') + row('', 'Status', p.st) + (p.flag && p.st === 'OK' ? row('var(--s3)', 'Detector', 'alert') : ''); }, aria: 'Daily adjusted completeness of a feed'
});
$('#anSub').textContent = `Of ${nf(A.ok_days)} deliveries with OK status, ${nf(A.silent_total)} were degraded (simulation ground truth). The completeness <92% rule was the most precise; IsolationForest alone did not beat it. The hybrid adds coverage.`;
$('#anTable').innerHTML = `<thead><tr><th>Method</th><th class="n">Alerts</th><th class="n">Hits</th><th>Precision</th><th>Recall</th></tr></thead><tbody>` + A.rows.map((r, i) => `<tr class="${i === A.rows.length - 1 ? 'hl' : ''}"><td>${esc(r.method)}${r.method === 'IsolationForest' ? ` <span class="mono" style="color:var(--muted)">(${nf(100 * r.flag_rate, 1)}%)</span>` : ''}</td><td class="n">${nf(r.flagged)}</td><td class="n">${nf(r.tp)}</td>
<td class="mono"><span class="minibar" style="width:${(60 * r.precision).toFixed(0)}px"></span>${pct(100 * r.precision, 0)}</td><td class="mono"><span class="minibar" style="width:${(60 * r.recall).toFixed(0)}px;background:var(--brand2)"></span>${pct(100 * r.recall, 0)}</td></tr>`).join('') + '</tbody>';
$('#flSub').textContent = `${nf(A.flags_last_90d)} alerts in the last 90 days on deliveries with OK status. The 8 most severe:`;
$('#flags').innerHTML = `<thead><tr><th>Feed</th><th>Client</th><th>Date</th><th class="n">Completeness</th></tr></thead><tbody>` + A.latest_flags.map(f => `<tr><td class="mono">${f.feed}</td><td>${esc(f.client)}</td><td class="mono">${fdate(f.date)}</td><td class="n">${nf(f.completeness * 100, 0)}%</td></tr>`).join('') + '</tbody>';

/* ===== actions, limits, requirements, sources ===== */
const sd = par.schema_drift, a0 = fa[0].bad_delivery_pct, a4 = fa[fa.length - 1].bad_delivery_pct, g30 = grid.find(x => x.topk === 20 && x.reduction === 30);
$('#acts').innerHTML = [
  ['Root cause', 'Validate the schema before ingesting', 'Put contract tests (fields, formats, checksum) at the entry of each source and reject with a notice to the provider, instead of discovering the change when the client\'s feed fails.', `${pct(sd.share_pct, 0)} of incidents · ${pct(sd.breach_share_pct, 0)} of breaches · ${pct(sd.breach_pct, 0)} breach · ${pct(sd.esc_pct, 0)} escalated`],
  ['Detection', 'Alert on completeness, not just status', 'Measure records received against what is typical for each feed by day type, and warn the client before they notice.', `${nf(missN)} bad deliveries with no ticket · ${nf(A.silent_total)} silent degradations · hybrid detector: ${pct(100 * hyb.recall, 0)} recall, ${pct(100 * hyb.precision, 0)} precision`],
  ['Triage', 'Flag the highest-risk 20% when the ticket opens', 'Use the risk model to assign a resolver earlier and review those cases first. Run a pilot to measure the real effect.', `Captures ${pct(100 * g20, 0)} of breaches · with −30% time on those cases: ${nf(g30.avoided)} avoided out of ${nf(C.whatif.test_breaches)} (scenario)`],
  ['Accounts', 'Look after the first 90 days and the critical accounts', 'A go-live checklist for new feeds and a weekly review of the accounts that breach the most.', `Feeds < 30 days: ${pct(a0, 1)} bad deliveries vs ${pct(a4, 1)} on mature ones · 20% of clients = ${pct(c20, 0)} of breaches`]
].map(a => `<div class="act"><div class="tag">${a[0]}</div><h3>${a[1]}</h3><p>${a[2]}</p><div class="ev">${a[3]}</div></div>`).join('');
$('#limits').innerHTML = [
  'The operational data is simulated. No figure describes Simply.TV\'s real operation; what is shown is the method.',
  'Ticket text and silent degradations were generated with simple rules, so the NLP and anomaly detection look better than they would on real data.',
  `An AUC of ${nf(bestAuc, 2)} is useful for prioritizing, not for deciding alone: resolution time has a lot of noise that ticket variables do not explain.`,
  'The milestone analysis has low power. No detectable effect does not mean no effect.',
  'The scenario savings assume a proportional reduction in resolution time; it is a hypothesis for a pilot.',
  'The colors are an approximation of Simply.TV\'s style: its brand guide could not be verified.'].map(x => `<li>${x}</li>`).join('');
$('#jd').innerHTML = '<thead><tr><th>Job requirement</th><th>Evidence</th></tr></thead><tbody>' + [
  ['Python to investigate, validate and transform data', 'ETL with regex, pandas, validations and a data-quality log'],
  ['SQL and databases', 'Star schema, 2 views and 18 queries with CTEs, window functions, LAG and NTILE'],
  ['APIs, JSON/XML, logs and feeds', 'JSONL, XML, .gz log and CSV unified in a single warehouse'],
  ['Root cause and clear diagnosis', 'Cause Pareto, recurrence, milestones and concentration by client'],
  ['AI use and prompting', 'Multilingual NLP triage and a diagnostic prompt playbook'],
  ['Communicating to technical and non-technical audiences', 'This dashboard and a README with decisions and limits'],
  ['Attention to detail and accuracy', 'Time-based split with no data leakage and validation against simulation ground truth']].map(r => `<tr><td>${r[0]}</td><td>${r[1]}</td></tr>`).join('') + '</tbody>';
const srcExtra = [['', 'Simply.TV website: segments, products and platforms', 'https://www.simply.tv/'], ['2024', 'Rethink Technology Research: Simply.TV founded in 2019', 'https://rethinkresearch.biz/articles/simply-tv-buys-its-own-metadata-grandmother/'], ['2024', 'Advanced Television: InFlow Media acquisition', 'https://advanced-television.com/2024/07/03/simply-tv-acquires-inflow-media/']];
$('#sources').innerHTML = D.events.map(e => `<li><span class="dt">${fdate(e.event_date)}</span><a href="${esc(e.url)}" target="_blank" rel="noopener">${esc(e.name)}</a></li>`).join('') + srcExtra.map(s => `<li><span class="dt">${s[0]}</span><a href="${s[2]}" target="_blank" rel="noopener">${s[1]}</a></li>`).join('');
$('#foot1').textContent = `Data through ${fdate(D.meta.cutoff)} · generated ${fdate(D.meta.generated)} · Python, SQLite and scikit-learn.`;
$$('.cnt').forEach(countUp);
