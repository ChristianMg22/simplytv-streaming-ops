"""
api.py -- a small read-only HTTP API over the investigator (FastAPI). Runs locally, no hosting and no cost:

    pip install -r requirements.txt
    uvicorn src.api:app --reload            # then open http://127.0.0.1:8000/docs  (interactive docs)

    GET /health
    GET /kpis                               overall KPIs (from the SQL layer)
    GET /feeds?feed_type=EPG_LINEAR&limit=20
    GET /feeds/F-0062/diagnosis?as_of=2026-08-29&days=14     JSON: symptoms, ranked hypotheses, decision
    GET /feeds/F-0062/ticket?as_of=2026-08-29                escalation ticket (markdown) + client message

It reuses src/07_investigate.py, so the CLI, the dashboard lab and the API give the same answer.
"""
import importlib.util
import json
import re
import sqlite3
from pathlib import Path

from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import PlainTextResponse

ROOT = Path(__file__).resolve().parents[1]
_spec = importlib.util.spec_from_file_location("investigate", ROOT / "src" / "07_investigate.py")
inv = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(inv)

app = FastAPI(title="Simply.TV streaming ops (simulated data)", version="1.0",
              description="Read-only investigation API. All data is synthetic, anchored on public Simply.TV milestones.")
FEED = re.compile(r"^F-\d{4}$")
DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def _con():
    return sqlite3.connect(inv.DB)


def _check(feed_id, as_of=None):
    if not FEED.match(feed_id):
        raise HTTPException(422, "feed_id must look like F-0062")
    if as_of is not None and not DATE.match(as_of):
        raise HTTPException(422, "as_of must be YYYY-MM-DD")
    with _con() as con:
        if con.execute("SELECT 1 FROM dim_feed WHERE feed_id = ?", (feed_id,)).fetchone() is None:
            raise HTTPException(404, f"unknown feed {feed_id}")


@app.get("/health")
def health():
    with _con() as con:
        n = con.execute("SELECT COUNT(*) FROM fact_delivery").fetchone()[0]
    return {"status": "ok", "deliveries": n, "data": "synthetic"}


@app.get("/kpis")
def kpis():
    return json.loads((ROOT / "outputs" / "sql_results.json").read_text(encoding="utf-8"))["kpi_overview"]


@app.get("/feeds")
def feeds(feed_type: str | None = None, limit: int = Query(20, ge=1, le=200)):
    q = ("SELECT f.feed_id, f.client_id, f.feed_type, COUNT(i.incident_id) AS incidents FROM dim_feed f "
         "LEFT JOIN fact_incident i ON i.feed_id = f.feed_id WHERE (? IS NULL OR f.feed_type = ?) "
         "GROUP BY f.feed_id ORDER BY incidents DESC LIMIT ?")
    with _con() as con:
        rows = con.execute(q, (feed_type, feed_type, limit)).fetchall()
    return [dict(zip(("feed_id", "client_id", "feed_type", "incidents"), r)) for r in rows]


@app.get("/feeds/{feed_id}/diagnosis")
def diagnosis(feed_id: str, as_of: str | None = None, days: int = Query(14, ge=1, le=90)):
    _check(feed_id, as_of)
    with _con() as con:
        r = inv.investigate(feed_id, as_of, days, con)
    r["ctx"].pop("base", None)
    r.pop("ticket"), r.pop("client_message")
    return r


@app.get("/feeds/{feed_id}/ticket", response_class=PlainTextResponse)
def ticket(feed_id: str, as_of: str | None = None, days: int = Query(14, ge=1, le=90)):
    _check(feed_id, as_of)
    with _con() as con:
        r = inv.investigate(feed_id, as_of, days, con)
    return r["ticket"] + "\n\n## Client message\n\n> " + r["client_message"] + "\n"
