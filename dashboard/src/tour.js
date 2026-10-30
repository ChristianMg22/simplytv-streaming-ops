/* ===== 60-second guided tour: scrolls through the key sections with a caption ===== */
(function () {
  const btn = document.getElementById('tourBtn'); if (!btn) return;
  const STEPS = [['kpis', 'The headline numbers: 5,485 incidents, 24.7% SLA breaches, median fix 19 h.'],
    ['explorador', 'Filter by region, segment and tier: every chart below follows.'],
    ['diagnostico', 'Where the problem is: schema changes break SLA 40% of the time.'],
    ['riesgo', 'A model flags the riskiest 20% of incidents and catches ~40% of breaches.'],
    ['pronostico', 'A weekly forecast beats the naive baseline (MAE 4.5 vs 5.8).'],
    ['anomalias', 'Silent bad deliveries: days that looked fine but were incomplete.'],
    ['lab', 'The Lab: real Python and SQL, the investigator, and how well it works.'],
    ['acciones', 'What I would do next, in priority order.']];
  let i = -1, t = null, box = null;
  function stop() { clearTimeout(t); i = -1; if (box) { box.remove(); box = null; } btn.textContent = 'Tour'; document.documentElement.style.scrollBehavior = ''; }
  function go() {
    if (i >= STEPS.length) return stop();
    const [id, txt] = STEPS[i], el = document.getElementById(id); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    box.innerHTML = `<b>${i + 1}/${STEPS.length}</b> ${txt} <button type="button" id="tourX" aria-label="Stop tour">Stop</button>`;
    box.querySelector('#tourX').onclick = stop; t = setTimeout(() => { i++; go(); }, 7000);
  }
  btn.addEventListener('click', () => {
    if (i >= 0) return stop();
    box = document.createElement('div'); box.className = 'tourbox'; box.setAttribute('role', 'status'); document.body.appendChild(box);
    btn.textContent = 'Stop tour'; i = 0; go();
  });
})();
