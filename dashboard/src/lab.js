/* ===== Investigation lab: real Python + SQL from the repo, rendered with a tiny syntax highlighter ===== */
(function () {
  const L = D.lab, pane = document.getElementById('labPane'), tabs = document.getElementById('labTabs'); if (!pane) return;
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const SQLK = 'SELECT|FROM|WHERE|GROUP BY|ORDER BY|JOIN|LEFT JOIN|ON|AS|WITH|UNION ALL|CASE|WHEN|THEN|ELSE|END|AND|OR|NOT|IN|EXISTS|NULL|IS|OVER|PARTITION BY|DISTINCT|LIMIT|DESC|ASC|HAVING|BETWEEN|COUNT|SUM|AVG|ROUND|LAG|NTILE|MAX|MIN|COALESCE|CAST|DATE|JULIANDAY|STRFTIME';
  const PYK = 'def|return|if|elif|else|for|in|not|and|or|import|from|as|with|None|True|False|try|except|raise|lambda|while|continue|break|class|yield';
  function hi(code, lang) {
    const kw = lang === 'sql' ? SQLK : PYK, flags = lang === 'sql' ? 'gi' : 'g';
    const re = new RegExp(`(--[^\\n]*|#[^\\n]*)|("""[\\s\\S]*?"""|'[^'\\n]*'|"[^"\\n]*")|\\b(\\d+(?:\\.\\d+)?)\\b|\\b(${kw})\\b|([A-Za-z_]\\w*)(?=\\()`, flags);
    let out = '', last = 0, m; code = String(code);
    while ((m = re.exec(code))) {
      out += esc(code.slice(last, m.index)); last = re.lastIndex;
      const cls = m[1] != null ? (lang === 'sql' || m[1][0] === '#' ? 'c' : null) : m[2] != null ? 's' : m[3] != null ? 'n' : m[4] != null ? 'k' : 'f';
      out += cls ? `<span class="tk-${cls}">${esc(m[0])}</span>` : esc(m[0]);
    }
    return out + esc(code.slice(last));
  }
  const block = (code, lang, file) => `<div class="code"><div class="code-h"><span>${file}</span><button type="button" class="copy" data-code="${encodeURIComponent(code)}">Copy</button></div><pre><code>${hi(code, lang)}</code></pre></div>`;
  const table = rows => { if (!rows || !rows.length) return ''; const ks = Object.keys(rows[0]).slice(0, 7);
    return `<div class="rt"><table><thead><tr>${ks.map(k => `<th>${esc(k)}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${ks.map(k => `<td>${r[k] == null ? '—' : esc(typeof r[k] === 'number' ? nf(r[k], Number.isInteger(r[k]) ? 0 : 1) : String(r[k]).slice(0, 48))}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`; };
  const cmd = c => `<div class="runcmd"><span>Run it yourself</span><code>$ ${esc(c)}</code></div>`;
  const COV = [
    ['Use Python to investigate, validate and troubleshoot data', 'src/07_investigate.py: parses the raw log, builds a baseline, detects symptoms', 'py'],
    ['Identify root causes from data, logs and workflows', 'Case file: symptoms → ranked hypotheses, each with its evidence', 'case'],
    ['Work with SQL, databases, JSON/XML, logs, feeds', 'Star schema + 18 SQL queries; ETL reads gz logs, JSONL tickets, XML milestones, CSV', 'sql'],
    ['Escalate with a clear diagnosis and supporting information', 'A ready-to-send escalation ticket generated from the evidence', 'case'],
    ['Communicate with clients and non-technical people', 'A plain-language client message written for each case', 'case'],
    ['Use AI tools and effective prompting', 'TF-IDF triage in EN/ES/PT + prompt playbook in docs/prompt_playbook.md', null],
    ['Meet SLA deadlines, manage priorities', 'SLA-breach risk model, 13-week forecast, anomaly detection (sections above)', null],
    ['Data accuracy and attention to detail', 'One SLA definition (v_incident), data-quality log, unit tests, a measured validation', 'val'],
    ['Document findings and recurring problems', 'Case files as .md, README, playbook, recurrence query', 'sql']];
  document.getElementById('labCov').innerHTML = COV.map(c => `<div class="cv"><b>${c[0]}</b><span>${c[1]}</span>${c[2] ? `<button type="button" class="link" data-go="${c[2]}">See it →</button>` : ''}</div>`).join('');
  function caseView(i) {
    const c = L.cases[i]; if (!c) return '<p class="sub">Run <code>python src/07_investigate.py --top 4</code> to generate case files.</p>';
    const top = c.ranked[0];
    return `<div class="seg" id="caseSel" style="margin-bottom:12px">${L.cases.map((x, k) => `<button type="button" data-i="${k}" aria-pressed="${k === i}">${x.feed}</button>`).join('')}</div>
    <div class="steps">
      <div class="st"><i>1</i><b>Symptoms</b><ul>${c.symptoms.map(s => `<li>${esc(s.evidence)}</li>`).join('') || '<li>none</li>'}</ul></div>
      <div class="st"><i>2</i><b>Diagnosis</b><p>${top ? `<em>${top.family}</em> problem, ${top.confidence} confidence.<br>Candidates: ${top.candidates.slice(0, 3).map(x => `<code>${x}</code>`).join(' ')}` : 'No anomaly.'}</p></div>
      <div class="st"><i>3</i><b>Decision</b><p>${esc(c.action[0])}</p><p class="sub">${esc(c.action[1])}</p></div>
    </div>
    <div class="two"><div><h4>Escalation ticket (to the team)</h4><pre class="doc">${esc(c.ticket)}</pre></div>
    <div><h4>Message to the client</h4><div class="msg">${esc(c.client_message)}</div><p class="sub" style="margin-top:12px">Window ${c.ctx.start} → ${c.ctx.end} · ${c.ctx.n_log} log lines parsed · past incidents on this feed: ${esc(c.ctx.history)}.</p>${cmd('python src/07_investigate.py ' + c.feed)}</div></div>`;
  }
  const view = {
    case: () => caseView(+(pane.dataset.i || 0)),
    sql: () => `<p class="sub">Not just SELECTs: window functions, CTEs, anti-joins. Each block is the real query and the result it produced on this dataset.</p>` + L.sql.map(q => `<div class="lb"><h4>${q.title}</h4><p class="sub">${q.why}</p>${block(q.code, 'sql', 'sql/analytics.sql · ' + q.name)}${table(q.rows)}</div>`).join(''),
    py: () => `<p class="sub">The functions behind the case file. Pure Python and the standard library, no black boxes.</p>` + L.py.map(q => `<div class="lb"><h4>${q.title}</h4><p class="sub">${q.why}</p>${block(q.code, 'py', q.file)}${cmd(q.run)}</div>`).join(''),
    try: () => `<p class="sub">The same regex as <code>parse_line</code>, running in your browser. Paste a log line (or a junk line) and see what the parser does with it.</p>
      <textarea id="lineIn" rows="3" spellcheck="false" aria-label="Log line">2026-08-29T03:12:44Z INFO feed=F-0062 client=C-035 status=DEGRADED records=41017 expected=61105 latency_s=1108 schema=v3.2 checksum=MISMATCH</textarea>
      <div class="seg" id="samples" style="margin:8px 0"><button type="button" data-s="0">Healthy line</button><button type="button" data-s="1">Schema change</button><button type="button" data-s="2">Heartbeat (junk)</button><button type="button" data-s="3">Truncated line</button></div>
      <div id="lineOut" class="doc"></div>`,
    val: () => { const e = L.eval; if (!e) return '<p class="sub">Run <code>python src/08_validate_investigator.py</code>.</p>';
      const bars = (o, t) => `<div class="vb"><b>${t}</b>${Object.entries(o).map(([k, v]) => `<div class="vrow"><span>${k}</span><div class="vbar"><i style="width:${Math.round(v * 100)}%"></i></div><em>${Math.round(v * 100)}%</em></div>`).join('')}</div>`;
      return `<p class="sub">I tested the investigator against the ${nf(e.n)} sampled incidents whose real cause is known (simulation ground truth). Honest result:</p>
      <div class="kpis" style="grid-template-columns:repeat(auto-fit,minmax(190px,1fr));margin:12px 0"><div class="kpi"><div class="k">Incidents with visible symptoms</div><div class="v">${Math.round(e.symptomatic_share * 100)}<small>%</small></div><div class="sub">the rest were silent in the log</div></div>
      <div class="kpi"><div class="k">Family correct</div><div class="v">${Math.round(e.family_accuracy_when_symptomatic * 100)}<small>%</small></div><div class="sub">vs ${Math.round(e.majority_family_baseline * 100)}% for always guessing the biggest family</div></div></div>
      <div class="two">${bars(e.precision_by_family, 'Precision by family')}${bars(e.recall_by_family, 'Recall by family')}</div>
      <p class="take"><b>What I take from it:</b> delivery telemetry flags <em>schema changes</em> with ${Math.round(e.precision_by_family.schema * 100)}% precision (it catches about ${Math.round(e.recall_by_family.schema * 100)}% of them) and separates transport from content problems only partly. Telling mapping, artwork, schedule and duplicate-ID problems apart needs the payload or the ticket text, which is exactly why the NLP triage exists. So the investigator names a family and its candidates instead of pretending to certainty.</p>`; }
  };
  const SAMPLES = ['2026-06-01T01:04:23Z INFO feed=F-0165 client=C-103 status=OK records=17169 expected=16968 latency_s=232 schema=v3.1 checksum=ok',
    '2026-08-29T03:12:44Z INFO feed=F-0062 client=C-035 status=DEGRADED records=41017 expected=61105 latency_s=1108 schema=v3.2 checksum=MISMATCH',
    '2026-06-01T01:09:05Z DEBUG scheduler heartbeat ok', '2026-06-01T01:12:15Z INFO feed=F-0010 client=C-005 status=OK records=559'];
  const LINE = /^(?<ts>\d{4}-\d\d-\d\dT[\d:]+Z)\s+(?<lvl>[A-Z]+)\s+feed=(?<feed>F-\d+)\s+client=(?<client>C-\d+)\s+status=(?<status>\w+)\s+records=(?<records>\d+)\s+expected=(?<expected>\d+)\s+latency_s=(?<latency>\d+)\s+schema=(?<schema>v[\d.]+)\s+checksum=(?<checksum>\w+)/;
  function parse() {
    const v = document.getElementById('lineIn').value.split('\n').filter(x => x.trim()), out = document.getElementById('lineOut');
    out.innerHTML = v.map(l => { const m = LINE.exec(l.trim()); if (!m) return `<span class="tk-c"># None  → junk line, skipped (no crash)</span>`; const g = m.groups, c = +g.expected ? +g.records / +g.expected : 0;
      return esc(JSON.stringify({ ...g, records: +g.records, expected: +g.expected, latency: +g.latency, completeness: +c.toFixed(4) }, null, 2)) + (g.schema !== 'v3.1' || g.checksum !== 'ok' ? `\n<span class="tk-k"># ⚠ schema ${g.schema} / checksum ${g.checksum}: candidate schema_drift</span>` : c < .92 ? `\n<span class="tk-k"># ⚠ completeness ${(c * 100).toFixed(0)}%</span>` : `\n<span class="tk-c"># healthy</span>`); }).join('\n\n');
  }
  function show(t) {
    pane.dataset.t = t; tabs.querySelectorAll('button').forEach(b => b.setAttribute('aria-selected', b.dataset.t === t)); pane.innerHTML = view[t]();
    if (t === 'try') { parse(); document.getElementById('lineIn').addEventListener('input', parse); document.getElementById('samples').addEventListener('click', e => { const b = e.target.closest('button'); if (b) { document.getElementById('lineIn').value = SAMPLES[+b.dataset.s]; parse(); } }); }
  }
  tabs.addEventListener('click', e => { const b = e.target.closest('button'); if (b) show(b.dataset.t); });
  document.getElementById('lab').addEventListener('click', e => {
    const g = e.target.closest('[data-go]'); if (g) { show(g.dataset.go); document.getElementById('labTabs').scrollIntoView({ behavior: 'smooth', block: 'center' }); return; }
    const c = e.target.closest('.copy'); if (c) { const t = decodeURIComponent(c.dataset.code); (navigator.clipboard ? navigator.clipboard.writeText(t) : Promise.reject()).then(() => { c.textContent = 'Copied'; setTimeout(() => c.textContent = 'Copy', 1500); }, () => { c.textContent = 'Select & copy'; }); return; }
    const k = e.target.closest('#caseSel button'); if (k) { pane.dataset.i = k.dataset.i; pane.innerHTML = view.case(); }
  });
  show('case');
})();
