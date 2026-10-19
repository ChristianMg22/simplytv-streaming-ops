/* ===== Hero particle background (native canvas port of the "ASMR Static Background" component) =====
   Magnetic vortex around the cursor, friction glow and trails. Dashboard adaptations:
   - Canvas is limited to the hero (not the whole window) and transparent: trails fade via destination-out.
   - Colors follow the theme (light/dark) and the dashboard brand palette.
   - Particle count scales with area (cap 700); paused off-screen and when the tab is hidden.
   - With prefers-reduced-motion a single static frame is drawn. */
(function () {
  const hero = document.querySelector('.hero');
  if (!hero) return;
  const canvas = document.createElement('canvas');
  canvas.className = 'hero-particles';
  canvas.setAttribute('aria-hidden', 'true');
  hero.prepend(canvas);
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const MAGNETIC_RADIUS = 220, VORTEX_STRENGTH = 0.07, PULL_STRENGTH = 0.12, MAX_PARTICLES = 700;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');
  const mouse = { x: -9999, y: -9999 };
  let w = 0, h = 0, dpr = 1, particles = [], raf = 0, visible = true, palette;

  const isDark = () => (document.documentElement.dataset.theme || 'dark') === 'dark';
  const setPalette = () => { const cs = getComputedStyle(document.documentElement), c = k => { const h = cs.getPropertyValue(k).trim(); return [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16)).join(','); }; palette = { dust: c('--muted'), glass: c('--brand'), glow: c('--brand2') }; };

  function Particle() { this.reset(); }
  Particle.prototype.reset = function () {
    this.x = Math.random() * w; this.y = Math.random() * h;
    this.size = Math.random() * 1.5 + 0.5;
    this.vx = (Math.random() - 0.5) * 0.2; this.vy = (Math.random() - 0.5) * 0.2;
    this.glass = Math.random() > 0.7;
    this.alpha = Math.random() * 0.35 + 0.1;
    this.rot = Math.random() * Math.PI * 2; this.rotSpeed = (Math.random() - 0.5) * 0.05;
    this.glow = 0;
  };
  Particle.prototype.update = function () {
    const dx = mouse.x - this.x, dy = mouse.y - this.y, dist = Math.hypot(dx, dy) || 1;
    if (dist < MAGNETIC_RADIUS) {
      const f = (MAGNETIC_RADIUS - dist) / MAGNETIC_RADIUS;
      this.vx += (dx / dist) * f * PULL_STRENGTH + (dy / dist) * f * VORTEX_STRENGTH * 10;
      this.vy += (dy / dist) * f * PULL_STRENGTH - (dx / dist) * f * VORTEX_STRENGTH * 10;
      this.glow = f * 0.7;
    } else this.glow *= 0.92;
    this.x += this.vx; this.y += this.vy;
    this.vx *= 0.95; this.vy *= 0.95;
    this.vx += (Math.random() - 0.5) * 0.04; this.vy += (Math.random() - 0.5) * 0.04;
    this.rot += this.rotSpeed + (Math.abs(this.vx) + Math.abs(this.vy)) * 0.05;
    if (this.x < -20) this.x = w + 20; else if (this.x > w + 20) this.x = -20;
    if (this.y < -20) this.y = h + 20; else if (this.y > h + 20) this.y = -20;
  };
  Particle.prototype.draw = function () {
    ctx.save(); ctx.translate(this.x, this.y); ctx.rotate(this.rot);
    const a = Math.min(this.alpha + this.glow, 0.9);
    ctx.fillStyle = `rgba(${this.glass ? palette.glass : palette.dust},${a})`;
    if (this.glow > 0.3) { ctx.shadowBlur = 8 * this.glow; ctx.shadowColor = `rgba(${palette.glow},${this.glow})`; }
    const s = this.size;
    ctx.beginPath(); ctx.moveTo(0, -s * 2.5); ctx.lineTo(s, 0); ctx.lineTo(0, s * 2.5); ctx.lineTo(-s, 0); ctx.closePath(); ctx.fill();
    ctx.restore();
  };

  function resize() {
    const r = hero.getBoundingClientRect();
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    w = Math.max(1, Math.round(r.width)); h = Math.max(1, Math.round(r.height));
    canvas.width = w * dpr; canvas.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const n = Math.min(MAX_PARTICLES, Math.round(w * h / 1800));
    particles = Array.from({ length: n }, () => new Particle());
    if (reduce.matches) frame(true);
  }

  function frame(still) {
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillStyle = still ? 'rgba(0,0,0,1)' : 'rgba(0,0,0,0.18)';
    ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = 'source-over';
    for (const p of particles) { if (!still) p.update(); p.draw(); }
  }

  function loop() { frame(false); raf = requestAnimationFrame(loop); }
  function sync() {
    cancelAnimationFrame(raf); raf = 0;
    if (reduce.matches) { frame(true); return; }
    if (visible && !document.hidden) loop();
  }

  const setMouse = (x, y) => { const r = canvas.getBoundingClientRect(); mouse.x = x - r.left; mouse.y = y - r.top; };
  window.addEventListener('mousemove', e => setMouse(e.clientX, e.clientY), { passive: true });
  window.addEventListener('touchmove', e => { if (e.touches[0]) setMouse(e.touches[0].clientX, e.touches[0].clientY); }, { passive: true });
  document.addEventListener('mouseleave', () => { mouse.x = mouse.y = -9999; });
  document.addEventListener('visibilitychange', sync);
  reduce.addEventListener && reduce.addEventListener('change', sync);
  new IntersectionObserver(es => { visible = es[0].isIntersecting; sync(); }).observe(hero);
  new ResizeObserver(resize).observe(hero);
  new MutationObserver(() => { setPalette(); if (reduce.matches) frame(true); }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'style'] });

  setPalette(); resize(); sync();
})();
