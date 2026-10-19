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
    world = json.loads((src_dir / "worlddots.json").read_text(encoding="utf-8"))

    data = dict(
        explorer=dict(day0="2023-06-01", dims=dims, months=months, rows=rows, world=world),
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
    js = (src / "lib.js").read_text(encoding="utf-8") + "\n" + (src / "sections.js").read_text(encoding="utf-8") + "\n" + (src / "palettes.js").read_text(encoding="utf-8") + "\n" + (src / "particles.js").read_text(encoding="utf-8") + "\n" + (src / "skyline.js").read_text(encoding="utf-8") + "\n" + (src / "explorer.js").read_text(encoding="utf-8") + "\n" + (src / "present.js").read_text(encoding="utf-8") + "\n" + (src / "export.js").read_text(encoding="utf-8")
    safe = payload.replace("</", "<\\/")
    head = ('<title>Streaming Ops Simply.TV</title>\n<meta name="claude:viewport-fit-sides" content="cover">\n'
            f'<link rel="stylesheet" href="{FONTS}">\n<style>\n{css}\n</style>')
    script = f"<script>\nconst DATA = {safe};\n{js}\n</script>"
    (DASH / "artifact.html").write_text(f"{head}\n{html}\n{script}\n", encoding="utf-8")
    full = ("<!doctype html>\n<html lang=\"en\" data-theme=\"dark\">\n<head>\n<meta charset=\"utf-8\">\n"
            "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1,viewport-fit=cover\">\n"
            f"{head}\n<style>html{{color-scheme:dark}}body{{margin:0}}img{{max-width:100%}}[hidden]{{display:none!important}}</style>\n"
            f"</head>\n<body>\n{html}\n{script}\n</body>\n</html>\n")
    (DASH / "index.html").write_text(full, encoding="utf-8")
    print(f"dashboard/index.html {len(full) / 1024:.0f} KB | artifact.html {(DASH / 'artifact.html').stat().st_size / 1024:.0f} KB")


if __name__ == "__main__":
    main()
