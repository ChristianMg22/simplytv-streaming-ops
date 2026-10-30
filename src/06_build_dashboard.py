"""
06_build_dashboard.py
---------------------
Assembles outputs/*.json (SQL + models + NLP + data quality) into a single DATA object
and injects it into the page built from dashboard/src/.

Generates:
  dashboard/index.html     -> full page (doctype + head) to open in a browser
  dashboard/artifact.html  -> fragment to publish as an Artifact
  dashboard/data.json      -> the same data, in case you want to use it in another tool
"""
import json
import re
import sqlite3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "outputs"
DASH = ROOT / "dashboard"
FONTS = ("https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,500;12..96,700"
         "&family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;500;600&display=swap")


def load(name):
    return json.loads((OUT / name).read_text(encoding="utf-8"))


src_dir = Path(__file__).resolve().parents[1] / "dashboard" / "src"


def main():
    sql, mdl, nlp, dq = load("sql_results.json"), load("model_results.json"), load("nlp_triage.json"), load("dq_report.json")
    con = sqlite3.connect(ROOT / "data" / "processed" / "simplytv_ops.db")
    urls = dict(con.execute("SELECT event_id, url FROM dim_event").fetchall())
    con.close()
    events = []
    for e in mdl["event_stats"]:
        e = dict(e)
        e["url"] = urls.get(e["event_id"])
        events.append(e)

    # row-level incidents (compact) for the filter explorer: recalculated in the browser
    con = sqlite3.connect(ROOT / "data" / "processed" / "simplytv_ops.db")
    inc = con.execute("SELECT open_month, region, segment, tier, category, severity, state, sla_breach, CAST(julianday(open_date) - julianday('2023-06-01') AS INTEGER) FROM v_incident ORDER BY opened_at").fetchall()
    con.close()
    dims = {k: sorted({r[i] for r in inc}) for k, i in [("region", 1), ("segment", 2), ("tier", 3), ("category", 4), ("severity", 5)]}
    months = sorted({r[0] for r in inc})
    dims["tier"] = ["Gold", "Silver", "Bronze"]
    dims["severity"] = ["P1", "P2", "P3", "P4"]
    rows = [[months.index(r[0]), dims["region"].index(r[1]), dims["segment"].index(r[2]), dims["tier"].index(r[3]),
             dims["category"].index(r[4]), dims["severity"].index(r[5]),
             (1 if r[7] else 0) if r[6] == "resolved" else 2, r[8]] for r in inc]
    # "Lab": real code shown in the dashboard (SQL blocks + Python functions) and the investigator's case files
    import ast
    atext = (ROOT / "sql" / "analytics.sql").read_text(encoding="utf-8")
    blocks = dict(re.findall(r"^-- name:\s*(\w+)\s*\n(.*?)(?=^-- name:|\Z)", atext, flags=re.M | re.S))
    lab_sql = [dict(name=n, code=blocks[n].strip(), rows=[r for r in sql[n] if r.get("rate_before") is not None][:6] if n == "event_impact" else sql[n][:8], title=t, why=w) for n, t, w in [
        ("recurrence", "Recurring failures (window function LAG)", "Which causes keep coming back on the same feed within 14 days?"),
        ("missed_failures", "Bad deliveries nobody noticed (EXISTS anti-join)", "Deliveries that FAILED or DEGRADED and never produced an incident: the silent failures."),
        ("event_impact", "Before / after a public milestone (CTEs)", "Incidents per 1,000 feed-days in the 45 days around each milestone, affected regions only.")]]
    def py_src(file, names):
        t = (ROOT / "src" / file).read_text(encoding="utf-8"); tree = ast.parse(t)
        return "\n\n".join(ast.get_source_segment(t, n) for n in tree.body if isinstance(n, (ast.FunctionDef, ast.Assign)) and (getattr(n, "name", None) in names or (isinstance(n, ast.Assign) and getattr(n.targets[0], "id", None) in names)))
    lab_py = [dict(file="src/07_investigate.py", title="Tolerant log parser", why="The raw delivery log mixes real lines with heartbeats, truncated lines and noise. One regex, no crash.", code=py_src("07_investigate.py", {"LINE", "parse_line", "read_feed_log"}), run="python src/07_investigate.py F-0062 --as-of 2026-08-29"),
              dict(file="src/07_investigate.py", title="Symptom detection against a baseline", why="Compares the last days with the feed's own healthy history, not with a fixed threshold.", code=py_src("07_investigate.py", {"baseline", "detect"}), run="python src/07_investigate.py --top 4"),
              dict(file="src/07_investigate.py", title="Root-cause ranking with evidence", why="Every hypothesis carries the evidence that supports it, so the escalation is a diagnosis, not a guess.", code=py_src("07_investigate.py", {"FAMILY", "RULES", "diagnose"}), run="python src/08_validate_investigator.py"),
              dict(file="src/02_etl.py", title="Cleaning messy ticket JSON", why="Dates, severities and teams arrive in many formats; the ETL normalizes them and logs every fix in dq_log.", code=py_src("02_etl.py", {"parse_ts", "norm_cat", "norm_sev", "norm_team"}), run="python src/02_etl.py")]
    inv_p, ev_p = ROOT / "outputs" / "investigations.json", ROOT / "outputs" / "investigator_eval.json"
    # interview bank (docs/interview_bank.md) -> sections of questions
    qa, cur = [], None
    for ln in (ROOT / "docs" / "interview_bank.md").read_text(encoding="utf-8").splitlines():
        m = re.match(r"^## (?:\d+\.\s*)?(.+)$", ln)
        if m: cur = dict(title=m.group(1).strip(), items=[]); qa.append(cur); continue
        if cur is None: continue
        q = re.match(r"^\*\*(\d+)\.\s*(.+?)\*\*\s*$", ln)
        if q: cur["items"].append(dict(n=int(q.group(1)), q=q.group(2), a="")); continue
        b = re.match(r"^- \*\*(.+?)\*\*\s*(.+)$", ln)
        if b: cur["items"].append(dict(n=0, q=b.group(1).strip('"“”'), a=b.group(2))); continue
        if ln.strip() and cur["items"] and not ln.startswith("---") and not ln.startswith("#"): cur["items"][-1]["a"] += (" " if cur["items"][-1]["a"] else "") + ln.strip()
    qa = [x for x in qa if x["items"]]
    lab = dict(qa=qa, sql=lab_sql, py=lab_py, cases=json.loads(inv_p.read_text(encoding="utf-8")) if inv_p.exists() else [],
               eval=json.loads(ev_p.read_text(encoding="utf-8")) if ev_p.exists() else None,
               dq=json.loads((ROOT / "outputs" / "dq_report.json").read_text(encoding="utf-8")),
               alert=json.loads((ROOT / "outputs" / "alert_sim.json").read_text(encoding="utf-8")),
               runbook=json.loads((ROOT / "outputs" / "runbook.json").read_text(encoding="utf-8")))
    world = json.loads((src_dir / "worlddots.json").read_text(encoding="utf-8"))

    data = dict(
        lab=lab, explorer=dict(day0="2023-06-01", dims=dims, months=months, rows=rows, world=world),
        meta=dict(generated="2026-10-15", cutoff=sql["kpi_overview"]["data_to"],
                  from_=sql["kpi_overview"]["data_from"]),
        kpi=sql["kpi_overview"], monthly=sql["monthly_trend"], pareto=sql["category_pareto"],
        sla_matrix=sql["sla_matrix"], segment=sql["segment_summary"], region=sql["region_summary"],
        feedtype=sql["feed_type_summary"], heat=sql["heatmap_dow_hour"], detection=sql["detection_summary"],
        delay=sql["detection_delay"], missed=sql["missed_failures"], clientPareto=sql["client_pareto"],
        topClients=sql["top_clients"], recurrence=sql["recurrence"], team=sql["team_summary"],
        slaUtil=sql["sla_utilization"], feedAge=sql["feed_age_effect"], events=events,
        nlp={k: v for k, v in nlp.items() if k != "confusion"},
        dq={f"{r['step']}.{r['metric']}": r["value"] for r in dq},
        cls=mdl["classification"], fc=mdl["forecast"], anom=mdl["anomaly"],
    )
    payload = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
    (DASH / "data.json").write_text(payload, encoding="utf-8")

    src = DASH / "src"
    css = (src / "style.css").read_text(encoding="utf-8")
    html = (src / "body.html").read_text(encoding="utf-8")
    js = (src / "lib.js").read_text(encoding="utf-8") + "\n" + (src / "sections.js").read_text(encoding="utf-8") + "\n" + (src / "palettes.js").read_text(encoding="utf-8") + "\n" + (src / "beams.js").read_text(encoding="utf-8") + "\n" + (src / "particles.js").read_text(encoding="utf-8") + "\n" + (src / "skyline.js").read_text(encoding="utf-8") + "\n" + (src / "lab.js").read_text(encoding="utf-8") + "\n" + (src / "explorer.js").read_text(encoding="utf-8") + "\n" + (src / "tour.js").read_text(encoding="utf-8") + "\n" + (src / "present.js").read_text(encoding="utf-8") + "\n" + (src / "export.js").read_text(encoding="utf-8")
    safe = payload.replace("</", "<\\/")
    head = ('<title>Streaming Ops Simply.TV</title>\n<meta name="claude:viewport-fit-sides" content="cover">\n'
            f'<link rel="stylesheet" href="{FONTS}">\n<style>\n{css}\n</style>')
    script = f"<script>\nconst DATA = {safe};\n{js}\n</script>"
    (DASH / "artifact.html").write_text(f"{head}\n{html}\n{script}\n", encoding="utf-8")
    full = ("<!doctype html>\n<html lang=\"en\" data-theme=\"dark\">\n<head>\n<meta charset=\"utf-8\">\n"
            "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1,viewport-fit=cover\">\n"
            "<meta name=\"description\" content=\"Streaming data and operations analytics: SQL star schema, NLP triage, SLA-risk model, forecasting and an investigator. Synthetic data.\">\n"
            "<meta name=\"theme-color\" content=\"#070b1c\">\n"
            "<meta property=\"og:type\" content=\"website\">\n<meta property=\"og:title\" content=\"Streaming Ops: Data and Operations Analytics\">\n"
            "<meta property=\"og:description\" content=\"Interactive dashboard with Python + SQL pipeline, predictive models and a feed-incident investigator (synthetic data).\">\n"
            "<meta property=\"og:image\" content=\"https://christianmg22.github.io/simplytv-streaming-ops/docs/preview.png\">\n"
            "<meta name=\"twitter:card\" content=\"summary_large_image\">\n"
            f"{head}\n<style>html{{color-scheme:dark}}body{{margin:0}}img{{max-width:100%}}[hidden]{{display:none!important}}</style>\n"
            f"</head>\n<body>\n{html}\n{script}\n</body>\n</html>\n")
    (DASH / "index.html").write_text(full, encoding="utf-8")
    print(f"dashboard/index.html {len(full) / 1024:.0f} KB | artifact.html {(DASH / 'artifact.html').stat().st_size / 1024:.0f} KB")


if __name__ == "__main__":
    main()
