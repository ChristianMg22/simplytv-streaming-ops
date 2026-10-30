# Technical interview bank: Streaming Data & Operations Analyst (Simply.TV, Mexico)

**How to use it (Español):** cada pregunta trae *qué evalúan*, una *respuesta modelo* corta y un **ejemplo real de este proyecto** (con archivo y número) para que contestes con evidencia. Practica decir primero la respuesta en una frase, luego el ejemplo. Aclara siempre que los datos son sintéticos, anclados en hitos públicos de Simply.TV.

Project facts to keep in your head: 120 clients, 191 feeds, 160,527 feed-days, 5,485 incidents, 24.7% SLA breach, median resolution 19 h, Python + SQLite + scikit-learn, repo `simplytv-streaming-ops`.

---

## 1. Ownership and the role

**1. Tell me about yourself and why this role.**
*Tests:* fit, clarity. *Answer:* Link your background to hands-on data troubleshooting: you like finding why something is wrong and proving it with data. *Project:* "To prepare, I built an end-to-end simulation of Simply.TV's feed operations: ETL, SQL, models and a tool that investigates a feed and writes the escalation ticket."

**2. Walk me through your project in 60 seconds.**
*Answer:* Problem → data → method → result → limit. *Project:* "Why does a feed incident breach its SLA? I generated 5,485 incidents over 160,527 feed-days, cleaned them with a Python ETL into a SQL star schema, answered 18 questions in SQL, built models to predict risk, and a tool (`src/07_investigate.py`) that diagnoses a feed. 24.7% of incidents breach; schema drift is the most frequent cause. The data is synthetic."

**3. What does "ownership from investigation to resolution" mean to you?**
*Answer:* You do not hand over a vague ticket; you reproduce, find the cause, fix what is yours, escalate the rest with evidence, tell the client, and document it. *Project:* the investigator's six steps (parse, baseline, detect, diagnose, decide, communicate) are exactly that flow.

**4. This is "not a traditional support role". How do you work without a runbook?**
*Answer:* Form hypotheses, test each with data, rule out, document what you learn so it becomes the next runbook. *Project:* `diagnose()` ranks hypotheses with the evidence for each; the case files in `outputs/investigations/*.md` are the written trace.

---

## 2. Root-cause analysis and troubleshooting

**5. A client says "my EPG feed is wrong". What do you do first?**
*Answer:* (1) Clarify the symptom and the time window, (2) check delivery status and volume against the feed's normal, (3) check schema/checksum, (4) check recent changes, (5) compare with other feeds of the same client or type to see if it is isolated. *Project:* `python src/07_investigate.py F-0062 --as-of 2026-08-29` shows schema v3.1 → v3.2 with a checksum MISMATCH on that day, so the first hypothesis is schema drift.

**6. How do you tell a source outage from a mapping problem?**
*Answer:* Outage: nothing arrives (FAILED, 0 records) or arrives extremely late. Mapping: data arrives but incomplete. *Project:* in the log, FAILED deliveries have `records=0`; DEGRADED ones have completeness around 60-90%. In the investigator these map to the "transport" and "content" families. Honest limit: telemetry cannot separate mapping, artwork, schedule and duplicate-ID problems; for that I use the ticket text (NLP) or the payload.

**7. How do you know a cause is the root cause and not a symptom?**
*Answer:* Ask "why" until you reach something you can change, and check that fixing it would remove the symptom; look for recurrence after the fix. *Project:* the recurrence query (`sql/analytics.sql`, `recurrence`) uses `LAG` to find the same cause on the same feed within 14 days; schema drift recurs about 15% of the time, which tells me patching one incident is not enough.

**8. Give an example where the data surprised you.**
*Project:* New feeds are the riskiest: 8.8% of deliveries are bad in the first 30 days of a feed versus 2.9% after a year (`feed_age_effect`). Also, region matters: North America breaches 31.8% of its incidents versus 19.8% in DACH.

**9. What would you check if a feed is "OK" but the client still complains?**
*Answer:* Silent failures: status OK does not guarantee correct content. *Project:* 316 of 5,411 FAILED/DEGRADED deliveries never produced an incident within 72 hours (`missed_failures`, an `EXISTS` anti-join), and the anomaly model found 638 silent bad days. That is why monitoring must not rely only on tickets.

**10. How do you prioritize when three investigations land at once?**
*Answer:* Severity × client tier × time left on the SLA, then quick wins, and tell stakeholders what is waiting. *Project:* the SLA-risk model scores incidents; flagging the top 20% by risk captures 39.5% of all breaches (precision 52.8% vs a 26.7% base rate), so I would review those first.

---

## 3. Python

**11. How have you used Python to troubleshoot a data process?**
*Project:* `read_feed_log()` streams a gzipped log of 162,958 lines and keeps only one feed's window; `parse_line()` uses a regex with named groups and returns `None` for junk. 1,580 heartbeat lines and 322 malformed lines are skipped, not crashed on.

**12. How do you handle messy or inconsistent input?**
*Answer:* Never trust the format; normalize, log every fix, count rejects. *Project:* `02_etl.py` parses four date formats (`dd/mm/yyyy` day-first, ISO, epoch, text), maps severities ("p2", 3, "P2") to one scale, and removed 529 duplicate log lines and 96 duplicate tickets. Every step writes to the `dq_log` table.

**13. How do you make sure your script is correct?**
*Project:* `tests/test_investigate.py` has 7 unit tests (junk lines return `None`, zero `expected` does not divide by zero, schema change is ranked first, failed deliveries go to Operations, healthy feed means "No action"). Run `python tests/test_investigate.py`.

**14. How do you automate a repetitive task?**
*Project:* `run_all.sh` rebuilds everything (generate, ETL, SQL, NLP, models, dashboard) with one command, and `07_investigate.py --top 4` writes four case files at once.

**15. A script is slow on a large file. What do you do?**
*Answer:* Stream instead of loading, filter early, profile before optimizing. *Project:* the log is read line by line from `.gz`, and a cheap `if feed_id not in line` check skips most lines before the regex runs.

**16. pandas vs plain Python?**
*Answer:* pandas for tabular transforms and joins; plain Python or generators for streaming and parsing. *Project:* the ETL uses pandas; the log reader uses a generator over the file.

---

## 4. SQL and databases

**17. Explain a query you are proud of.**
*Project:* `missed_failures`: deliveries with status ≠ OK that have no incident for the same feed within 3 days, using `EXISTS` (anti-join). Result: 292 DEGRADED and 24 FAILED deliveries went unnoticed.

**18. When do you use window functions?**
*Answer:* Comparing a row with its neighbors or ranking inside a group without collapsing rows. *Project:* `LAG(opened_at) OVER (PARTITION BY feed_id, category ORDER BY opened_at)` to flag recurring failures; `NTILE` for risk deciles.

**19. CTE vs subquery?**
*Answer:* CTEs for readability and reuse; same result, clearer to debug. *Project:* `event_impact` builds before/after windows, regional scope and feed-days as separate CTEs, then joins them.

**20. How do you keep a metric consistent across many queries?**
*Answer:* One definition in one place. *Project:* the view `v_incident` defines "SLA breach" once; all 18 queries and the models use it, so the 24.7% (1,337 of 5,404 resolved incidents) is the same everywhere.

**21. Why a star schema?**
*Answer:* Facts (deliveries, incidents) joined to small dimensions (client, feed, SLA, event) make analytical queries simple and fast. *Project:* `fact_delivery` (160,527 rows), `fact_incident` (5,485) and `dim_*` tables in `sql/schema.sql`.

**22. How do you validate a query result?**
*Answer:* Reconcile totals, spot-check by hand, compare two independent computations. *Project:* I checked that the dashboard's filtered export (DACH + Silver = 70 incidents) matches the SQL count.

---

## 5. Data structures, formats and data flow

**23. How does data move through your project?**
*Project:* raw (gz log, JSONL tickets, CSV catalogs, XML milestones) → ETL clean → SQLite star schema → SQL results and models → JSON → self-contained HTML dashboard. Each arrow is a script.

**24. How do you work with JSON, XML and logs?**
*Project:* tickets are JSON Lines with mixed formats; milestones come from XML (`xml.etree`) with a source URL; the log is parsed with a regex. Same goal in all three: a typed, validated row.

**25. What is schema drift and how do you detect it?**
*Answer:* The structure or version of delivered data changes without downstream mapping being updated. Detect by comparing the schema version, field set and checksum against the feed's baseline. *Project:* 777 deliveries moved to `v3.2` with `checksum=MISMATCH`; schema drift is the top cause (1,221 incidents, 22%) and has the highest breach rate (40.6%).

**26. How would you work with an API instead of a log?**
*Answer:* Authenticate, paginate, handle rate limits and retries, validate the response against an expected schema, and log failures. *Honest note:* my project reads files, not a live API; the same validation logic (`parse_line` + checks) applies to JSON responses.

**27. What is idempotency and why does it matter in pipelines?**
*Answer:* Running a step twice gives the same result, so you can safely re-run after a failure. *Project:* the ETL rebuilds tables from raw each run and removes duplicates (529 lines, 96 tickets), so re-running never doubles data.

---

## 6. AI tools, prompting and models

**28. How do you use AI tools in your workflow?**
*Answer:* As an assistant to speed up and challenge my work, never as the final authority: I verify outputs against data. *Project:* `docs/prompt_playbook.md` documents the prompts I used (context, task, constraints, output format) and what I checked afterwards.

**29. Give an example of a good prompt.**
*Answer:* Role + context + data shape + exact task + output format + "ask me if unclear". *Example:* "I have a gzipped log with lines like `... feed=F-0062 status=DEGRADED records=41017 expected=61105 schema=v3.2 checksum=MISMATCH` and junk heartbeat lines. Write a Python function that parses valid lines into a dict and returns `None` otherwise; include unit tests."

**30. How do you avoid trusting a wrong AI answer?**
*Answer:* Reproduce on a small sample, write a test, compare with an independent calculation. *Project:* when I validated my investigator, the first version read well on the cases I looked at but scored only 17% (exact cause) on 60 incidents; I redesigned it to report a family of causes and measured 53% vs a 45% baseline. Testing changed the design.

**31. How does your ticket classifier work and how good is it?**
*Project:* TF-IDF (1-2 grams) + logistic regression with balanced classes, in English, Spanish and Portuguese. Hold-out accuracy 84.7%, macro F1 0.835. Predictions above a 0.45 confidence threshold are 95.8% accurate, and low-confidence ones are left "unclassified" (71 tickets) instead of forced.

**32. How did you avoid data leakage in the risk model?**
*Project:* I excluded `escalated`, `team`, `first_response_min` and resolution time because they are only known after the incident, and used a time split (train before 2026-01-01, test after), not a random split.

**33. How do you evaluate against a baseline?**
*Project:* The SLA-risk model (logistic regression) reaches AUC 0.726 vs 0.690 for a historical-rate baseline: a modest but real lift. Random Forest and Gradient Boosting scored lower (0.708, 0.706), so I kept the simpler, explainable model. For the 13-week forecast, Ridge (MAE 4.5) beat a naive forecast (5.8) and a 4-week mean (4.8).

**34. How do you explain a model to a non-technical person?**
*Project:* "Out of 100 incidents, if we review the 20 the model ranks riskiest first, we catch about 40% of all breaches, versus 20% if we picked at random." Top drivers: root cause category, client tier and night-time opening.

---

## 7. Communication and clients

**35. How do you explain a technical issue to a client?**
*Answer:* What happened in one sentence, impact on them, what we are doing, when the next update comes; no jargon, no blame. *Project:* the tool writes: "Our data provider did not send the expected files. We are already working on the fix... we will send one more update." The technical ticket for Development is a separate, detailed document.

**36. How do you write an escalation to Development?**
*Answer:* Symptom, window, evidence, hypotheses ranked, what you already checked, and a clear ask. *Project:* the ticket template in `07_investigate.py` has exactly those sections (Evidence, Hypotheses, What the analyst already checked, Ask).

**37. A client is upset about a repeated failure. What do you do?**
*Answer:* Acknowledge, give facts, show you understand the pattern, commit to a prevention step. *Project:* the recurrence query tells me whether it is a pattern (same cause on the same feed within 14 days), so I can say "this is the second schema change on your feed this month; we will validate schema versions before delivery".

**38. How do you work with Development, Operations and Streaming?**
*Answer:* Route by ownership with evidence. *Project:* in the investigator, schema and content problems go to Development, transport problems (outage, endpoint) go to Operations.

---

## 8. Organization, accuracy and mindset

**39. How do you manage multiple investigations and changing priorities?**
*Answer:* A visible list with severity, SLA clock and next action; re-rank when something new arrives; communicate trade-offs. *Project:* the risk ranking plus the 13-week forecast (expected incident volume) help plan workload.

**40. How do you ensure data accuracy?**
*Project:* single SLA definition, `dq_log` for every cleaning step (322 malformed lines rejected, 96 duplicate tickets removed), unit tests, and validation of models against ground truth. I also state limits openly, e.g. the investigator's 74% precision / 49% recall on schema changes.

**41. Tell me about a mistake or a failed approach.**
*Project:* My first investigator ranked specific causes and was right only 17% of the time. Measuring it against known causes showed delivery telemetry cannot separate mapping from artwork or schedule problems. I changed it to name a family with candidates and left the final call to ticket text, which is more honest and more useful.

**42. How do you learn an unfamiliar system quickly?**
*Answer:* Map inputs/outputs, read real examples, build a small tool, ask targeted questions. *Project:* I learned the EPG/VOD/Sports/Artwork product lines from public information and encoded them in the feed types and milestones.

**43. How do you handle a fast-paced environment?**
*Answer:* Automate the repeatable, document the recurring, keep a short feedback loop. *Project:* one command rebuilds the whole pipeline and the dashboard.

**44. Where would you take this next at Simply.TV?**
*Answer:* Connect to real telemetry and APIs, add alerts for silent failures, schema validation before delivery, and feed the case files into a searchable knowledge base. Always with a pilot and a measured baseline first.

---

## 9. Coding drills (Python + SQL)

**45. list, tuple, set, dict: when do you use each?**
*Tests:* basics. *Answer:* list for ordered, changeable sequences; tuple for fixed records; set for membership and dedupe (O(1) lookup); dict for key to value lookups. *Project:* `02_etl.py` maps messy labels to clean categories with a dict (`norm_cat`), and checks membership against sets instead of scanning lists.

**46. What is a generator and why use it?**
*Tests:* memory awareness. *Answer:* it yields one item at a time, so a huge file never sits in memory; it is lazy and can be consumed once. *Project:* `read_feed_log()` streams a gzipped log of 162,958 lines and keeps only one feed's window, so memory stays flat.

**47. How do you handle errors without hiding them?**
*Tests:* robustness. *Answer:* catch specific exceptions, handle only what you can recover from, count or log the rest, never a bare `except: pass`. *Project:* `parse_line()` returns `None` for junk lines and the ETL counts them (322 malformed rejected) instead of crashing or silently dropping. In the API I found that `as_of=2026-02-30` passed my regex and caused a 500; the fix was real date validation returning 422.

**48. What is a context manager and why `with`?**
*Answer:* it guarantees cleanup (close file, release connection) even if an error happens. *Project:* `read_feed_log()` opens the gzipped log with `with gzip.open(...)`, so the file closes even if parsing fails.

**49. merge, join, concat in pandas: what is the difference and what goes wrong?**
*Answer:* `merge` is SQL-style on keys, `concat` stacks, `join` is merge on index. Typical bugs: duplicated keys multiply rows; wrong `how` drops rows; silent dtype mismatches. *Project:* I check row counts before and after each merge, and the ETL logs counts in `dq_log` so a bad join shows up as a number.

**50. What is `merge_asof` and when do you need it?**
*Answer:* a join to the nearest previous (or next) row by time, within a tolerance. It is the right tool for 'the state at the moment of the event'. *Project:* In `05_models.py` each incident gets the last delivery of its feed before it opened (`direction='backward'`, 3-day tolerance), so the model only sees information available at ticket opening.

**51. Vectorized code vs `apply` vs loops?**
*Answer:* vectorize first (NumPy/pandas operations); `apply` is a hidden loop; use real loops only when the logic is sequential. Measure before optimizing. *Project:* The 'incidents on the same client in the previous 7 days' feature uses `np.searchsorted` per group, O(n log n), instead of a nested loop over all pairs, O(n²).

**52. What is data leakage and how did you avoid it?**
*Answer:* using information that would not exist at prediction time. Split by time, not randomly, and exclude columns created after the event. *Project:* The SLA model trains on incidents before 2026-01-01 and tests after. I excluded `escalated`, `team`, `first_response_min` and resolution time because they only exist after the ticket is handled.

**53. Explain a regex you wrote.**
*Answer:* walk through the groups, anchors and why it is safe. *Project:* `LINE` in `07_investigate.py` uses named groups (`feed`, `status`, `records`, `schema`, `checksum`) so the parser reads like the log format. I tested it on a 200,000-character line: 0.19 s, no catastrophic backtracking, because the pattern has no nested quantifiers.

**54. How do you make a project reproducible?**
*Answer:* pinned dependencies, fixed random seeds, one command to rebuild, tests in CI. *Project:* `requirements.txt`, a fixed seed in the generator and models, `run_all.sh`, and a GitHub Actions workflow that runs `pytest` and rebuilds the dashboard.

**55. How do you test code that reads files or a database?**
*Answer:* small fixtures, temporary files (`tmp_path`), and testing behaviors, not implementation. *Project:* `tests/test_xmltv.py` writes malformed, clean and malicious XML to `tmp_path`; `tests/test_api.py` uses FastAPI's `TestClient` against the real SQLite file.

**56. print vs logging?**
*Answer:* logging has levels, timestamps and destinations; print is fine for a CLI result. For data pipelines, also persist counters. *Project:* The ETL writes every cleaning step to a `dq_log` table (duplicates removed, formats fixed, rows rejected), which is queryable and shown in the dashboard's Data quality tab.

**57. How do you deal with dates, formats and time zones?**
*Answer:* parse once at the edge, store a single canonical form (UTC or naive UTC), and test the odd formats. *Project:* `parse_ts()` handles four formats (day-first `dd/mm/yyyy`, ISO, epoch and text) and logs how many rows used each; deliveries are parsed as UTC and stored without time zone.

**58. Is your script idempotent?**
*Answer:* running it twice gives the same result and no duplicates. *Project:* The pipeline rebuilds the database from the raw files with a fixed seed, and deliveries are deduplicated by `(feed_id, ts)` and then by `(feed_id, delivery_date)` so a re-delivered file cannot double count.

**59. What is the time complexity of deduplicating a large list?**
*Answer:* hashing gives O(n); sorting gives O(n log n); comparing every pair gives O(n²), which is what to avoid. *Project:* `drop_duplicates` removed 529 duplicate log lines and 96 duplicate tickets (by ticket id) without any pairwise comparison.

**60. INNER vs LEFT JOIN, and the WHERE trap?**
*Answer:* INNER keeps matches only; LEFT keeps every left row. Filtering the right table in `WHERE` turns a LEFT JOIN into an INNER one; put the condition in `ON`. *Project:* `event_impact` LEFT JOINs the before/after windows on `side = 'before'` / `'after'` inside the `ON` clause, so events with no incidents still appear with zeros.

**61. WHERE vs HAVING?**
*Answer:* `WHERE` filters rows before grouping; `HAVING` filters groups after aggregation. *Project:* Filtering to resolved incidents is a `WHERE` (applied before grouping); a `HAVING` would be the way to hide categories with too few incidents to trust a rate, a guard I would add on real data.

**62. How do NULLs behave?**
*Answer:* `NULL = NULL` is not true; `COUNT(*)` counts rows, `COUNT(col)` skips NULLs; `NOT IN` with a NULL in the list returns nothing. Prefer `NOT EXISTS` / anti-joins. *Project:* `missed_failures` uses `EXISTS` for the anti-join, which is NULL-safe: 316 FAILED/DEGRADED deliveries never produced an incident within 72 h.

**63. ROW_NUMBER vs RANK vs DENSE_RANK?**
*Answer:* ROW_NUMBER is unique; RANK leaves gaps after ties; DENSE_RANK does not. Use ROW_NUMBER to pick one row per group. *Project:* `detection_delay` matches each incident to the feed's most recent faulty delivery with `ROW_NUMBER() OVER (PARTITION BY i.incident_id ORDER BY d.delivery_ts DESC)` and keeps rank 1; that is how I measured 0.23 h automatic vs 12.7 h client-detected.

**64. How do you compute a running total, a moving average or a percentage of total?**
*Answer:* window functions with a frame: `SUM(x) OVER (ORDER BY d ROWS BETWEEN 6 PRECEDING AND CURRENT ROW)`; share of total with `x * 1.0 / SUM(x) OVER ()`. *Project:* The Pareto query computes the cumulative share with `SUM(n) OVER (ORDER BY n DESC ROWS UNBOUNDED PRECEDING)`, and `client_pareto` does the same by client decile.

**65. SQLite has no MEDIAN. How do you get one?**
*Answer:* order the values and take the middle row(s) with `ROW_NUMBER`/`COUNT` in a CTE, or use `NTILE` for deciles. *Project:* The KPI query computes the 19.05 h median with `ROW_NUMBER() OVER (ORDER BY resolution_hours)` and `COUNT(*) OVER ()` in a CTE; `client_pareto` uses `NTILE(10)` to split clients into deciles.

**66. How do you pivot rows into columns in SQL?**
*Answer:* conditional aggregation: `SUM(CASE WHEN ... THEN 1 ELSE 0 END)`. *Project:* The recurrence query counts incidents on the same feed and category within 14 days with `SUM(CASE WHEN julianday(opened_at) - julianday(prev) <= 14 ...)`, using `LAG` to get `prev`; recurrence is about 15% for schema drift.

**67. What would you index and how do you check it?**
*Answer:* columns used in joins and filters (`feed_id`, `opened_at`); check the plan with `EXPLAIN QUERY PLAN`. Indexes speed reads and slow writes. *Project:* Honest answer: at 5,485 incidents and 160k deliveries I did not need them. In production I would index `fact_delivery(feed_id, delivery_ts)` and `fact_incident(feed_id, opened_at)`, since the investigator filters by feed and date.

**68. What makes a query slow and how do you fix it?**
*Answer:* scanning too much (`SELECT *`, no filter), functions on indexed columns, joins that multiply rows, correlated subqueries. Filter early, select only needed columns, aggregate before joining. *Project:* `baseline()` in the investigator fetches only the last 60 OK deliveries of one feed with a parameterised, ordered, `LIMIT`ed query, and never loads the whole delivery table.

**69. How do you find gaps in a time series with SQL?**
*Answer:* `LAG` the date and compare the difference, or left join a calendar table. *Project:* The investigator's `missing_days` symptom is the same idea: days without a delivery in the feed's window. The anomaly model also flags days that look fine but have completeness below 92%.

**70. Star schema, a view and a CTE: how do they fit together?**
*Answer:* the schema organizes data, a view fixes a business definition, CTEs structure one query. *Project:* `v_incident` defines 'SLA breach' once on top of `fact_incident` and the dimensions; every query and model reads the same 24.7%, and complex queries use CTEs for readability.

---

## Quick answers to hard follow-ups

- **"Is this real data?"** No. It is simulated and anchored on public milestones, because Simply.TV's operational logs are not public. The value is the method; I would re-validate everything on real data.
- **"Why logistic regression?"** It won on the time-split test (AUC 0.726), it is explainable, and it is easy to monitor.
- **"What would you do differently?"** Use real labels for root causes, add payload-level checks (field-level diffs) so the investigator can separate content problems, and add alerting.
- **"What are you weakest at?"** Production APIs/streaming infrastructure at scale; I have worked with files and SQL, and I learn systems by building small tools like this one.
