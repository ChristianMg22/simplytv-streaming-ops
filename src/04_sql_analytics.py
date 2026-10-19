"""
04_sql_analytics.py
-------------------
Runs each '-- name: x' block of sql/analytics.sql against SQLite and saves the result
to outputs/sql_results.json (dashboard input) + outputs/dq_report.json.
"""
import json
import re
import sqlite3
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
DB = ROOT / "data" / "processed" / "simplytv_ops.db"
OUT = ROOT / "outputs"
OUT.mkdir(exist_ok=True)


def split_queries(text):
    parts = re.split(r"^-- name:\s*(\w+)\s*$", text, flags=re.M)
    return {parts[i]: parts[i + 1].strip() for i in range(1, len(parts), 2)}


def to_records(df):
    return json.loads(df.to_json(orient="records"))


def main():
    con = sqlite3.connect(DB)
    qs = split_queries((ROOT / "sql" / "analytics.sql").read_text())
    res = {}
    for name, q in qs.items():
        df = pd.read_sql(q, con)
        res[name] = to_records(df)
        print(f"{name:20s} -> {len(df):3d} rows")
    res["kpi_overview"] = res["kpi_overview"][0]
    (OUT / "sql_results.json").write_text(json.dumps(res, indent=1, ensure_ascii=False))

    dq = pd.read_sql("SELECT step, metric, value FROM dq_log", con)
    (OUT / "dq_report.json").write_text(json.dumps(to_records(dq), indent=1))

    # quick look
    print("\nKPIs:", json.dumps(res["kpi_overview"], indent=1))
    for k in ["category_pareto", "event_impact", "missed_failures", "detection_summary", "detection_delay",
              "client_pareto", "feed_age_effect", "region_summary"]:
        print(f"\n== {k}")
        print(pd.DataFrame(res[k]).to_string(index=False))
    con.close()


if __name__ == "__main__":
    main()
