"""
10_alert_simulation.py -- what would proactive alerting have caught?
Replays every delivery and compares three alert rules against the incidents that really happened.
A delivery is "covered" if the rule fires on it AND an incident for that feed opened within 72 h after it.
Output: outputs/alert_sim.json
"""
import json, sqlite3
from pathlib import Path
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
con = sqlite3.connect(ROOT / "data" / "processed" / "simplytv_ops.db")
d = pd.read_sql("select feed_id, delivery_ts, delivery_date, status, completeness, schema_version, checksum, is_bad from v_delivery", con)
inc = pd.read_sql("select incident_id, feed_id, opened_at, detection from v_incident", con)
d["ts"] = pd.to_datetime(d.delivery_ts); inc["ts"] = pd.to_datetime(inc.opened_at)
d = d.sort_values(["feed_id", "ts"])
prev = d.groupby("feed_id").schema_version.shift()
d["schema_change"] = prev.notna() & (prev != d.schema_version)
d["checksum_bad"] = d.checksum.astype(str).str.upper().str.contains("MISMATCH")

rules = {
    "R1 status FAILED only": d.status.eq("FAILED"),
    "R2 FAILED or DEGRADED": d.status.isin(["FAILED", "DEGRADED"]),
    "R3 R2 + completeness<92% + schema change + checksum mismatch": d.status.isin(["FAILED", "DEGRADED"]) | (d.completeness < 0.92) | d.schema_change | d.checksum_bad,
}
# incidents first detected by the client (the painful ones)
client = inc[inc.detection.astype(str).str.lower().str.contains("client")]
days = d.delivery_date.nunique()
by_feed = {f: g.ts.values for f, g in inc.groupby("feed_id")}
out = []
for name, mask in rules.items():
    a = d[mask]
    hit = a.apply(lambda r: ((by_feed.get(r.feed_id, []) >= r.ts.to_datetime64()) & (by_feed.get(r.feed_id, []) <= (r.ts + pd.Timedelta(hours=72)).to_datetime64())).any() if r.feed_id in by_feed else False, axis=1)
    out.append(dict(rule=name, alerts=int(len(a)), alerts_per_day=round(len(a) / days, 1),
                    precision=round(float(hit.mean()), 3) if len(a) else 0.0, alerts_followed_by_incident=int(hit.sum())))
res = dict(period_days=int(days), incidents=int(len(inc)), client_detected=int(len(client)), rules=out,
           note="Precision = share of alerts followed by a real incident on the same feed within 72 h. Synthetic data.")
(ROOT / "outputs" / "alert_sim.json").write_text(json.dumps(res, indent=1))
for r in out:
    print(r)
