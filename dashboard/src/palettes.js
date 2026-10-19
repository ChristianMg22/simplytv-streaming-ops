/* ===== Palette switcher: 7 aesthetics x (dark | light). Each palette is generated from a few HSL anchors and
   written as inline CSS variables on <html>, so every SVG chart, the particles, the map and the skyline follow. ===== */
(function () {
  const PALS = [
    { id: 'simply', name: 'Simply Night', note: 'Default · deep blue + cyan', sw: ['#070b1c', '#2cd5f5', '#8a7dff', '#3987e5'] },
    { id: 'aurora', name: 'Aurora', note: 'Teal + mint', hn: 190, sat: 32, h1: 165, h2: 200 },
    { id: 'sunset', name: 'Sunset', note: 'Coral + magenta', hn: 14, sat: 34, h1: 18, h2: 335 },
    { id: 'violet', name: 'Neon Violet', note: 'Purple + pink', hn: 265, sat: 36, h1: 280, h2: 325 },
    { id: 'ocean', name: 'Deep Ocean', note: 'Navy + aqua', hn: 207, sat: 48, h1: 192, h2: 228 },
    { id: 'forest', name: 'Forest', note: 'Green + gold', hn: 145, sat: 26, h1: 140, h2: 48 },
    { id: 'graphite', name: 'Graphite', note: 'Neutral + amber', hn: 220, sat: 6, h1: 42, h2: 205 },
  ];
  const hsl = (h, s, l) => { h = ((h % 360) + 360) % 360; s /= 100; l /= 100; const a = s * Math.min(l, 1 - l), f = n => { const k = (n + h / 30) % 12, c = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)); return Math.round(255 * c).toString(16).padStart(2, '0'); }; return `#${f(0)}${f(8)}${f(4)}`; };
  const rgba = (hex, a) => `rgba(${[1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16))},${a})`;
  function build(p, dark) {
    const { hn, sat, h1, h2 } = p, v = {};
    if (dark) {
      Object.assign(v, { '--bg': hsl(hn, sat, 7), '--bg2': hsl(hn, sat, 10), '--surface': hsl(hn, sat, 14), '--surface2': hsl(hn, sat, 19), '--line': hsl(hn, sat * .9, 26), '--grid': hsl(hn, sat * .9, 21),
        '--ink': hsl(hn, 45, 95), '--ink2': hsl(hn, 28, 78), '--muted': hsl(hn, 20, 64), '--brand': hsl(h1, 88, 60), '--brand2': hsl(h2, 82, 72), '--on-brand': hsl(hn, 60, 7), '--heat-ink': hsl(hn, 35, 84), '--heat-ink-hi': hsl(hn, 60, 7), '--tip-bg': hsl(hn, sat, 10) });
      for (let k = 0; k < 8; k++) v['--s' + (k + 1)] = hsl(h1 + (k * 135) % 360, 64, 60);
    } else {
      Object.assign(v, { '--bg': hsl(hn, Math.min(sat + 15, 45), 96.5), '--bg2': hsl(hn, Math.min(sat + 15, 45), 93), '--surface': '#ffffff', '--surface2': hsl(hn, Math.min(sat + 15, 45), 95), '--line': hsl(hn, 30, 86), '--grid': hsl(hn, 30, 91),
        '--ink': hsl(hn, 55, 11), '--ink2': hsl(hn, 28, 30), '--muted': hsl(hn, 20, 40), '--brand': hsl(h1, 90, 28), '--brand2': hsl(h2, 72, 44), '--on-brand': '#ffffff', '--heat-ink': hsl(hn, 30, 28), '--heat-ink-hi': '#ffffff', '--tip-bg': '#ffffff' });
      for (let k = 0; k < 8; k++) v['--s' + (k + 1)] = hsl(h1 + (k * 135) % 360, 72, 42);
    }
    v['--heat-lo'] = dark ? v['--surface2'] : v['--surface2']; v['--heat-hi'] = v['--brand'];
    v['--glow1'] = rgba(v['--brand2'], dark ? .22 : .12); v['--glow2'] = rgba(v['--brand'], dark ? .13 : .10);
    return v;
  }
  PALS.slice(1).forEach(p => { p.dv = build(p, true); p.lv = build(p, false); p.sw = [p.dv['--bg'], p.dv['--brand'], p.dv['--brand2'], p.dv['--s3']]; });
  const root = document.documentElement, KEYS = ['--bg', '--bg2', '--surface', '--surface2', '--line', '--grid', '--ink', '--ink2', '--muted', '--brand', '--brand2', '--on-brand', '--heat-ink', '--heat-ink-hi', '--tip-bg', '--s1', '--s2', '--s3', '--s4', '--s5', '--s6', '--s7', '--s8', '--heat-lo', '--heat-hi', '--glow1', '--glow2'];
  let cur = 'simply';
  const btn = document.getElementById('palBtn'), menu = document.getElementById('palMenu');
  function apply(id, save) {
    const p = PALS.find(x => x.id === id) || PALS[0]; cur = p.id;
    KEYS.forEach(k => root.style.removeProperty(k));
    if (p.dv) { const v = (root.dataset.theme || 'dark') === 'dark' ? p.dv : p.lv; for (const k in v) root.style.setProperty(k, v[k]); }
    root.dataset.pal = cur; btn.title = 'Palette: ' + p.name;
    menu.querySelectorAll('button').forEach(b => b.setAttribute('aria-checked', b.dataset.id === cur));
    if (save) try { localStorage.setItem('stv-pal', cur); } catch (e) { }
  }
  menu.innerHTML = '<div class="xg">Color palette</div>' + PALS.map(p => `<button type="button" role="menuitemradio" data-id="${p.id}"><span class="psw">${p.sw.map(c => `<i style="background:${c}"></i>`).join('')}</span><span><b>${p.name}</b><em>${p.note}</em></span></button>`).join('');
  btn.addEventListener('click', e => { e.stopPropagation(); const o = menu.hidden; menu.hidden = !o; btn.setAttribute('aria-expanded', o); });
  menu.addEventListener('click', e => { const b = e.target.closest('button'); if (b) { apply(b.dataset.id, true); menu.hidden = true; btn.setAttribute('aria-expanded', false); } });
  document.addEventListener('click', e => { if (!menu.hidden && !menu.contains(e.target)) { menu.hidden = true; btn.setAttribute('aria-expanded', false); } });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !menu.hidden) { menu.hidden = true; btn.focus(); } });
  new MutationObserver(() => { if (root.dataset.pal === cur) apply(cur); }).observe(root, { attributes: true, attributeFilter: ['data-theme'] });
  let saved = 'simply'; try { saved = localStorage.getItem('stv-pal') || 'simply'; } catch (e) { }
  apply(saved);
})();
