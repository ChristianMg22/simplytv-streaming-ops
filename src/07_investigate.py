"""
07_investigate.py  --  the analyst's day-to-day tool: investigate ONE feed end to end.

    python src/07_investigate.py F-0062                # last bad day of the feed
    python src/07_investigate.py F-0062 --as-of 2026-08-29 --days 14
    python src/07_investigate.py --top 3               # write case files for the 3 noisiest feeds

What it does (the job description, step by step):
  1. EXTRACT   raw feed log (gz, with junk lines) parsed with a tolerant regex  -> Python
  2. BASELINE  the feed's normal behavior from SQLite (median volume / latency)  -> SQL
  3. DETECT    symptoms in the window: failed deliveries, completeness drop, latency spike,
               schema change, checksum mismatch, missing days
  4. DIAGNOSE  rank root-cause hypotheses with the evidence behind each one
  5. DECIDE    resolve on our side vs escalate (to Development / Operations)
  6. COMMUNICATE  writes a technical escalation ticket + a plain-language client message
Output: outputs/investigations/<feed>.md  and  outputs/investigations.json (dashboard input).
The rules are transparent heuristics (not a model): every conclusion lists its evidence.
"""
import argparse
import gzip
import json
import re
import sqlite3
import statistics as st
from datetime import date, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DB = ROOT / "data" / "processed" / "simplytv_ops.db"
LOG = ROOT / "data" / "raw" / "deliveries.log.gz"
OUT = ROOT / "outputs"

LINE = re.compile(r"^(?P<ts>\d{4}-\d\d-\d\dT[\d:]+Z)\s+(?P<lvl>[A-Z]+)\s+feed=(?P<feed>F-\d+)\s+client=(?P<client>C-\d+)\s+"
                  r"status=(?P<status>\w+)\s+records=(?P<records>\d+)\s+expected=(?P<expected>\d+)\s+"
                  r"latency_s=(?P<latency>\d+)\s+schema=(?P<schema>v[\d.]+)\s+checksum=(?P<checksum>\w+)")


def parse_line(line):
    """One log line -> dict, or None for junk (heartbeats, truncated lines, garbage)."""
    m = LINE.match(line.strip())
    if not m:
        return None
    d = m.groupdict()
    for k in ("records", "expected", "latency"):
        d[k] = int(d[k])
    d["completeness"] = round(d["records"] / d["expected"], 4) if d["expected"] else 0.0
    d["date"] = d["ts"][:10]
    return d


def read_feed_log(feed_id, start, end):
    """Stream the gz log and keep only this feed inside [start, end]; also count unparseable lines."""
    rows, junk = [], 0
    with gzip.open(LOG, "rt", encoding="utf-8", errors="replace") as fh:
        for line in fh:
            if feed_id not in line:
                if line.strip() and "feed=" not in line:
                    junk += 1
                continue
            d = parse_line(line)
            if d is None:
                junk += 1
            elif start <= d["date"] <= end:
                rows.append(d)
    return rows, junk


def baseline(con, feed_id, before):
    """What 'normal' looks like for this feed: the 60 days before the window (SQL)."""
    q = """SELECT records_delivered, latency_s, completeness, schema_version
           FROM fact_delivery WHERE feed_id = ? AND status = 'OK' AND delivery_date < ?
           ORDER BY delivery_date DESC LIMIT 60"""
    r = con.execute(q, (feed_id, before)).fetchall()
    if not r:
        return None
    sv = st.mode([x[3] for x in r])
    return dict(n=len(r), records=st.median(x[0] for x in r), latency=st.median(x[1] for x in r),
                completeness=st.median(x[2] for x in r), schema=sv)


def detect(rows, base, start, end):
    """Symptoms found in the window, each with the evidence that supports it."""
    s = []
    failed = [r for r in rows if r["status"] == "FAILED"]
    if failed:
        s.append(dict(code="failed_deliveries", n=len(failed), evidence=f"{len(failed)} FAILED deliveries with 0 records on {', '.join(sorted({r['date'] for r in failed})[:4])}"))
    deg = [r for r in rows if r["status"] == "DEGRADED"]
    low = [r for r in deg if r["completeness"] < 0.92]
    if low:
        w = min(r["completeness"] for r in low)
        s.append(dict(code="completeness_drop", n=len(low), evidence=f"{len(low)} deliveries below 92% completeness (worst {w:.0%}) vs a normal {base['completeness']:.0%}" if base else f"{len(low)} deliveries below 92% completeness"))
    if base:
        slow = [r for r in rows if r["latency"] > 10 * base["latency"] and r["status"] != "FAILED"]
        if slow:
            s.append(dict(code="latency_spike", n=len(slow), evidence=f"{len(slow)} deliveries over 10x the normal latency ({base['latency']:.0f}s); max {max(r['latency'] for r in slow)}s"))
        ch = [r for r in rows if r["schema"] != base["schema"]]
        if ch:
            s.append(dict(code="schema_change", n=len(ch), evidence=f"schema changed {base['schema']} -> {ch[0]['schema']} on {ch[0]['date']}"))
    bad = [r for r in rows if r["checksum"] != "ok"]
    if bad:
        s.append(dict(code="checksum_mismatch", n=len(bad), evidence=f"{len(bad)} deliveries with checksum MISMATCH (payload differs from what was announced)"))
    d0, d1 = date.fromisoformat(start), date.fromisoformat(end)
    seen = {r["date"] for r in rows}
    gaps = [(d0 + timedelta(i)).isoformat() for i in range((d1 - d0).days + 1) if (d0 + timedelta(i)).isoformat() not in seen]
    if rows and len(gaps) >= 2:
        s.append(dict(code="missing_days", n=len(gaps), evidence=f"no delivery logged on {len(gaps)} of {(d1 - d0).days + 1} days"))
    return s


# What delivery telemetry can (and cannot) tell apart. Measured on the 5,485 incidents (see 08_validate_investigator.py):
# schema changes are visible in the log (v3.2 / checksum), outages and endpoint problems both show FAILED or >10x latency,
# and content problems (mapping, images, stale schedules, duplicate IDs) all look like "arrived but incomplete".
# So the investigator narrows to a FAMILY with evidence and lists the candidate causes inside it; payload/ticket text decides.
FAMILY = {"schema_drift": "schema", "source_outage": "transport", "delivery_endpoint": "transport",
          "mapping_error": "content", "image_gap": "content", "stale_schedule": "content", "duplicate_ids": "content", "client_config": "content"}
# symptom -> (family, weight)
RULES = {"schema_change": ("schema", 3), "checksum_mismatch": ("schema", 2), "failed_deliveries": ("transport", 3),
         "latency_spike": ("transport", 2), "completeness_drop": ("content", 2), "missing_days": ("content", 1)}
FAMILY_INFO = {
    "schema": ("Development", "the payload structure changed (new schema version / checksum mismatch) and the mapping was not updated", ["schema_drift"]),
    "transport": ("Operations", "the data did not arrive or arrived extremely late: upstream source or delivery endpoint problem", ["source_outage", "delivery_endpoint"]),
    "content": ("Development", "data arrived but incomplete: a mapping, artwork, schedule or ID problem inside the payload", ["mapping_error", "stale_schedule", "image_gap", "duplicate_ids", "client_config"]),
}
FEED_HINT = {"ARTWORK": "image_gap", "EPG_LINEAR": "stale_schedule", "SPORTS": "stale_schedule"}


def diagnose(symptoms, feed_type):
    fam = {}
    for sy in symptoms:
        f, w = RULES[sy["code"]]
        e = fam.setdefault(f, dict(family=f, score=0, evidence=[]))
        e["score"] += w * (2 if sy["n"] >= 3 else 1)
        e["evidence"].append(sy["evidence"])
    ranked = []
    for f, e in sorted(fam.items(), key=lambda x: -x[1]["score"]):
        owner, why, cands = FAMILY_INFO[f]
        cands = list(cands)
        if f == "content" and FEED_HINT.get(feed_type) in cands:
            cands.insert(0, cands.pop(cands.index(FEED_HINT[feed_type])))
        ranked.append(dict(e, owner=owner, why=why, candidates=cands, cause=cands[0],
                           confidence="high" if e["score"] >= 6 else "medium" if e["score"] >= 3 else "low"))
    return ranked


def decide(ranked):
    if not ranked:
        return "No action", "No anomaly in the window: nothing to resolve or escalate."
    top = ranked[0]
    if top["confidence"] == "low":
        return "Resolve (Analyst)", "Low blast radius: verify the client configuration / schedule and confirm with the client."
    return f"Escalate to {top['owner']}", f"Root cause points to a system-side issue ({top['family']}); needs a fix outside the analyst's scope."


def ticket(feed, client, ctx, symptoms, ranked, action):
    top = ranked[0] if ranked else None
    L = [f"# Escalation: feed {feed} ({ctx['feed_type']}) · client {client}", "",
         f"**Window:** {ctx['start']} → {ctx['end']}  |  **Decision:** {action[0]}", "",
         f"**Diagnosis:** {top['family']} problem ({top['confidence']} confidence): {top['why']}. Candidate causes: {', '.join('`'+c+'`' for c in top['candidates'][:3])}." if top else "**Diagnosis:** none", "",
         "## Evidence"] + [f"- {e}" for sy in symptoms for e in [sy["evidence"]]]
    L += ["", "## Hypotheses (ranked)"] + [f"{i}. {r['family']}: score {r['score']}, {r['confidence']}, owner {r['owner']}, candidates {', '.join(r['candidates'][:3])}" for i, r in enumerate(ranked, 1)]
    L += ["", "## What the analyst already checked",
          f"- Parsed the raw delivery log for {feed} ({ctx['n_log']} lines, {ctx["junk"]} junk lines in the whole log skipped).",
          f"- Compared against a baseline of {ctx['base']['n']} healthy deliveries (median {ctx['base']['records']:.0f} records, {ctx['base']['latency']:.0f}s)." if ctx["base"] else "- No healthy baseline available.",
          f"- Past incidents on this feed: {ctx['history']}.", "", "## Ask",
          f"- {action[1]}", "- Please confirm the root cause and an ETA so the client can be updated."]
    return "\n".join(L)


def client_message(feed, ctx, ranked, action):
    plain = {"schema_drift": "the structure of the data we receive changed, so part of it could not be processed correctly",
             "source_outage": "our data provider did not send the expected files",
             "delivery_endpoint": "the files arrived later than usual because of a transfer problem",
             "mapping_error": "some records were not matched correctly while processing",
             "image_gap": "some artwork was missing from the delivery",
             "stale_schedule": "part of the schedule data was not refreshed in time",
             "client_config": "the delivery settings for your feed may need a small update"}
    if not ranked:
        return f"Hi, we reviewed feed {feed} for {ctx['start']} to {ctx['end']} and found no issues. Let us know if you still see something unexpected."
    c = ranked[0]["cause"]
    nxt = "We are already working on the fix and will confirm as soon as it is deployed." if action[0].startswith("Escalate") else "We are applying the correction on our side and will confirm shortly."
    return (f"Hi, thanks for your patience. We investigated feed {feed} between {ctx['start']} and {ctx['end']}. "
            f"In short, {plain.get(c, 'we found an irregularity in the delivery')}. {nxt} "
            "Your data from other days is not affected, and we will send one more update with the result.")


def investigate(feed_id, as_of=None, days=14, con=None):
    con = con or sqlite3.connect(DB)
    f = con.execute("SELECT feed_type, client_id FROM dim_feed WHERE feed_id = ?", (feed_id,)).fetchone()
    if not f:
        raise SystemExit(f"unknown feed {feed_id}")
    if as_of is None:
        as_of = con.execute("SELECT MAX(delivery_date) FROM fact_delivery WHERE feed_id = ? AND status != 'OK'", (feed_id,)).fetchone()[0]
    end = as_of
    start = (date.fromisoformat(end) - timedelta(days=days - 1)).isoformat()
    rows, junk = read_feed_log(feed_id, start, end)
    base = baseline(con, feed_id, start)
    symptoms = detect(rows, base, start, end)
    ranked = diagnose(symptoms, f[0])
    action = decide(ranked)
    hist = dict(con.execute("SELECT category, COUNT(*) FROM v_incident WHERE feed_id = ? GROUP BY 1 ORDER BY 2 DESC", (feed_id,)).fetchall())
    ctx = dict(feed_type=f[0], start=start, end=end, n_log=len(rows), junk=junk, base=base,
               history=", ".join(f"{k} x{v}" for k, v in list(hist.items())[:4]) or "none")
    return dict(feed=feed_id, client=f[1], ctx=ctx, symptoms=symptoms, ranked=ranked, action=action,
                ticket=ticket(feed_id, f[1], ctx, symptoms, ranked, action), client_message=client_message(feed_id, ctx, ranked, action))


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("feed", nargs="?")
    ap.add_argument("--as-of")
    ap.add_argument("--days", type=int, default=14)
    ap.add_argument("--top", type=int, help="write case files for the N feeds with the most incidents")
    a = ap.parse_args()
    con = sqlite3.connect(DB)
    feeds = [r[0] for r in con.execute("SELECT feed_id FROM v_incident GROUP BY 1 ORDER BY COUNT(*) DESC LIMIT ?", (a.top,))] if a.top else [a.feed]
    if not feeds or feeds == [None]:
        ap.error("give a feed id or --top N")
    (OUT / "investigations").mkdir(parents=True, exist_ok=True)
    cases = []
    for fd in feeds:
        r = investigate(fd, a.as_of, a.days, con)
        (OUT / "investigations" / f"{fd}.md").write_text(r["ticket"] + "\n\n## Client message\n\n> " + r["client_message"] + "\n", encoding="utf-8")
        cases.append({k: v for k, v in r.items() if k != "ctx"} | {"ctx": {k: v for k, v in r["ctx"].items() if k != "base"}})
        print(f"{fd}: {r['action'][0]} | " + (f"{r['ranked'][0]['family']} -> {r['ranked'][0]['cause']} ({r['ranked'][0]['confidence']})" if r["ranked"] else "no anomaly"))
    if a.top:
        (OUT / "investigations.json").write_text(json.dumps(cases, ensure_ascii=False), encoding="utf-8")
    elif len(feeds) == 1:
        print("\n" + r["ticket"] + "\n\nClient message:\n" + r["client_message"])


if __name__ == "__main__":
    main()
