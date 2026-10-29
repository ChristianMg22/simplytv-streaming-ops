/* ===== utilidades ===== */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const RM = matchMedia('(prefers-reduced-motion: reduce)').matches;
const nf = (n, d = 0) => Number(n).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
const pct = (n, d = 1) => nf(n, d) + '%';
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const MES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fdate = s => { const [y, m, d] = s.split('-').map(Number); return `${MES[m - 1]} ${d}, ${y}`; };
const fmon = s => { const [y, m] = s.split('-').map(Number); return `${MES[m - 1]} ${String(y).slice(2)}`; };
const CAT = {
  schema_drift: 'Schema drift', source_outage: 'Source outage', mapping_error: 'Channel mapping',
  stale_schedule: 'Stale EPG', image_gap: 'Missing images', delivery_endpoint: 'Client delivery',
  duplicate_ids: 'Duplicate IDs', client_config: 'Client config', unclassified: 'Unclassified'
};
const row = (c, k, v) => `<div class="r"><span>${c ? `<i style="background:${c}"></i>` : ''}${k}</span><span>${v}</span></div>`;

/* ===== tooltip global (cualquier elemento con data-tip) ===== */
const tip = document.createElement('div');
tip.className = 'tip'; tip.hidden = true; tip.setAttribute('role', 'tooltip');
document.body.appendChild(tip);
function showTip(h, x, y) {
  tip.innerHTML = h; tip.hidden = false;
  const r = tip.getBoundingClientRect();
  let l = x + 14, t = y + 16;
  if (l + r.width > innerWidth - 8) l = x - r.width - 14;
  if (t + r.height > innerHeight - 8) t = y - r.height - 14;
  tip.style.transform = `translate(${Math.max(8, l)}px,${Math.max(8, t)}px)`;
}
const hideTip = () => { tip.hidden = true; };
const tipMove = e => {
  const t = e.target.closest && e.target.closest('[data-tip]');
  const h = t && t.getAttribute('data-tip');
  if (h) showTip(h, e.clientX, e.clientY); else hideTip();
};
document.addEventListener('pointermove', tipMove);
document.addEventListener('pointerdown', tipMove);
document.documentElement.addEventListener('pointerleave', hideTip);

/* ===== animation on entering the viewport (the resting state is already the final one) ===== */
const io = ('IntersectionObserver' in window) ? new IntersectionObserver(es => {
  es.forEach(en => {
    const t = en.target;
    if (en.intersectionRatio >= .15) { if (!t.__in) { t.__in = true; (t.__cbs || []).forEach(f => f()); } }       // entering: play (every time)
    else if (en.intersectionRatio === 0 && t.__in) { t.__in = false; (t.__rs || []).forEach(f => f()); }          // fully left: reset to the start state
  });
}, { threshold: [0, .15] }) : null;
function onVisible(el, cb, reset) { if (RM || !io) return; (el.__cbs = el.__cbs || []).push(cb); if (reset) (el.__rs = el.__rs || []).push(reset); io.observe(el); }
function playBars(el) {
  $$('.bar', el).forEach((b, i) => b.animate([{ transform: 'scaleX(0)' }, { transform: 'scaleX(1)' }],
    { duration: 800, delay: i * 40, easing: 'cubic-bezier(.2,.7,.2,1)', fill: 'backwards' }));
}
function playLines(el) {
  $$('path.ln', el).forEach(p => { if (p.dataset.anim === '1') p.animate(
    [{ strokeDasharray: '1 1', strokeDashoffset: 1 }, { strokeDasharray: '1 1', strokeDashoffset: 0 }],
    { duration: 1200, easing: 'cubic-bezier(.3,.6,.2,1)' }); });
}
function countUp(el) {
  const to = +el.dataset.to, dec = +(el.dataset.dec || 0);
  const set = v => { el.textContent = nf(v, dec); };
  set(to);
  onVisible(el, () => {
    const t0 = performance.now(), from = to * .55, dur = 1100;
    const step = t => { const k = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - k, 3); set(from + (to - from) * e); if (k < 1) requestAnimationFrame(step); };
    requestAnimationFrame(step);
  });
}
const cnt = (v, dec = 0) => `<span class="cnt" data-to="${v}" data-dec="${dec}">${nf(v, dec)}</span>`;

/* ===== escalas ===== */
function niceTicks(min, max, n = 4) {
  const span = (max - min) || 1, raw = span / n, p = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / p;
  const step = (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * p, out = [];
  for (let v = Math.ceil(min / step - 1e-9) * step; v <= max + 1e-9; v += step) out.push(+v.toFixed(10));
  return out;
}

/* ===== line / area chart with band, markers and hover ===== */
let UID = 0;
function lineChart(el, o) {
  const id = 'lc' + (++UID); let first = true, lastW = 0;
  const series = o.series;
  const maps = series.map(s => new Map(s.pts.map(p => [p[0], p[1]])));
  const xsHover = [...new Set(series.flatMap(s => s.hover === false ? [] : s.pts.map(p => p[0])))].sort((a, b) => a - b);
  const render = () => {
    const W = Math.max(el.clientWidth || 300, 240), H = o.h || 230;
    lastW = W;
    const m = { l: o.ml || 44, r: o.mr || 14, t: o.mt || 14, b: o.xTitle ? 44 : 26 };
    const iw = W - m.l - m.r, ih = H - m.t - m.b;
    const pts = series.flatMap(s => s.pts);
    const xmin = o.xDomain ? o.xDomain[0] : Math.min(...pts.map(p => p[0]));
    const xmax = o.xDomain ? o.xDomain[1] : Math.max(...pts.map(p => p[0]));
    const bandVals = o.band ? o.band.pts.flatMap(p => [p[1], p[2]]) : [];
    const ys = pts.map(p => p[1]).concat(bandVals);
    const ymin = o.yMin != null ? o.yMin : Math.min(0, ...ys);
    let ymax = o.yMax != null ? o.yMax : Math.max(...ys) * 1.08;
    const yt = o.yTicks || niceTicks(ymin, ymax, o.nyt || 4);
    if (o.yMax == null) ymax = Math.max(ymax, yt[yt.length - 1]);
    const sx = x => m.l + (x - xmin) / ((xmax - xmin) || 1) * iw;
    const sy = y => m.t + ih - (y - ymin) / ((ymax - ymin) || 1) * ih;
    const yf = o.yFmt || (v => nf(v));
    const P = (arr) => arr.map((p, i) => (i ? 'L' : 'M') + sx(p[0]).toFixed(1) + ' ' + sy(p[1]).toFixed(1)).join('');
    let s = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(o.aria || '')}"><defs>`;
    series.forEach((se, k) => { if (se.area) s += `<linearGradient id="${id}g${k}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color:${se.color};stop-opacity:.34"/><stop offset="1" style="stop-color:${se.color};stop-opacity:0"/></linearGradient>`; });
    s += '</defs>';
    yt.forEach(v => { s += `<line x1="${m.l}" x2="${W - m.r}" y1="${sy(v).toFixed(1)}" y2="${sy(v).toFixed(1)}" style="stroke:var(--grid);stroke-width:1"/><text x="${m.l - 8}" y="${(sy(v) + 4).toFixed(1)}" text-anchor="end">${yf(v)}</text>`; });
    (o.xTicks || []).forEach(t => { const x = sx(t.v); if (x < m.l - 1 || x > W - m.r + 1) return; s += `<text x="${x.toFixed(1)}" y="${H - (o.xTitle ? 24 : 7)}" text-anchor="middle">${t.label}</text>`; });
    if (o.xTitle) s += `<text x="${W - m.r}" y="${H - 5}" text-anchor="end">${o.xTitle}</text>`;
    if (o.band) {
      const up = o.band.pts.map(p => [p[0], p[2]]), lo = o.band.pts.map(p => [p[0], p[1]]).reverse();
      s += `<path d="${P(up)}${P(lo).replace(/^M/, 'L')}Z" style="fill:${o.band.color};opacity:.18"/>`;
    }
    (o.vlines || []).forEach(v => { if (v.x < xmin || v.x > xmax) return; const x = sx(v.x).toFixed(1); s += `<line x1="${x}" x2="${x}" y1="${m.t}" y2="${m.t + ih}" style="stroke:${v.color || 'var(--muted)'};stroke-width:1;stroke-dasharray:${v.dash || '3 4'};opacity:.7"/>`; if (v.label) s += `<text x="${(+x + 5)}" y="${m.t + 9}" class="axis-t">${v.label}</text>`; });
    series.forEach((se, k) => {
      if (se.area) s += `<path d="${P(se.pts)}L${sx(se.pts[se.pts.length - 1][0]).toFixed(1)} ${sy(ymin).toFixed(1)}L${sx(se.pts[0][0]).toFixed(1)} ${sy(ymin).toFixed(1)}Z" style="fill:url(#${id}g${k})"/>`;
      s += `<path class="ln" data-anim="${se.dash || se.noAnim ? 0 : 1}" pathLength="1" d="${P(se.pts)}" fill="none" stroke-linejoin="round" stroke-linecap="round" style="stroke:${se.color};stroke-width:${se.w || 2};${se.dash ? 'stroke-dasharray:' + se.dash : ''};opacity:${se.op || 1}"/>`;
      if (se.end) { const p = se.pts[se.pts.length - 1]; s += `<circle cx="${sx(p[0]).toFixed(1)}" cy="${sy(p[1]).toFixed(1)}" r="4" style="fill:${se.color};stroke:var(--surface);stroke-width:2"/>`; }
    });
    (o.labels || []).forEach(l => { s += `<text class="lab" x="${(sx(l.x) + (l.dx || 0)).toFixed(1)}" y="${(sy(l.y) + (l.dy || 0)).toFixed(1)}" text-anchor="${l.anchor || 'start'}">${l.text}</text>`; });
    s += `<g class="xh" style="display:none"><line y1="${m.t}" y2="${m.t + ih}" style="stroke:var(--muted);stroke-width:1"/>` + series.map(se => `<circle r="4.5" style="fill:${se.color};stroke:var(--surface);stroke-width:2"/>`).join('') + '</g>';
    s += `<rect class="hov" x="${m.l}" y="${m.t}" width="${iw}" height="${ih}" fill="transparent"/>`;
    (o.dots || []).forEach(d => { s += `<circle cx="${sx(d.x).toFixed(1)}" cy="${sy(d.y).toFixed(1)}" r="${d.r || 4}" style="fill:${d.ring ? 'none' : d.color};stroke:${d.ring ? d.color : 'var(--surface)'};stroke-width:2" ${d.tip ? `data-tip="${esc(d.tip)}"` : ''}/>`; });
    (o.vlines || []).forEach(v => { if (v.x < xmin || v.x > xmax || !v.tip) return; const c = `<circle cx="${sx(v.x).toFixed(1)}" cy="${m.t}" r="${v.r || 5.5}" style="fill:${v.fill || 'var(--surface2)'};stroke:${v.color || 'var(--ink2)'};stroke-width:2;${v.href ? 'cursor:pointer' : ''}" data-tip="${esc(v.tip)}"/>`; s += v.href ? `<a href="${esc(v.href)}" target="_blank" rel="noopener" aria-label="${esc(v.name || 'hito')}">${c}</a>` : c; });
    s += '</svg>';
    el.innerHTML = s;
    const svg = el.firstChild, hov = $('.hov', svg), xh = $('.xh', svg), xl = $('.xh line', svg), xc = $$('.xh circle', svg);
    const move = e => {
      const r = svg.getBoundingClientRect(), xv = xmin + (e.clientX - r.left - m.l) / iw * (xmax - xmin);
      let best = xsHover[0], bd = Infinity;
      for (const x of xsHover) { const d = Math.abs(x - xv); if (d < bd) { bd = d; best = x; } }
      if (best == null) return;
      xh.style.display = ''; xl.setAttribute('x1', sx(best)); xl.setAttribute('x2', sx(best));
      xc.forEach((c, k) => { const y = maps[k].get(best); if (y == null || series[k].hover === false) { c.style.display = 'none'; } else { c.style.display = ''; c.setAttribute('cx', sx(best)); c.setAttribute('cy', sy(y)); } });
      hov.setAttribute('data-tip', o.tip ? o.tip(best) : '');
    };
    hov.addEventListener('pointermove', move);
    hov.addEventListener('pointerdown', move);
    hov.addEventListener('pointerleave', () => { xh.style.display = 'none'; hov.removeAttribute('data-tip'); });
    if (first) { first = false; onVisible(el, () => playLines(el)); }
  };
  render();
  if ('ResizeObserver' in window) new ResizeObserver(() => { if (Math.abs(el.clientWidth - lastW) > 2) render(); }).observe(el);
}

/* ===== bar rows (HTML) ===== */
function barRows(el, rows, o = {}) {
  const lo = o.min || 0;
  const max = o.max != null ? o.max : Math.max(...rows.flatMap(r => r.vals.map(v => v.v)));
  el.innerHTML = rows.map(r => `<div class="brow${r.hl ? ' hl' : ''}" ${r.tip ? `data-tip="${esc(r.tip)}"` : ''}>
    <div class="bl">${r.label}${r.sub ? `<small>${r.sub}</small>` : ''}</div>
    <div class="bt">${r.vals.map(v => `<div class="bline${o.big ? ' big' : ''}"><div class="bar" style="width:calc((100% - 60px) * ${Math.max(0.01, (v.v - lo) / ((max - lo) || 1)).toFixed(4)});background:${v.color}"></div><span class="bv">${v.fmt != null ? v.fmt : nf(v.v, 1)}</span></div>`).join('')}</div>
    <div class="br">${r.right || ''}</div></div>`).join('');
  onVisible(el, () => playBars(el));
}

/* ===== animated donut (vanilla port of the "DonutChart" React component) =====
   Segments draw in one after another, hovering a segment (or its legend row) lifts it with a glow and swaps the
   center text; set() tweens to new values, so it follows the explorer filters. */
function donut(el, o) {
  const id = 'dn' + (++RID), R = 46, SW = o.sw || 15, C = 2 * Math.PI * R, GAP = 1.6;
  let segs = o.segs, center = o.center, active = -1, shown = false;
  el.classList.add('dn');
  el.innerHTML = `<svg viewBox="0 0 120 120" role="img" aria-label="${esc(o.aria || 'Donut chart')}"><defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" style="stop-color:var(--brand)"/><stop offset="1" style="stop-color:var(--brand2)"/></linearGradient></defs>
    <circle cx="60" cy="60" r="${R}" fill="none" style="stroke:var(--line);stroke-width:${SW};opacity:.5"/>${segs.map((g, i) => `<circle class="dseg" data-i="${i}" cx="60" cy="60" r="${R}" fill="none" stroke-width="${SW}" style="stroke:${g.grad ? `url(#${id})` : g.color};color:${g.grad ? 'var(--brand)' : g.color}"/>`).join('')}</svg>
    <div class="ctr"><div class="big"></div><div class="cap"></div></div>`;
  const circles = $$('.dseg', el), big = $('.big', el), cap = $('.cap', el);
  const total = () => segs.reduce((a, g) => a + g.value, 0);
  function geom() {
    const T = total() || 1; let acc = 0;
    return segs.map(g => {
      const L = g.value / T * C, st = acc; acc += L;
      const round = L > 2.4 * SW, trim = round ? SW : 0, dash = Math.max(0, L - trim - GAP), off = -(st + (round ? SW / 2 : 0) + GAP / 2);
      return { dash: g.value > 0 ? dash : 0, off, round, vis: g.value > 0 };
    });
  }
  function paint(first) {
    const G = geom();
    circles.forEach((c, i) => {
      const g = G[i], sg = segs[i];
      c.style.stroke = sg.grad ? `url(#${id})` : sg.color; c.style.color = sg.grad ? 'var(--brand)' : sg.color;
      c.style.strokeLinecap = g.round ? 'round' : 'butt'; c.style.opacity = g.vis ? 1 : 0;
      c.style.transition = RM ? 'none' : `stroke-dasharray 1.1s cubic-bezier(.2,.7,.2,1) ${first ? i * 70 : 0}ms, stroke-dashoffset 1.1s cubic-bezier(.2,.7,.2,1) ${first ? i * 70 : 0}ms, filter .2s, transform .2s, opacity .3s`;
      c.setAttribute('stroke-dasharray', `${g.dash.toFixed(2)} ${C.toFixed(2)}`); c.setAttribute('stroke-dashoffset', g.off.toFixed(2));
    });
  }
  function text() {
    const g = segs[active], T = total();
    if (g) { big.textContent = o.fmt ? o.fmt(g.value) : nf(g.value); cap.textContent = `${g.label} · ${T ? nf(g.value / T * 100, 0) : 0}%`; }
    else { big.textContent = center.big; cap.textContent = center.cap || ''; }
  }
  function setActive(i) {
    active = i; circles.forEach((c, k) => c.classList.toggle('on', k === i)); text();
    if (o.legendEl) $$('.dl', o.legendEl).forEach((r, k) => r.classList.toggle('on', k === i));
  }
  function legend() {
    if (!o.legendEl) return; const T = total();
    o.legendEl.innerHTML = segs.map((g, i) => `<div class="dl" data-i="${i}"><i style="background:${g.grad ? 'var(--brand)' : g.color}"></i><span>${esc(g.label)}</span><b>${o.fmt ? o.fmt(g.value) : nf(g.value)}</b><em>${T ? nf(g.value / T * 100, 0) : 0}%</em></div>`).join('');
    $$('.dl', o.legendEl).forEach((r, i) => { r.addEventListener('mouseenter', () => setActive(i)); r.addEventListener('mouseleave', () => setActive(-1)); if (!RM) r.animate([{ opacity: 0, transform: 'translateX(-14px)' }, { opacity: 1, transform: 'none' }], { duration: 400, delay: shown ? 0 : 900 + i * 90, easing: 'ease-out', fill: 'backwards' }); });
  }
  circles.forEach((c, i) => { c.addEventListener('mouseenter', () => setActive(i)); c.addEventListener('mouseleave', () => setActive(-1)); });
  text(); legend();
  if (RM || !io) { shown = true; paint(false); }
  else {
    const zero = () => circles.forEach(c => { c.style.transition = 'none'; c.setAttribute('stroke-dasharray', `0 ${C.toFixed(2)}`); c.setAttribute('stroke-dashoffset', 0); });
    zero(); onVisible(el, () => { shown = true; requestAnimationFrame(() => requestAnimationFrame(() => paint(true))); }, () => { shown = false; zero(); });
  }
  return { set(ns, nc) { segs = ns; if (nc) center = nc; setActive(-1); legend(); if (shown || RM || !io) paint(false); } };
}

/* ===== progress ring ===== */
let RID = 0;
function ring(el, p, o = {}) {
  const id = 'rg' + (++RID), C = 2 * Math.PI * 52;
  el.innerHTML = `<svg viewBox="0 0 120 120"><defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" style="stop-color:${o.c1 || 'var(--brand)'}"/><stop offset="1" style="stop-color:${o.c2 || 'var(--brand2)'}"/></linearGradient></defs>
    <circle cx="60" cy="60" r="52" fill="none" style="stroke:var(--line);stroke-width:10"/>
    <circle class="pg" cx="60" cy="60" r="52" fill="none" stroke-linecap="round" stroke="url(#${id})" stroke-width="10" stroke-dasharray="${C.toFixed(2)}" stroke-dashoffset="${(C * (1 - Math.min(p, 100) / 100)).toFixed(2)}" style="transition:stroke-dashoffset .7s cubic-bezier(.2,.7,.2,1)"/></svg>
    <div class="ctr"><div class="big">${o.big || ''}</div><div class="cap">${o.cap || ''}</div></div>`;
  if (o.anim !== false) onVisible(el, () => { const c = $('.pg', el); c.animate([{ strokeDashoffset: C }, { strokeDashoffset: C * (1 - Math.min(p, 100) / 100) }], { duration: 1300, easing: 'cubic-bezier(.2,.7,.2,1)' }); });
  return C;
}
function setRing(el, p, big, cap, color) {
  const C = 2 * Math.PI * 52, c = $('.pg', el);
  c.style.strokeDashoffset = (C * (1 - Math.min(p, 100) / 100)).toFixed(2);
  $('.big', el).textContent = big; if (cap != null) $('.cap', el).textContent = cap;
}

/* ===== sparkline ===== */
function spark(el, vals, color) {
  const mn = Math.min(...vals), mx = Math.max(...vals), W = 100, H = 28;
  const pts = vals.map((v, i) => [i / (vals.length - 1) * W, H - 3 - (v - mn) / ((mx - mn) || 1) * (H - 8)]);
  const d = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join('');
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" width="100%" height="28" aria-hidden="true"><path d="${d}L${W} ${H}L0 ${H}Z" style="fill:${color};opacity:.15"/><path d="${d}" fill="none" vector-effect="non-scaling-stroke" style="stroke:${color};stroke-width:1.6"/></svg>`;
}
