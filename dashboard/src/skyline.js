/* ===== Incident skyline (vanilla-canvas port of the "Contribution Skyline" React component) =====
   One scene, two views: a GitHub-style daily heat map that folds into an isometric 3D skyline.
   Each box is a day (columns = weeks, rows = weekdays); one camera swings from top-down to the corner view
   while the bars rise in a wave from the oldest week to the newest. Hover a day for its count, drag to orbit
   (double-click resets), hover a legend swatch to isolate a level. Recalculated from the explorer filters. */
(function () {
  const stage = document.getElementById('skyStage'); if (!stage) return;
  const cv = document.getElementById('skyCv'), ctx = cv.getContext('2d'), tip = document.getElementById('skyTip');
  const tg = document.querySelector('.sky-tg'), stats = document.getElementById('skyStats'), lg = document.getElementById('skyLg'), hint = document.getElementById('skyHint');
  const DAY = 864e5, clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v)), lerp = (a, b, t) => a + (b - a) * t;
  const eio = x => { const t = clamp(x); return t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }, eo = x => 1 - Math.pow(1 - clamp(x), 3);
  const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
  const key = ms => new Date(ms).toISOString().slice(0, 10), ms0 = s => Date.parse(s + 'T00:00:00Z');
  const END = ms0(D.meta.cutoff), D0 = ms0(D.explorer.day0), WAVE = .42;
  const hex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
  const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
  const fmt = (o) => new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', ...o });
  const fd = fmt({ month: 'short', day: 'numeric' }), fdy = fmt({ month: 'short', day: 'numeric', year: 'numeric' }), fm = fmt({ month: 'short' });
  // grid: 53 weeks ending on the cutoff, Sunday first
  let start = END - 364 * DAY; start -= new Date(start).getUTCDay() * DAY;
  const cells = []; for (let m = start, i = 0; m <= END; m += DAY, i++) cells.push({ date: key(m), count: 0, level: 0, week: Math.floor(i / 7), day: i % 7 });
  const n = cells.length, weeks = cells[n - 1].week + 1, off0 = Math.round((start - D0) / DAY);
  const months = []; { let prev = -1; for (let w = 0; w < weeks; w++) { const m = +cells[w * 7].date.slice(5, 7); if (m !== prev) months.push({ week: w, label: fm.format(ms0(cells[w * 7].date)) }); prev = m; } if (months.length > 1 && months[1].week - months[0].week < 3) months.shift(); }
  const wdRows = [1, 3, 5].map(d => ({ day: d, label: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d] }));
  let max = 0, hgt = new Float32Array(n), zs = new Float32Array(n), hov = new Float32Array(n), dim = new Float32Array(n), polys = new Float32Array(n * 24), faces = new Uint8Array(n), order = [...Array(n).keys()];
  const col = new Float32Array(15), goal = new Float32Array(15); let ready = false, dark = true, fg = [234, 240, 255], bg = [7, 11, 28], accent = '#3987e5';
  let W = 0, H2 = 0, H3 = 0, Hm = 0, dpr = 1, gutter = 30, t = 0, target = 0, entered = false, yaw = 0, elev = 0, yG = 0, eG = 0, raf = 0, last = 0, active = -1, legend = -1, hovered = -1, pinned = -1, tipW = 0, drag = null;
  const rgb = c => `rgb(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])})`;
  const camera = (e, dy = 0, de = 0) => { const y = clamp(lerp(0, Math.PI / 4 + dy, e), 0, 82 * Math.PI / 180), el = lerp(Math.PI / 2, clamp(34 * Math.PI / 180 + de, 18 * Math.PI / 180, 62 * Math.PI / 180), e); return { cs: Math.cos(y), sn: Math.sin(y), se: Math.sin(el), ce: Math.cos(el) }; };
  const barH = c => c > 0 && max > 0 ? .4 + Math.pow(c / max, .85) * 7.2 : .2;
  const rise = (tt, w, d) => eo((tt - ((weeks > 1 ? w / (weeks - 1) : 0) * .36 + d / 6 * .06)) / (1 - WAVE));

  function setRows(rs) {
    const cnt = new Map(); rs.forEach(r => { const k = r[7] - off0; if (k >= 0 && k < n) cnt.set(k, (cnt.get(k) || 0) + 1); });
    cells.forEach((c, i) => c.count = cnt.get(i) || 0);
    const nz = cells.map(c => c.count).filter(c => c > 0).sort((a, b) => a - b), busy = nz.length ? nz[Math.floor(.95 * (nz.length - 1))] : 0;
    max = nz.length ? nz[nz.length - 1] : 0;
    cells.forEach((c, i) => { c.level = c.count <= 0 ? 0 : busy <= 0 ? 4 : 1 + Math.min(3, Math.floor(c.count / busy * 4)); hgt[i] = barH(c.count); });
    renderStats(); const sum = cells.reduce((a, c) => a + c.count, 0);
    document.getElementById('skyT').innerHTML = `<b>${nf(sum)}</b> incidents opened in the last 12 months`;
    layout(); kick();
  }
  function renderStats() {
    let tot = 0, best = 0, bd = null, run = 0, rs = null, lon = { d: 0 };
    cells.forEach(c => { tot += c.count; if (c.count > best) { best = c.count; bd = c.date; } if (c.count) { if (!run) rs = c.date; run++; if (run > lon.d) lon = { d: run, s: rs, e: c.date }; } else run = 0; });
    let j = n - 1; if (cells[j].count === 0) j--; const e = j; while (j >= 0 && cells[j].count > 0) j--;
    const cur = e - j, rg = (a, b) => a ? `${fd.format(ms0(a))} — ${fd.format(ms0(b))}` : '—';
    const B = [['Total, last 12 months', nf(tot), 'incidents', `${fdy.format(ms0(cells[0].date))} — ${fdy.format(ms0(cells[n - 1].date))}`], ['Busiest day', nf(best), 'incidents', bd ? fd.format(ms0(bd)) : '—'], ['Longest streak', nf(lon.d), 'days with incidents', rg(lon.s, lon.e)], ['Current streak', nf(cur), 'days', cur ? rg(cells[j + 1].date, cells[e].date) : '—']];
    stats.innerHTML = B.map(b => `<div><span>${b[0]}</span><b>${b[1]} <small style="font-size:13px;font-weight:400;color:var(--ink2)">${b[2]}</small></b><span>${b[3]}</span></div>`).join('');
  }
  function retheme() {
    const cs = getComputedStyle(document.documentElement), v = k => cs.getPropertyValue(k).trim();
    dark = (document.documentElement.dataset.theme || 'dark') === 'dark';
    fg = hex(v('--ink')); bg = hex(v('--surface')); const br = hex(v('--brand')), pal = (dark ? [.3, .52, .76, 1] : [.28, .5, .75, 1]).map(a => mix(bg, br, a)), all = [mix(bg, fg, dark ? .11 : .075), ...pal];
    all.forEach((c, k) => c.forEach((x, ch) => goal[k * 3 + ch] = x)); if (!ready) { col.set(goal); ready = true; }
    accent = rgb(pal[3]); stats.style.setProperty('--sky-accent', accent);
    lg.innerHTML = '<span>Less</span>' + all.map((c, i) => `<button type="button" data-l="${i}" aria-label="Highlight level ${i}" style="background:${rgb(c)}"></button>`).join('') + '<span>More</span>';
    ctx.font = '400 10px ' + (cs.fontFamily || 'sans-serif'); kick();
  }
  function ext(cam, e, full) {
    const w = lerp(.78, .9, e), of = (1 - w) / 2; let a = 1e9, b = -1e9, c = 1e9, d = -1e9;
    const add = (x, y, z) => { const px = x * cam.cs - y * cam.sn, py = (x * cam.sn + y * cam.cs) * cam.se - z * cam.ce; a = Math.min(a, px); b = Math.max(b, px); c = Math.min(c, py); d = Math.max(d, py); };
    for (let i = 0; i < n; i++) { const x0 = cells[i].week + of, y0 = cells[i].day + of, z = full ? hgt[i] * e : zs[i]; add(x0, y0, z); add(x0 + w, y0, z); add(x0, y0 + w, z); add(x0 + w, y0 + w, 0); add(x0, y0 + w, 0); add(x0 + w, y0, 0); }
    add(0, 7 + 1.5 * e, 0); add(weeks, 7 + 1.5 * e, 0); return { a, b, c, d };
  }
  function layout() {
    const w = Math.round(stage.clientWidth); if (!w) return; W = w; gutter = W < 520 ? 0 : 38; dpr = Math.min(2, devicePixelRatio || 1);
    const b2 = ext(camera(0), 0, true); H2 = 24 + (b2.d - b2.c) / (b2.b - b2.a) * (W - gutter - 4);
    const b3 = ext(camera(1), 1, true), nat = (b3.d - b3.c) / (b3.b - b3.a) * (W - 40) + 40; H3 = Math.max(Math.min(nat, W * .72, 620), Math.min(nat, 240));
    Hm = Math.ceil(Math.max(H2, H3)); cv.width = Math.round(W * dpr); cv.height = Math.round(Hm * dpr); cv.style.width = W + 'px'; cv.style.height = Hm + 'px'; stage.style.height = lerp(H2, H3, eio(t)) + 'px'; draw();
  }
  const quad = (p, o, r) => { if (r < .3) { ctx.moveTo(p[o], p[o + 1]); ctx.lineTo(p[o + 2], p[o + 3]); ctx.lineTo(p[o + 4], p[o + 5]); ctx.lineTo(p[o + 6], p[o + 7]); ctx.closePath(); return; } ctx.moveTo((p[o + 6] + p[o]) / 2, (p[o + 7] + p[o + 1]) / 2); for (let k = 0; k < 4; k++) { const b = (k + 1) % 4; ctx.arcTo(p[o + k * 2], p[o + k * 2 + 1], p[o + b * 2], p[o + b * 2 + 1], r); } ctx.closePath(); };
  const inQ = (p, o, x, y) => { let sg = 0; for (let k = 0; k < 4; k++) { const ax = p[o + k * 2], ay = p[o + k * 2 + 1], bx = p[o + (k + 1) % 4 * 2], by = p[o + (k + 1) % 4 * 2 + 1], cr = (bx - ax) * (y - ay) - (by - ay) * (x - ax); if (Math.abs(cr) < 1e-9) continue; const s = cr > 0 ? 1 : -1; if (!sg) sg = s; else if (s !== sg) return false; } return sg !== 0; };
  function draw() {
    if (!W) return; const e = eio(t), cam = camera(e, yaw, elev), Hc = lerp(H2, H3, e); stage.style.height = Hc.toFixed(1) + 'px';
    for (let i = 0; i < n; i++) zs[i] = rise(t, cells[i].week, cells[i].day) * hgt[i];
    const b = ext(cam, e, false), pad = lerp(2, 20, e), left = pad + gutter * (1 - e), top = pad + 20 * (1 - e), aw = W - left - pad, ah = Hc - top - pad, s = Math.min(aw / Math.max(1e-6, b.b - b.a), ah / Math.max(1e-6, b.d - b.c));
    const ox = left + (aw - (b.b - b.a) * s) / 2 - b.a * s, oy = top + (ah - (b.d - b.c) * s) / 2 - b.c * s, { cs, sn, se, ce } = cam;
    const px = (x, y) => ox + (x * cs - y * sn) * s, py = (x, y, z) => oy + ((x * sn + y * cs) * se - z * ce) * s;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, Hm);
    order.sort((a, c) => (cells[a].week + .5) * sn + (cells[a].day + .5) * cs - ((cells[c].week + .5) * sn + (cells[c].day + .5) * cs));
    const w = lerp(.78, .9, e), of = (1 - w) / 2, rad = lerp(.17, .03, e) * s, out = (1 - e) * .07, lift = .7 * e;
    for (let k = 0; k < n; k++) {
      const i = order[k], c = cells[i], x0 = c.week + of, y0 = c.day + of, x1 = x0 + w, y1 = y0 + w, z = zs[i] + hov[i] * lift, o = i * 24;
      polys.set([px(x0, y0), py(x0, y0, z), px(x1, y0), py(x1, y0, z), px(x1, y1), py(x1, y1, z), px(x0, y1), py(x0, y1, z), px(x0, y1), py(x0, y1, 0), px(x1, y1), py(x1, y1, 0), px(x1, y1), py(x1, y1, z), px(x0, y1), py(x0, y1, z), px(x1, y0), py(x1, y0, 0), px(x1, y1), py(x1, y1, 0), px(x1, y1), py(x1, y1, z), px(x1, y0), py(x1, y0, z)], o);
      const tall = z * ce * s; let f = 0; if (tall > .35 && w * cs * s > .35) f |= 1; if (tall > .35 && w * sn * s > .35) f |= 2; faces[i] = f;
      const L = c.level * 3; let r = col[L], g = col[L + 1], bl = col[L + 2]; const d = dim[i];
      if (d > .002) { r += (col[0] - r) * .72 * d; g += (col[1] - g) * .72 * d; bl += (col[2] - bl) * .72 * d; }
      const hv = hov[i]; if (hv > .002) { const m = .16 * hv; r += (fg[0] - r) * m; g += (fg[1] - g) * m; bl += (fg[2] - bl) * m; }
      if (f & 1) { ctx.beginPath(); quad(polys, o + 8, 0); ctx.fillStyle = rgb([r * .84, g * .84, bl * .84]); ctx.fill(); }
      if (f & 2) { ctx.beginPath(); quad(polys, o + 16, 0); ctx.fillStyle = rgb([r * .68, g * .68, bl * .68]); ctx.fill(); }
      ctx.beginPath(); quad(polys, o, rad); ctx.fillStyle = rgb([r, g, bl]); ctx.fill();
      if (out > .004) { ctx.strokeStyle = `rgba(${fg},${out.toFixed(3)})`; ctx.lineWidth = 1; ctx.stroke(); }
      if (hv > .02) { ctx.strokeStyle = `rgba(${fg},${(.85 * hv).toFixed(3)})`; ctx.lineWidth = 1.5; ctx.stroke(); }
    }
    const mu = mix(bg, fg, .55).map(Math.round), a2 = 1 - smooth(0, .4, e), a3 = smooth(.62, 1, e); ctx.font = '400 10px ' + getComputedStyle(document.body).fontFamily;
    if (a2 > .004) { ctx.fillStyle = `rgba(${mu},${a2.toFixed(3)})`; ctx.textAlign = 'left'; ctx.textBaseline = 'bottom'; let ed = -1e9; months.forEach(m => { const x = px(m.week + of, -.3), tw = ctx.measureText(m.label).width; if (x < ed || x + tw > W) return; ctx.fillText(m.label, x, py(m.week + of, -.3, 0) - 3); ed = x + tw + 6; }); ctx.textAlign = 'right'; ctx.textBaseline = 'middle'; if (gutter) wdRows.forEach(r => ctx.fillText(r.label, px(0, r.day + .5) - 6, py(0, r.day + .5, 0))); }
    if (a3 > .004) { ctx.fillStyle = `rgba(${mu},${a3.toFixed(3)})`; ctx.textAlign = 'left'; ctx.textBaseline = 'top'; let ed = -1e9; months.forEach(m => { const x = px(m.week + .5, 7.3), tw = ctx.measureText(m.label).width; if (x < ed || x + tw > W) return; ctx.fillText(m.label, x, py(m.week + .5, 7.3, 0) + 2); ed = x + tw + 10; }); }
    if (active >= 0) { const i = active, c = cells[i], z = zs[i] + hov[i] * lift, tx = px(c.week + .5, c.day + .5), ty = Math.min(py(c.week + of, c.day + of, z), py(c.week + of + w, c.day + of, z), py(c.week + of, c.day + of + w, z)), half = tipW / 2, cx = Math.min(W - half - 2, Math.max(half + 2, tx)); tip.style.transform = `translate(${(cx - half).toFixed(1)}px,${(ty - 8).toFixed(1)}px) translateY(-100%)`; }
  }
  function tick(now) {
    raf = 0; const dt = Math.min(.05, Math.max(0, (now - last) / 1000)); last = now; let mv = false;
    if (t !== target) { const st = reduce ? 1 : dt * 1000 / 1300; t = target > t ? Math.min(target, t + st) : Math.max(target, t - st); mv = true; }
    const ko = reduce ? 1 : 1 - Math.exp(-dt * 12); yaw += (yG - yaw) * ko; elev += (eG - elev) * ko; if (Math.abs(yG - yaw) > 1e-4 || Math.abs(eG - elev) > 1e-4) mv = true; else { yaw = yG; elev = eG; }
    const kc = reduce ? 1 : 1 - Math.exp(-dt * 7); for (let k = 0; k < 15; k++) { const d = goal[k] - col[k]; if (Math.abs(d) > .4) { col[k] += d * kc; mv = true; } else col[k] = goal[k]; }
    const kh = reduce ? 1 : 1 - Math.exp(-dt * 16), kd = reduce ? 1 : 1 - Math.exp(-dt * 10);
    for (let i = 0; i < n; i++) { const hg = i === active ? 1 : 0, dg = legend >= 0 && cells[i].level !== legend ? 1 : 0; if (hov[i] !== hg) { hov[i] = Math.abs(hg - hov[i]) < .003 ? hg : hov[i] + (hg - hov[i]) * kh; mv = true; } if (dim[i] !== dg) { dim[i] = Math.abs(dg - dim[i]) < .003 ? dg : dim[i] + (dg - dim[i]) * kd; mv = true; } }
    draw(); if (mv) raf = requestAnimationFrame(tick);
  }
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  function kick() { if (entered) { const g = tg.classList.contains('is3') ? 1 : 0; if (g !== target) { target = g; if (!g) yG = eG = 0; } } if (raf) return; last = performance.now(); raf = requestAnimationFrame(tick); }
  function setActive() { const nx = hovered >= 0 ? hovered : pinned; if (nx === active) return; active = nx; if (nx >= 0) { const c = cells[nx]; tip.innerHTML = `<b>${c.count ? nf(c.count) + (c.count === 1 ? ' incident' : ' incidents') : 'No incidents'}</b> <span style="opacity:.75">on ${fdy.format(ms0(c.date))}</span>`; tipW = tip.offsetWidth; } tip.style.opacity = nx >= 0 ? 1 : 0; kick(); }
  const hit = (x, y) => { for (let k = n - 1; k >= 0; k--) { const i = order[k], o = i * 24; if (inQ(polys, o, x, y) || (faces[i] & 1 && inQ(polys, o + 8, x, y)) || (faces[i] & 2 && inQ(polys, o + 16, x, y))) return i; } return -1; };
  const loc = ev => { const r = cv.getBoundingClientRect(); return [ev.clientX - r.left, ev.clientY - r.top]; };
  const is3 = () => tg.classList.contains('is3');
  function setHint() { hint.textContent = is3() ? 'Drag to orbit · double-click to reset' : 'Hover a day for details'; }
  cv.addEventListener('pointerdown', ev => { if (ev.button) return; const can = is3(); drag = { id: ev.pointerId, x: ev.clientX, y: ev.clientY, yw: yG, el: eG, mv: false, can, mouse: ev.pointerType === 'mouse' }; if (can) try { cv.setPointerCapture(ev.pointerId); } catch (e) {} });
  cv.addEventListener('pointermove', ev => {
    if (drag && drag.can && ev.pointerId === drag.id) { const dx = ev.clientX - drag.x, dy = ev.clientY - drag.y; if (drag.mv || Math.hypot(dx, dy) > 4) { drag.mv = true; const Y = Math.PI / 4; yG = clamp(drag.yw + dx * .006, 8 * Math.PI / 180 - Y, 82 * Math.PI / 180 - Y); if (drag.mouse) eG = clamp(drag.el + dy * .004, 18 * Math.PI / 180 - 34 * Math.PI / 180, 62 * Math.PI / 180 - 34 * Math.PI / 180); cv.style.cursor = 'grabbing'; hovered = -1; setActive(); kick(); return; } }
    if (ev.pointerType !== 'mouse') return; const [x, y] = loc(ev), i = hit(x, y); if (i !== hovered) { hovered = i; setActive(); } cv.style.cursor = is3() ? 'grab' : i >= 0 ? 'pointer' : 'default';
  });
  cv.addEventListener('pointerup', ev => { if (!drag || ev.pointerId !== drag.id) return; const mv = drag.mv; drag = null; if (cv.hasPointerCapture(ev.pointerId)) cv.releasePointerCapture(ev.pointerId); cv.style.cursor = is3() ? 'grab' : 'default'; if (mv) return; const [x, y] = loc(ev), i = hit(x, y); pinned = i === pinned ? -1 : i; if (ev.pointerType !== 'mouse') hovered = -1; setActive(); });
  cv.addEventListener('pointerleave', () => { if (drag) return; hovered = -1; setActive(); });
  cv.addEventListener('dblclick', () => { yG = eG = 0; kick(); });
  cv.addEventListener('keydown', ev => { const ks = { ArrowLeft: -7, ArrowRight: 7, ArrowUp: -1, ArrowDown: 1 }; if (ev.key in ks) { ev.preventDefault(); pinned = clamp((pinned >= 0 ? pinned : n - 1) + ks[ev.key], 0, n - 1); hovered = -1; setActive(); } else if (ev.key === 'Escape') { pinned = hovered = -1; setActive(); } });
  tg.addEventListener('click', ev => { const b = ev.target.closest('button'); if (!b) return; tg.classList.toggle('is3', b.dataset.v === '3d'); tg.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); setHint(); kick(); });
  lg.addEventListener('mouseover', ev => { const b = ev.target.closest('button'); if (b) { legend = +b.dataset.l; kick(); } });
  lg.addEventListener('mouseleave', () => { legend = -1; kick(); });
  lg.addEventListener('click', ev => { const b = ev.target.closest('button'); if (b) { legend = legend === +b.dataset.l ? -1 : +b.dataset.l; kick(); } });
  new ResizeObserver(() => { if (Math.round(stage.clientWidth) !== W) layout(); }).observe(stage);
  new MutationObserver(retheme).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'style'] });
  // 3D rises out of the flat view the first time it scrolls into sight
  tg.classList.add('is3'); tg.querySelector('[data-v="3d"]').classList.add('on'); setHint();
  // ... and folds back flat when it leaves the screen, so it rises again every time you scroll back to it
  const enter = () => { if (entered) return; entered = true; if (reduce) t = 1; kick(); };
  const leave = () => { entered = false; t = 0; target = 0; yG = eG = yaw = elev = 0; kick(); };
  if ('IntersectionObserver' in window) new IntersectionObserver(es => es.forEach(e => { if (e.intersectionRatio >= .35) enter(); else if (e.intersectionRatio === 0 && entered) leave(); }), { threshold: [0, .35] }).observe(stage); else enter();
  retheme(); window.STV_SKY = { set: setRows };
})();
