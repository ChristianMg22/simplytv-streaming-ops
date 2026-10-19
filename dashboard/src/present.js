/* ===== Presentation mode: one section per screen, keyboard and navigation bar ===== */
(function () {
  const main = $('main.wrap'), btn = $('#presentBtn'), bar = $('#pbar'), dots = $('#pDots');
  const kids = [...main.children];
  const slides = [kids.filter(e => e.matches('.hero, .kpis'))];
  kids.filter(e => e.matches('.sec')).forEach(e => slides.push([e]));
  const foot = kids.find(e => e.matches('footer')); if (foot) slides[slides.length - 1].push(foot);
  const titles = slides.map((g, i) => i === 0 ? 'Summary' : ($('h2', g[0]) || {}).textContent || 'Section ' + i);
  dots.innerHTML = slides.map((_, i) => `<button type="button" data-i="${i}" aria-label="${esc(titles[i])}" data-tip="${esc(titles[i])}"></button>`).join('');
  let cur = 0, on = false;
  function show(i, animate = true) {
    cur = Math.max(0, Math.min(slides.length - 1, i));
    kids.forEach(e => e.classList.remove('slide-on'));
    slides[cur].forEach(e => e.classList.add('slide-on'));
    $$('button', dots).forEach((b, j) => { b.classList.toggle('on', j === cur); b.setAttribute('aria-current', j === cur ? 'step' : 'false'); });
    $('#pPrev').disabled = cur === 0; $('#pNext').disabled = cur === slides.length - 1;
    scrollTo(0, 0);
    if (animate && !RM) slides[cur].forEach(e => e.animate([{ opacity: 0, transform: 'translateY(16px)' }, { opacity: 1, transform: 'none' }], { duration: 450, easing: 'cubic-bezier(.2,.7,.2,1)' }));
  }
  function enter() {
    on = true; document.body.classList.add('present'); bar.hidden = false; btn.textContent = 'Exit';
    show(Math.max(0, slides.findIndex(g => g.some(e => e.getBoundingClientRect().bottom > 80))));
    if (document.documentElement.requestFullscreen) document.documentElement.requestFullscreen().catch(() => { });
  }
  function exit(fromFs) {
    if (!on) return; on = false; document.body.classList.remove('present'); bar.hidden = true; btn.textContent = 'Present';
    kids.forEach(e => e.classList.remove('slide-on'));
    if (!fromFs && document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(() => { });
    const t = slides[cur][0]; if (t) t.scrollIntoView();
  }
  btn.addEventListener('click', () => on ? exit() : enter());
  $('#pExit').addEventListener('click', () => exit());
  $('#pPrev').addEventListener('click', () => show(cur - 1));
  $('#pNext').addEventListener('click', () => show(cur + 1));
  dots.addEventListener('click', e => { const b = e.target.closest('button'); if (b) show(Number(b.dataset.i)); });
  document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement) exit(true); });
  document.addEventListener('keydown', e => {
    if (!on || /INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) return;
    if (['ArrowRight', 'PageDown', ' '].includes(e.key)) { e.preventDefault(); show(cur + 1); }
    else if (['ArrowLeft', 'PageUp'].includes(e.key)) { e.preventDefault(); show(cur - 1); }
    else if (e.key === 'Home') show(0); else if (e.key === 'End') show(slides.length - 1);
    else if (e.key === 'Escape') exit();
  });
})();
