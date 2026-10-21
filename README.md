# Streaming Ops · Simply.TV case

End-to-end data project (data engineering + machine learning) for the
**Streaming Data & Operations Analyst** profile at Simply.TV: extract and transform with Python and SQL, take the
result to an executive dashboard, and close with predictive models.

> **Note on the data.** Simply.TV does not publish its operational logs. The incidents, deliveries and tickets
> in this project are **synthetic** (fixed seed). What is public and anchors the simulation: segments,
> products, platforms served and dated milestones (LATAM launch, GVIDI, InFlow Media,
> Allente, Deutsche TV-Plattform…). Clients are anonymous; no incident is attributed to a real company.
> The figures describe the method, not the real operation of the company.

## The problem

When a metadata feed arrives incomplete, late or with a changed schema, the client sees empty guides,
broken images or duplicated catalogs. Every incident has a resolution SLA based on its severity and the client's tier.
Four questions:

1. Where do SLA breaches concentrate, and why?
2. Can they be anticipated when the ticket opens?
3. How much volume is coming?
4. Are there degradations nobody is seeing?

## Investigation lab (what the Streaming Data & Operations Analyst role does day to day)

The dashboard has an **Investigation lab** section that shows the Python and SQL behind the analysis, with a table mapping every requirement of the vacancy to where it is demonstrated.

| Script | What it shows |
|---|---|
|  `python src/07_investigate.py F-0062` | Investigates one feed end to end: tolerant parsing of the raw `.log.gz`, baseline from SQL, symptom detection, ranked root-cause hypotheses with evidence, resolve-vs-escalate decision, an escalation ticket and a plain-language client message (`outputs/investigations/*.md`). |
| `python src/08_validate_investigator.py` | Measures the investigator against 400 incidents with known cause. Honest result: delivery telemetry flags schema changes with about 74% precision (about 49% recall) but cannot tell mapping, artwork, schedule and duplicate-ID problems apart; that is why the NLP triage exists. |
| `python -m pytest tests -q` (or `python tests/test_investigate.py`) | Unit tests for the parser (junk lines, zero division) and the diagnosis rules. |


## Findings (on simulated data)

| Question | Result |
|---|---|
| Magnitude | 5,485 incidents in 40 months; 24.7% resolved outside SLA; median resolution 19 h (P90: 94 h) |
| Dominant cause | **Schema drift**: 22% of incidents but 37% of breaches (41% of them breach) |
| Concentration | 20% of clients account for 50% of breaches |
| New feeds | Feeds under 30 days old have 3× more bad deliveries than feeds over a year old |
| Detection | What the client detects arrives 55× later than what monitoring detects (12.7 h vs 14 min); 316 faulty deliveries never generated a ticket |
| SLA risk | Logistic regression, AUC 0.73 vs 0.69 for the historical rule; the highest-risk 20% captures 40% of breaches |
| Forecast | ~574 incidents in the next 13 weeks (541 in the previous 13); Ridge improves 5% over the moving average |
| Silent degradations | 638 "OK" deliveries were incomplete; the hybrid detector (rule + IsolationForest) finds 85% with 76% precision |
| Public milestones | None leaves a statistically detectable effect (low power; the CEO event serves as a control) |

Results that do not favor the model, reported as they are: the simplest model won on validation; a
completeness rule beat IsolationForest on its own; the ETA model improves little over the historical median.

## How to run it

```bash
pip install -r requirements.txt
./run_all.sh            # ~50 s; open dashboard/index.html when it finishes
```

## Structure

```
src/01_generate_data.py   messy raw data: CSV, XML, .gz log, JSONL (mixed date formats, duplicates, nulls)
src/02_etl.py             extract/transform/load -> SQLite; regex, normalization, dedupe, data-quality log
src/03_nlp_triage.py      TF-IDF + logistic regression (EN/ES/PT) fills in missing root causes
src/04_sql_analytics.py   runs sql/analytics.sql (18 queries) -> outputs/sql_results.json
src/05_models.py          SLA classification, ETA, weekly forecast, anomaly detection
src/06_build_dashboard.py assembles dashboard/index.html
sql/schema.sql            star schema (8 tables)    sql/views.sql   semantic layer (SLA defined in one place)
sql/analytics.sql         CTEs, ROW_NUMBER, LAG, NTILE, SUM OVER, EXISTS anti-joins
dashboard/                dark theme by default, light theme toggle; index.html (self-contained), data.json, src/ (styles, structure, logic)
dashboard/src/explorer.js  explorer: filters (region/segment/tier), animated map and Sankey; recalculates in the browser from v_incident
dashboard/src/export.js    "Export" button (CSV/JSON of SQL results, models and the explorer's filtered slice)
dashboard/src/present.js   presentation mode (one section per screen, arrows, Esc)
dashboard/tools/           builds the map's dot matrix (world-atlas) -> src/worlddots.json
dashboard/src/particles.js animated hero background (particle vortex that follows the cursor; native canvas port)
components/ui/            original React/Tailwind component (asmr-background) for a shadcn app; the dashboard uses the plain-JS port
docs/prompt_playbook.md   diagnosis prompt templates and how I verify the answers
```

## Decisions that matter

- **No data leakage.** The SLA model uses only what is known at triage. Escalation, assigned team, first response
  and closure were excluded. The split is time-based (train before 2026, test January–September 2026).
- **Model selection on validation only**, never on the test set.
- **One place to define "breach"**: the `v_incident` view (resolution > SLA for severity × tier).
- **The dashboard simulator is the real model**: the coefficients are exported and, in the browser, reproduce
  Python's AUC (0.7257), verified.
- **Measured data quality**: every ETL correction is recorded in `dq_log` (96 duplicate tickets, 4 date formats,
  69 impossible closures flagged, 35 `client_id`s recovered, 592 causes filled in with NLP).
- **Validated chart palette** (color difference for color blindness and contrast) with the visualization guide's validator.

## What this does not show

- That Simply.TV's real operation behaves this way: the data is simulated.
- The explorer filters only its own blocks (KPIs, map, causes, Sankey); the other sections always show the total. With small slices (e.g. 70 incidents) the percentages are noisy.
- The NLP and anomaly metrics are more optimistic than they would be on real data (text and degradations generated with simple rules).
- The "what-if" scenario's savings assume that handling flagged cases shortens their resolution proportionally;
  it is a hypothesis for a pilot.
- The dashboard colors are an approximation of Simply.TV's style: its brand guide could not be verified. Change the
  variables at the top of `dashboard/src/style.css` if you have it.
- The dashboard was tested with jsdom and with real Chromium (screenshots in light and dark themes, desktop and mobile, no runtime
  errors; the explorer's figures were checked against SQL). It still needs a look with Google Fonts loaded.

## Public sources

- Simply.TV: https://www.simply.tv/ · Latin America: https://simply.tv/post/simply-tv-is-launching-in-latin-america
- GVIDI: https://digitaltveurope.com/2022/08/23/simply-tv-acquires-epg-specialist-gvidi
- InFlow Media: https://www.simply.tv/company/simply-acquires-inflow-media
- Vestel: https://digitaltveurope.com/2021/11/23/vestel-partners-with-simply-tv-for-metadata-services
- Deutsche TV-Plattform: https://www.simply.tv/insights/simply.tv-joins-deutsche-tv-plattform
- Founding (2019): https://rethinkresearch.biz/articles/simply-tv-buys-its-own-metadata-grandmother/
