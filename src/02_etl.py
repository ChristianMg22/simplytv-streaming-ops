"""
02_etl.py
---------
EXTRACT  : CSV (catalog) · XML (public milestones) · .gz text log (deliveries) · JSONL (incidents)
TRANSFORM: regex parsing, format/category normalization, deduplication,
           data-quality rules and recovery of missing fields
LOAD     : SQLite (star schema) + data-quality log (dq_log)
"""
import gzip
import json
import re
import sqlite3
import xml.etree.ElementTree as ET
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "data" / "raw"
DB = ROOT / "data" / "processed" / "simplytv_ops.db"
DB.parent.mkdir(parents=True, exist_ok=True)

SLA = {"P1": dict(Gold=4, Silver=8, Bronze=12), "P2": dict(Gold=8, Silver=16, Bronze=24),
       "P3": dict(Gold=24, Silver=48, Bronze=72), "P4": dict(Gold=72, Silver=120, Bronze=168)}
CAT_KEYS = {"sourceoutage": "source_outage", "schemadrift": "schema_drift", "duplicateids": "duplicate_ids",
            "staleschedule": "stale_schedule", "imagegap": "image_gap", "mappingerror": "mapping_error",
            "deliveryendpoint": "delivery_endpoint", "clientconfig": "client_config"}
SEV_WORDS = {"critical": "P1", "high": "P2", "medium": "P3", "low": "P4"}

dq = []  # (step, metric, value)


def log_dq(step, metric, value):
    dq.append((step, metric, float(value)))


# ----------------------------------------------------------------------------- EXTRACT
def extract_catalog():
    clients = pd.read_csv(RAW / "clients.csv", dtype=str)
    feeds = pd.read_csv(RAW / "feeds.csv")
    return clients, feeds


def extract_events():
    root = ET.parse(RAW / "events.xml").getroot()
    rows = [dict(event_id=e.get("id"), event_date=e.get("date"), name=(e.text or "").strip(), kind=e.get("kind"),
                 region_scope=e.get("region_scope"), url=e.get("url")) for e in root.iter("event")]
    return pd.DataFrame(rows)


LOG_RE = re.compile(r"^(?P<ts>\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z) (?P<lvl>INFO|WARN|ERROR) "
                    r"feed=(?P<feed_id>F-\d+) client=(?P<client_id>C-\d+) status=(?P<status>OK|DEGRADED|FAILED) "
                    r"records=(?P<records>\d+) expected=(?P<expected>\d+) latency_s=(?P<latency_s>\d+) "
                    r"schema=(?P<schema>\S+) checksum=(?P<checksum>\S+)$")


def extract_deliveries():
    rows, total, debug, bad = [], 0, 0, 0
    with gzip.open(RAW / "deliveries.log.gz", "rt", encoding="utf-8") as fh:
        for line in fh:
            line = line.rstrip("\n")
            if not line:
                continue
            total += 1
            m = LOG_RE.match(line)
            if m:
                rows.append(m.groupdict())
            elif " DEBUG " in line:
                debug += 1
            else:
                bad += 1
    log_dq("deliveries", "log_lines_total", total)
    log_dq("deliveries", "log_lines_debug_skipped", debug)
    log_dq("deliveries", "log_lines_malformed_rejected", bad)
    return pd.DataFrame(rows)


def extract_incidents():
    with open(RAW / "incidents_raw.jsonl", encoding="utf-8") as fh:
        rows = [json.loads(l) for l in fh if l.strip()]
    return pd.DataFrame(rows)


# ----------------------------------------------------------------------------- TRANSFORM
def parse_ts(v):
    """Four source formats. Documented rule: dd/mm/yyyy is DAY first."""
    if v is None or (isinstance(v, float) and pd.isna(v)):
        return pd.NaT, "null"
    if isinstance(v, (int, float)):
        return pd.to_datetime(int(v), unit="s"), "epoch"
    s = str(v).strip()
    if re.match(r"^\d{4}-\d{2}-\d{2}T", s):
        return pd.to_datetime(s, utc=True).tz_localize(None), "iso"
    if re.match(r"^\d{2}/\d{2}/\d{4} \d{2}:\d{2}$", s):
        return pd.to_datetime(s, format="%d/%m/%Y %H:%M"), "dmy"
    try:
        return pd.to_datetime(s, format="%b %d, %Y %I:%M %p"), "mon_text"
    except ValueError:
        return pd.NaT, "unparseable"


def norm_cat(v):
    if v is None or (isinstance(v, float) and pd.isna(v)):
        return None
    return CAT_KEYS.get(re.sub(r"[^a-z]", "", str(v).lower()))


def norm_sev(v):
    s = str(v).strip().lower()
    if s in SEV_WORDS:
        return SEV_WORDS[s]
    m = re.search(r"([1-4])", s)
    return f"P{m.group(1)}" if m else None


def norm_team(v):
    s = str(v).lower()
    if s.startswith("dev"):
        return "Development"
    if s.startswith("ops") or s.startswith("operations"):
        return "Operations"
    return "Streaming"


def transform_catalog(clients, feeds):
    fixes = int((clients["tier"] != clients["tier"].str.strip().str.title()).sum() +
                (clients["region"] != clients["region"].str.strip()).sum())
    clients["tier"] = clients["tier"].str.strip().str.title()
    clients["region"] = clients["region"].str.strip()
    log_dq("catalog", "format_fixes_clients", fixes)
    return clients, feeds


def transform_deliveries(df):
    n0 = len(df)
    df = df.drop_duplicates(subset=["feed_id", "ts"], keep="first").copy()
    log_dq("deliveries", "duplicate_lines_removed", n0 - len(df))
    df["delivery_ts"] = pd.to_datetime(df["ts"], utc=True).dt.tz_localize(None)
    df["delivery_date"] = df["delivery_ts"].dt.strftime("%Y-%m-%d")
    for c in ["records", "expected", "latency_s"]:
        df[c] = df[c].astype(int)
    df["completeness"] = (df["records"] / df["expected"]).round(4)
    df = df.drop_duplicates(subset=["feed_id", "delivery_date"], keep="last")
    df["delivery_ts"] = df["delivery_ts"].dt.strftime("%Y-%m-%d %H:%M:%S")
    out = df.rename(columns={"records": "records_delivered", "expected": "records_expected",
                             "schema": "schema_version"})[
        ["feed_id", "client_id", "delivery_ts", "delivery_date", "status", "records_delivered",
         "records_expected", "latency_s", "schema_version", "checksum", "completeness"]]
    log_dq("deliveries", "rows_loaded", len(out))
    return out


def transform_incidents(raw, feeds):
    n_raw = len(raw)
    log_dq("incidents", "raw_rows", n_raw)
    raw = raw.drop_duplicates(subset=["id"], keep="first").copy()
    log_dq("incidents", "duplicates_removed", n_raw - len(raw))

    o = raw["opened"].map(parse_ts)
    c = raw["closed"].map(parse_ts)
    raw["opened_at"] = [x[0] for x in o]
    raw["closed_at"] = [x[0] for x in c]
    fmt_counts = pd.Series([x[1] for x in o]).value_counts()
    for k, v in fmt_counts.items():
        log_dq("incidents", f"opened_format_{k}", v)

    raw["category_raw"] = raw["cat"]
    raw["category_final"] = raw["cat"].map(norm_cat)
    miss = raw["category_final"].isna()
    log_dq("incidents", "category_missing_or_unknown", miss.sum())
    raw["category_origin"] = None
    raw.loc[~miss, "category_origin"] = "reported"

    raw["severity"] = raw["sev"].map(norm_sev)
    raw["detection"] = raw["src"].str.lower().str.contains("client|customer").map({True: "client", False: "auto"})
    raw["team"] = raw["team"].map(norm_team)
    raw["escalated"] = raw["esc"].map(lambda v: 1 if str(v).strip().lower() in ("true", "y", "1") else 0)

    # recover null client_id from the feed catalog (referential integrity)
    fmap = feeds.set_index("feed_id")["client_id"]
    nul = raw["client"].isna()
    raw.loc[nul, "client"] = raw.loc[nul, "feed"].map(fmap)
    log_dq("incidents", "client_id_recovered_from_feed", nul.sum())

    raw["dq_flag"] = None
    neg = raw["closed_at"].notna() & (raw["closed_at"] < raw["opened_at"])
    raw.loc[neg, "dq_flag"] = "negative_duration"
    log_dq("incidents", "negative_duration_flagged", neg.sum())
    log_dq("incidents", "still_open_at_cutoff", (raw["closed_at"].isna()).sum())
    bad_ref = ~raw["feed"].isin(fmap.index)
    log_dq("incidents", "orphan_feed_rows_dropped", bad_ref.sum())
    raw = raw[~bad_ref]

    for col in ["opened_at", "closed_at"]:
        raw[col] = raw[col].dt.strftime("%Y-%m-%d %H:%M:%S").where(raw[col].notna(), None)
    out = raw.rename(columns={"id": "incident_id", "feed": "feed_id", "client": "client_id",
                              "first_resp_min": "first_response_min"})[
        ["incident_id", "feed_id", "client_id", "opened_at", "closed_at", "category_raw", "category_final",
         "category_origin", "severity", "detection", "team", "escalated", "first_response_min", "notes", "dq_flag"]]
    log_dq("incidents", "rows_loaded", len(out))
    return out


# ----------------------------------------------------------------------------- LOAD
def load(con, clients, feeds, events, deliveries, incidents):
    con.executescript((ROOT / "sql" / "schema.sql").read_text())
    clients[["client_id", "client_name", "segment", "region", "tier", "onboard_date"]].to_sql(
        "dim_client", con, if_exists="append", index=False)
    feeds.to_sql("dim_feed", con, if_exists="append", index=False)
    sla = pd.DataFrame([(s, t, h) for s, d in SLA.items() for t, h in d.items()],
                       columns=["severity", "tier", "sla_hours"])
    sla.to_sql("dim_sla", con, if_exists="append", index=False)
    events.to_sql("dim_event", con, if_exists="append", index=False)
    er = pd.DataFrame([(r.event_id, reg) for r in events.itertuples() for reg in r.region_scope.split("|")
                       if r.region_scope != "ALL"], columns=["event_id", "region"])
    er.to_sql("dim_event_region", con, if_exists="append", index=False)
    deliveries.to_sql("fact_delivery", con, if_exists="append", index=False)
    incidents.to_sql("fact_incident", con, if_exists="append", index=False)
    pd.DataFrame(dq, columns=["step", "metric", "value"]).to_sql("dq_log", con, if_exists="append", index=False)
    con.executescript((ROOT / "sql" / "views.sql").read_text())
    con.commit()


def main():
    clients, feeds = extract_catalog()
    events = extract_events()
    deliveries_raw = extract_deliveries()
    incidents_raw = extract_incidents()
    clients, feeds = transform_catalog(clients, feeds)
    deliveries = transform_deliveries(deliveries_raw)
    incidents = transform_incidents(incidents_raw, feeds)
    if DB.exists():
        DB.unlink()
    con = sqlite3.connect(DB)
    load(con, clients, feeds, events, deliveries, incidents)
    # quick integrity check
    chk = con.execute("PRAGMA foreign_key_check").fetchall()
    print("FK violations:", len(chk))
    for t in ["dim_client", "dim_feed", "dim_event", "fact_delivery", "fact_incident"]:
        print(f"{t:15s}", con.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0])
    print(pd.read_sql("SELECT step, metric, value FROM dq_log", con).to_string(index=False))
    con.close()


if __name__ == "__main__":
    main()
