/* ===== Interactive explorer: global filters + animated map + Sankey =====
   Everything is recalculated in the browser over D.explorer.rows (one row per incident of v_incident):
   [month, region, segment, tier, cause, severity, outcome]  outcome: 0 within SLA · 1 outside · 2 open or invalid closure */
(function () {
  const X = D.explorer, dims = X.dims, ALL = X.rows;
  const CAUSE_COLOR = { schema_drift: 'var(--s7)', source_outage: 'var(--s1)', mapping_error: 'var(--s3)', stale_schedule: 'var(--s4)', image_gap: 'var(--s5)', delivery_endpoint: 'var(--s8)', duplicate_ids: 'var(--s6)', client_config: 'var(--brand2)', unclassified: 'var(--muted)' };
  const OUT = [{ label: 'Within SLA', color: 'var(--brand)' }, { label: 'Outside SLA', color: 'var(--s2)' }, { label: 'Open or invalid closure', color: 'var(--muted)' }];
  const LL = { 'Benelux': [51.2, 4.5], 'Brazil (LATAM-PT)': [-14, -51], 'DACH': [47.6, 10.8], 'Iberia & LATAM-ES': [40.2, -3.7], 'Nordics': [62, 15], 'North America': [40, -98], 'Other Europe': [49, 27], 'Turkey / MEA / APAC': [37, 38] };
  const LBL = { 'Benelux': 'l', 'Brazil (LATAM-PT)': 'b', 'DACH': 'r', 'Iberia & LATAM-ES': 'l', 'Nordics': 't', 'North America': 'b', 'Other Europe': 't', 'Turkey / MEA / APAC': 'b' };
  const HUB = [55.7, 12.6];
  const NS = 'http://www.w3.org/2000/svg';
  const f = { region: null, segment: null, tier: null };
  const inRows = (skip) => ALL.filter(r => (skip === 'region' || f.region == null || r[1] === f.region) && (f.segment == null || r[2] === f.segment) && (f.tier == null || r[3] === f.tier));
  const sh = (a, b) => b ? 100 * a / b : 0;
  const resolvedOf = rs => rs.filter(r => r[6] < 2);
  const breachPct = rs => { const q = resolvedOf(rs); return q.length ? sh(q.filter(r => r[6] === 1).length, q.length) : null; };
  const BASE = breachPct(ALL), N0 = ALL.length;
  const mk = (tag, attrs = {}, parent) => { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); if (parent) parent.appendChild(e); return e; };

  /* ---------- filtros ---------- */
  const fbox = $('#filters');
  function renderFilters() {
    const grp = (key, title, vals) => `<div class="fg"><div class="fl">${title}</div><div class="fchips">` +
      `<button type="button" data-k="${key}" data-v="" aria-pressed="${f[key] == null}">All</button>` +
      vals.map((v, i) => `<button type="button" data-k="${key}" data-v="${i}" aria-pressed="${f[key] === i}">${esc(v)}</button>`).join('') + '</div></div>';
    fbox.innerHTML = grp('region', 'Region', dims.region) + grp('segment', 'Segment', dims.segment) + grp('tier', 'Tier', dims.tier) +
      `<div class="fg frs"><button type="button" class="reset" id="fReset" ${f.region == null && f.segment == null && f.tier == null ? 'disabled' : ''}>Clear filters</button></div>`;
  }
  fbox.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.id === 'fReset') { f.region = f.segment = f.tier = null; }
    else if (b.dataset.k) { const v = b.dataset.v === '' ? null : Number(b.dataset.v); f[b.dataset.k] = (f[b.dataset.k] === v) ? null : v; }
    update();
  });

  /* ---------- KPIs ---------- */
  function renderKpis(rs) {
    const q = resolvedOf(rs), br = q.filter(r => r[6] === 1).length, bp = breachPct(rs);
    const byC = {}; q.forEach(r => { if (r[6] === 1) byC[r[4]] = (byC[r[4]] || 0) + 1; });
    const top = Object.entries(byC).sort((a, b) => b[1] - a[1])[0];
    const hi = rs.filter(r => r[5] <= 1).length;
    const dpp = bp == null ? null : bp - BASE;
    const monthly = (fn) => X.months.map((_, m) => fn(rs.filter(r => r[0] === m)));
    const small = q.length < 30;
    $('#xKpis').innerHTML = [
      ['Incidents', cnt(rs.length), '', `${pct(sh(rs.length, N0), 0)} of total`, 'xs0'],
      ['Outside SLA', bp == null ? '—' : cnt(bp, 1), bp == null ? '' : '%', bp == null ? 'no resolved incidents' : `<span class="dlt ${dpp > 0.05 ? 'up' : dpp < -0.05 ? 'dn' : ''}">${dpp >= 0 ? '+' : '−'}${nf(Math.abs(dpp), 1)} pp</span> vs the total (${pct(BASE)})${small ? ' · <b>small sample</b>' : ''}`, 'xs1'],
      ['Cause that breaches most', top ? `<span class="vt">${esc(CAT[dims.category[top[0]]])}</span>` : '—', '', top ? `${pct(sh(top[1], br), 0)} of the ${nf(br)} breaches` : 'no breaches', ''],
      ['Severity P1–P2', rs.length ? cnt(sh(hi, rs.length), 1) : '—', rs.length ? '%' : '', `${nf(hi)} critical or major incidents`, '']
    ].map(k => `<div class="kpi"><div class="k">${k[0]}</div><div class="v">${k[1]}${k[2] ? `<small>${k[2]}</small>` : ''}</div>${k[4] ? `<div class="s" id="${k[4]}"></div>` : ''}<div class="d">${k[3]}</div></div>`).join('');
    $$('#xKpis .cnt').forEach(countUp);
    spark($('#xs0'), monthly(a => a.length), 'var(--brand)');
    spark($('#xs1'), monthly(a => breachPct(a) || 0), 'var(--brand2)');
  }

  /* ---------- causas ---------- */
  function renderCauses(rs) {
    const q = resolvedOf(rs), br = q.filter(r => r[6] === 1).length;
    const rowsC = dims.category.map((c, i) => {
      const a = rs.filter(r => r[4] === i), ar = a.filter(r => r[6] < 2), ab = ar.filter(r => r[6] === 1).length;
      return { c, i, n: a.length, share: sh(a.length, rs.length), bshare: sh(ab, br), bp: ar.length ? sh(ab, ar.length) : null, ab };
    }).filter(r => r.n > 0).sort((a, b) => b.n - a.n);
    if (!rowsC.length) { $('#xCause').innerHTML = '<p class="sub">No incidents with these filters.</p>'; $('#causeT').textContent = 'Root causes'; return; }
    const lead = [...rowsC].sort((a, b) => b.bshare - a.bshare)[0];
    $('#causeT').textContent = lead.ab ? `${CAT[lead.c]} accounts for ${pct(lead.bshare, 0)} of breaches` : 'No breaches with these filters';
    const mx = Math.max(...rowsC.flatMap(r => [r.share, r.bshare]), 1);
    barRows($('#xCause'), rowsC.map(r => ({
      label: CAT[r.c], hl: r === lead && lead.ab > 0,
      vals: [{ v: r.share, color: 'var(--s1)', fmt: pct(r.share, 0) }, { v: r.bshare, color: 'var(--s2)', fmt: pct(r.bshare, 0) }],
      right: r.bp == null ? '—' : `${pct(r.bp, 0)} breach`,
      tip: `<b>${CAT[r.c]}</b>` + row('', 'Incidents', nf(r.n)) + row('', 'Breaches', nf(r.ab)) + (r.bp == null ? '' : row('', 'Breach rate', pct(r.bp)))
    })), { max: mx });
  }

  /* ---------- mapa ---------- */
  const W = 900, WD = X.world, ncol = WD.rows[0].length, nrow = WD.rows.length;
  const H = Math.round(W * (WD.lat1 - WD.lat0) / (WD.lon1 - WD.lon0));
  const px = lon => (lon - WD.lon0) / (WD.lon1 - WD.lon0) * W, py = lat => (WD.lat1 - lat) / (WD.lat1 - WD.lat0) * H;
  const mapEl = $('#xMap');
  const svg = mk('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Map of incidents by region' }, mapEl);
  let d = '';
  WD.rows.forEach((s, y) => { for (let x = 0; x < ncol; x++) if (s[x] === '1') d += `M${(x * W / (ncol - 1)).toFixed(1)} ${(y * H / (nrow - 1)).toFixed(1)}h0`; });
  mk('path', { d, class: 'land' }, svg);
  const gArcs = mk('g', {}, svg), gMk = mk('g', {}, svg);
  const hx = px(HUB[1]), hy = py(HUB[0]);
  const mkr = {};
  dims.region.forEach((rg, i) => {
    const [la, lo] = LL[rg] || [0, 0], x = px(lo), y = py(la);
    const mx = (x + hx) / 2, my = (y + hy) / 2 - Math.hypot(x - hx, y - hy) * 0.28;
    const arc = mk('path', { d: `M${x.toFixed(1)} ${y.toFixed(1)}Q${mx.toFixed(1)} ${my.toFixed(1)} ${hx.toFixed(1)} ${hy.toFixed(1)}`, class: 'arc' }, gArcs);
    const g = mk('g', { class: 'mk', tabindex: 0, role: 'button' }, gMk);
    const pulse = mk('circle', { cx: x.toFixed(1), cy: y.toFixed(1), class: 'pulse' }, g);
    const dot = mk('circle', { cx: x.toFixed(1), cy: y.toFixed(1), class: 'dot' }, g);
    const lab = mk('text', { class: 'mlab' }, g);
    mkr[i] = { g, arc, pulse, dot, lab, x, y };
    g.addEventListener('click', () => { f.region = f.region === i ? null : i; update(); });
    g.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); g.dispatchEvent(new Event('click')); } });
  });
  const hub = mk('path', { d: `M${hx} ${hy - 7}l6 7l-6 7l-6 -7z`, class: 'hub' }, svg);
  hub.setAttribute('data-tip', '<b>Copenhague</b><div class="m">Simply.TV public headquarters (destination of the lines)</div>');
  function renderMap(rs) {
    const st = dims.region.map((_, i) => { const a = rs.filter(r => r[1] === i); return { n: a.length, bp: a.filter(r => r[6] < 2).length >= 10 ? breachPct(a) : null }; });
    const mxN = Math.max(...st.map(s => s.n), 1);
    const sel = f.region;
    dims.region.forEach((rg, i) => {
      const s = st[i], m = mkr[i], r = s.n ? 5 + Math.sqrt(s.n / mxN) * 13 : 3;
      const t = s.bp == null ? 0.35 : Math.min(1, Math.max(0, (s.bp - 15) / 20));
      const color = s.bp == null ? 'var(--muted)' : `color-mix(in oklab, var(--s2) ${(t * 100).toFixed(0)}%, var(--brand))`;
      const dim = sel != null && sel !== i;
      m.dot.style.setProperty('r', r.toFixed(1) + 'px'); m.pulse.style.setProperty('r', r.toFixed(1) + 'px');
      m.dot.style.fill = color; m.pulse.style.fill = color;
      m.pulse.style.animationDuration = (3.4 - t * 1.8).toFixed(2) + 's';
      m.g.style.opacity = dim ? .28 : 1; m.arc.style.opacity = dim ? .08 : .55;
      m.arc.style.strokeWidth = (0.8 + Math.sqrt(s.n / mxN) * 3.2).toFixed(2);
      m.arc.style.stroke = color; m.arc.style.animationDuration = (2.6 - t * 1.2).toFixed(2) + 's';
      m.g.setAttribute('aria-pressed', sel === i);
      m.g.setAttribute('aria-label', `${rg}: ${s.n} incidents${s.bp == null ? '' : ', ' + nf(s.bp, 1) + '% outside SLA'}. Click to filter.`);
      const side = LBL[rg] || 'r', gap = r + 6;
      const tx = side === 'l' ? m.x - gap : side === 'r' ? m.x + gap : m.x;
      const ty = side === 't' ? m.y - gap : side === 'b' ? m.y + gap + 9 : m.y + 4;
      m.lab.setAttribute('x', tx.toFixed(1)); m.lab.setAttribute('y', ty.toFixed(1));
      m.lab.setAttribute('text-anchor', side === 'l' ? 'end' : side === 'r' ? 'start' : 'middle');
      m.lab.textContent = `${rg}${s.bp == null ? '' : ' · ' + nf(s.bp, 0) + '%'}`;
      m.g.setAttribute('data-tip', `<b>${esc(rg)}</b>` + row('', 'Incidents', nf(s.n)) + row('', 'Outside SLA', s.bp == null ? 'small sample' : pct(s.bp)) + `<div class="m">${sel === i ? 'Click: remove filter' : 'Click: filter by this region'}</div>`);
    });
    const tot = st.reduce((a, s) => a + s.n, 0), top = st.map((s, i) => [i, s.n]).sort((a, b) => b[1] - a[1])[0];
    $('#mapT').textContent = tot ? `${dims.region[top[0]]} holds ${pct(sh(top[1], tot), 0)} of incidents${f.segment != null || f.tier != null ? ' in this slice' : ''}` : 'No incidents with these filters';
    $('#mapLeg').innerHTML = `<span><i style="background:var(--brand)"></i>≤ 15% outside SLA</span><span><i style="background:var(--s2)"></i>≥ 35%</span><span><i style="background:var(--muted)"></i>small sample (&lt; 10 resolved)</span>`;
  }

  /* ---------- Sankey ---------- */
  const SW = 980, SH = 430, NW = 14, ML = 168, MR = 190, GAP = 8;
  function renderSankey(rs) {
    const box = $('#xSankey');
    if (!rs.length) { box.innerHTML = '<p class="sub">No incidents with these filters.</p>'; $('#sankT').textContent = 'Incident journey'; return; }
    const N = rs.length;
    const cnt1 = (idx, n) => { const a = new Array(n).fill(0); rs.forEach(r => a[r[idx]]++); return a; };
    const cC = cnt1(4, dims.category.length), cS = cnt1(5, 4), cO = cnt1(6, 3);
    const colA = cC.map((v, i) => ({ id: 'c' + i, v, label: CAT[dims.category[i]], color: CAUSE_COLOR[dims.category[i]] || 'var(--muted)', raw: i })).filter(n => n.v).sort((a, b) => b.v - a.v);
    const colB = cS.map((v, i) => ({ id: 's' + i, v, label: dims.severity[i], color: 'var(--ink2)', raw: i })).filter(n => n.v);
    const colC = cO.map((v, i) => ({ id: 'o' + i, v, label: OUT[i].label, color: OUT[i].color, raw: i })).filter(n => n.v);
    const cols = [colA, colB, colC];
    const k = Math.min(...cols.map(c => (SH - GAP * (c.length - 1)) / N));
    const xs = [ML, (ML + SW - MR - NW) / 2, SW - MR - NW];
    cols.forEach((c, ci) => {
      const tot = c.reduce((a, n) => a + n.v * k, 0) + GAP * (c.length - 1); let y = (SH - tot) / 2;
      c.forEach(n => { n.x = xs[ci]; n.y = y; n.h = Math.max(n.v * k, 1.5); y += n.v * k + GAP; n.out = 0; n.inn = 0; });
    });
    const byId = {}; cols.flat().forEach(n => { byId[n.id] = n; });
    const lm = {}; const add = (a, b) => { const key = a + '>' + b; lm[key] = (lm[key] || 0) + 1; };
    rs.forEach(r => { add('c' + r[4], 's' + r[5]); add('s' + r[5], 'o' + r[6]); });
    const links = Object.entries(lm).map(([key, v]) => { const [a, b] = key.split('>'); return { a: byId[a], b: byId[b], v }; });
    links.sort((p, q) => p.b.y - q.b.y || p.a.y - q.a.y);
    const outOrder = [...links].sort((p, q) => p.a.y - q.a.y || p.b.y - q.b.y);
    outOrder.forEach(l => { l.sy = l.a.y + l.a.out; l.a.out += l.v * k; });
    links.forEach(l => { l.ty = l.b.y + l.b.inn; l.b.inn += l.v * k; });
    let out = `<svg viewBox="0 0 ${SW} ${SH}" role="img" aria-label="Flow diagram: root cause, severity and SLA outcome"><g class="sk-links">`;
    links.forEach(l => {
      const w = Math.max(l.v * k, 1), x0 = l.a.x + NW, x1 = l.b.x, y0 = l.sy + w / 2, y1 = l.ty + w / 2, cx = (x0 + x1) / 2;
      const first = l.a.id[0] === 'c', color = first ? l.a.color : l.b.color;
      const tipH = `<b>${esc(l.a.label)} → ${esc(l.b.label)}</b>` + row(color, 'Incidents', nf(l.v)) + row('', 'Of its origin', pct(sh(l.v, l.a.v), 0)) + row('', 'Of filtered total', pct(sh(l.v, N), 1));
      out += `<path class="sk-l" pathLength="1" d="M${x0.toFixed(1)} ${y0.toFixed(1)}C${cx.toFixed(1)} ${y0.toFixed(1)} ${cx.toFixed(1)} ${y1.toFixed(1)} ${x1.toFixed(1)} ${y1.toFixed(1)}" stroke="${color}" stroke-width="${w.toFixed(1)}" data-tip="${esc(tipH)}"/>`;
    });
    out += '</g><g class="sk-nodes">';
    cols.forEach((c, ci) => c.forEach(n => {
      const extra = ci === 1 ? row('', 'Outside SLA', (() => { const q = rs.filter(r => r[5] === n.raw && r[6] < 2); return q.length ? pct(sh(q.filter(r => r[6] === 1).length, q.length), 0) : '—'; })()) : '';
      const tipH = `<b>${esc(n.label)}</b>` + row('', 'Incidents', nf(n.v)) + row('', 'Of filtered total', pct(sh(n.v, N), 1)) + extra;
      out += `<rect x="${n.x}" y="${n.y.toFixed(1)}" width="${NW}" height="${n.h.toFixed(1)}" rx="3" fill="${n.color}" data-tip="${esc(tipH)}"/>`;
      const tx = ci === 0 ? n.x - 8 : n.x + NW + 8, an = ci === 0 ? 'end' : 'start', ty = n.y + n.h / 2 + 4;
      if (n.h >= 10 || ci === 2) out += `<text class="sk-t" x="${tx}" y="${ty.toFixed(1)}" text-anchor="${an}">${esc(n.label)} <tspan class="sk-n">${nf(n.v)}</tspan></text>`;
    }));
    out += '</g></svg>';
    box.innerHTML = out;
    const br = cO[1], res = cO[0] + cO[1];
    const q = resolvedOf(rs), byC = {}; q.forEach(r => { if (r[6] === 1) byC[r[4]] = (byC[r[4]] || 0) + 1; });
    const topC = Object.entries(byC).sort((a, b) => b[1] - a[1])[0];
    $('#sankT').textContent = br ? `${nf(br)} breaches out of ${nf(N)} incidents${topC ? `: ${CAT[dims.category[topC[0]]]} is the largest source (${pct(sh(topC[1], br), 0)})` : ''}` : `No breaches among ${nf(N)} incidents`;
    if (!RM) {
      $$('.sk-l', box).forEach((p, i) => p.animate([{ strokeDasharray: '1 1', strokeDashoffset: 1 }, { strokeDasharray: '1 1', strokeDashoffset: 0 }], { duration: 900, delay: Math.min(i * 12, 400), easing: 'cubic-bezier(.3,.6,.2,1)', fill: 'backwards' }));
      $$('.sk-nodes rect', box).forEach((r, i) => r.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 500, delay: i * 25, fill: 'backwards' }));
    }
  }

  /* ---------- donuts: composition of the slice ---------- */
  const SEVC = ['var(--s8)', 'var(--s4)', 'var(--s1)', 'var(--s3)'], TIERC = ['var(--s4)', 'var(--s1)', 'var(--s2)'];
  const mkDn = (id, aria, n) => donut($('#' + id), { aria, sw: 14, legendEl: $('#' + id + 'L'), segs: Array.from({ length: n }, () => ({ label: '', value: 0, color: 'var(--line)' })), center: { big: '', cap: '' } });
  const DN = { out: mkDn('dnOut', 'SLA outcome of the filtered incidents', 3), sev: mkDn('dnSev', 'Severity of the filtered incidents', 4), tier: mkDn('dnTier', 'Client tier of the filtered incidents', 3) };
  function renderDonuts(rs) {
    const c = (idx, n) => Array.from({ length: n }, (_, k) => rs.filter(r => r[idx] === k).length), ctr = { big: nf(rs.length), cap: 'incidents' };
    DN.out.set(OUT.map((o, k) => ({ label: o.label, value: c(6, 3)[k], color: o.color })), ctr);
    DN.sev.set(dims.severity.map((l, k) => ({ label: l, value: c(5, 4)[k], color: SEVC[k] })), ctr);
    DN.tier.set(dims.tier.map((l, k) => ({ label: l, value: c(3, 3)[k], color: TIERC[k] })), ctr);
  }
  function update() {
    renderFilters();
    const rs = inRows(), rsMap = inRows('region');
    window.STV_SKY && window.STV_SKY.set(rs);
    renderKpis(rs); renderDonuts(rs); renderCauses(rs); renderMap(rsMap); renderSankey(rs);
  }
  window.STV_X = { rows: () => inRows(), dims, months: X.months, filters: () => ({ ...f }), outcomes: OUT.map(o => o.label) };
  update();
})();
