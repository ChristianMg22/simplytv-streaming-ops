/* ===== Page background: drifting light beams (vanilla-canvas port of the "Beams Background" React component) =====
   A fixed canvas behind the whole page. Dashboard adaptations: colors come from the active palette (brand -> brand2),
   dark theme blends additively and light theme stays soft, it renders at half resolution and relies on CSS blur
   (cheap), it pauses when the tab is hidden, and with prefers-reduced-motion it draws a single frame. */
(function () {
  const cv = document.createElement('canvas'); cv.className = 'beams'; cv.setAttribute('aria-hidden', 'true'); document.body.prepend(cv);
  const ctx = cv.getContext('2d'); if (!ctx) return;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)'), N = 28, SCALE = .5;
  let W = 0, H = 0, beams = [], raf = 0, hues = [190, 260], dark = true;
  const hueOf = h => { const r = [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255), mx = Math.max(...r), mn = Math.min(...r), d = mx - mn; if (!d) return 220; const [R, G, B] = r; let x = mx === R ? ((G - B) / d) % 6 : mx === G ? (B - R) / d + 2 : (R - G) / d + 4; return (x * 60 + 360) % 360; };
  function theme() { const cs = getComputedStyle(document.documentElement); hues = [hueOf(cs.getPropertyValue('--brand').trim()), hueOf(cs.getPropertyValue('--brand2').trim())]; dark = (document.documentElement.dataset.theme || 'dark') === 'dark'; }
  const hueAt = t => { let d = ((hues[1] - hues[0] + 540) % 360) - 180; return (hues[0] + d * t + 360) % 360; };
  function make(i, init) {
    return { x: Math.random() * W * 1.4 - W * .2, y: init ? Math.random() * H * 1.5 - H * .25 : H + 100, w: (60 + Math.random() * 110) * SCALE, len: H * 2.5, a: -35 + Math.random() * 10,
      v: (.35 + Math.random() * .6) * SCALE, o: .16 + Math.random() * .14, t: i / N, p: Math.random() * 6.28, ps: .015 + Math.random() * .025 };
  }
  function resize() {
    W = Math.max(1, Math.round(innerWidth * SCALE)); H = Math.max(1, Math.round(innerHeight * SCALE)); cv.width = W; cv.height = H;
    beams = Array.from({ length: N }, (_, i) => make(i, true));
  }
  function draw(step) {
    ctx.clearRect(0, 0, W, H); ctx.globalCompositeOperation = dark ? 'lighter' : 'source-over';
    const k = dark ? 1 : .55, L = dark ? 62 : 58;
    beams.forEach((b, i) => {
      if (step) { b.y -= b.v; b.p += b.ps; if (b.y + b.len < -100) Object.assign(b, make(i, false), { x: (i % 3) * W / 3 + W / 6 + (Math.random() - .5) * W / 6 }); }
      const o = b.o * (.8 + Math.sin(b.p) * .2) * k, h = hueAt(b.t);
      ctx.save(); ctx.translate(b.x, b.y); ctx.rotate(b.a * Math.PI / 180);
      const g = ctx.createLinearGradient(0, 0, 0, b.len), c = a => `hsla(${h.toFixed(0)},85%,${L}%,${a})`;
      g.addColorStop(0, c(0)); g.addColorStop(.1, c(o * .5)); g.addColorStop(.4, c(o)); g.addColorStop(.6, c(o)); g.addColorStop(.9, c(o * .5)); g.addColorStop(1, c(0));
      ctx.fillStyle = g; ctx.fillRect(-b.w / 2, 0, b.w, b.len); ctx.restore();
    });
  }
  function loop() { draw(true); raf = requestAnimationFrame(loop); }
  function sync() { cancelAnimationFrame(raf); raf = 0; if (reduce.matches) { draw(false); return; } if (!document.hidden) loop(); }
  addEventListener('resize', () => { resize(); if (reduce.matches) draw(false); });
  document.addEventListener('visibilitychange', sync);
  reduce.addEventListener && reduce.addEventListener('change', sync);
  new MutationObserver(() => { theme(); if (reduce.matches) draw(false); }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'style'] });
  theme(); resize(); sync();
})();
