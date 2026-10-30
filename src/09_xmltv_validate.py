"""
09_xmltv_validate.py -- validate an EPG file in XMLTV format (the de-facto XML format for TV guides).

    python src/09_xmltv_validate.py data/raw/sample_xmltv.xml

Checks, in the order an analyst would run them when "the EPG looks wrong":
  1. well-formed XML                  2. every programme points to a declared channel
  3. title present                    4. start/stop parse, and stop is after start
  5. overlaps on the same channel     6. gaps longer than 30 minutes
The sample file is hand-written to the XMLTV structure and has 3 planted defects (it is NOT real broadcaster data).
"""
import sys
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FMT = "%Y%m%d%H%M%S %z"


def parse_ts(v):
    try:
        return datetime.strptime(v, FMT)
    except (TypeError, ValueError):
        return None


def validate(path):
    try:
        root = ET.parse(path).getroot()
    except ET.ParseError as e:
        return [dict(rule="well_formed", where="file", detail=str(e))]
    issues, channels, by_ch = [], {c.get("id") for c in root.iter("channel")}, {}
    for i, p in enumerate(root.iter("programme"), 1):
        ch, title = p.get("channel"), (p.findtext("title") or "").strip()
        s, e = parse_ts(p.get("start")), parse_ts(p.get("stop"))
        where = f"programme #{i} ({ch})"
        if ch not in channels:
            issues.append(dict(rule="unknown_channel", where=where, detail=f"channel '{ch}' is not declared"))
        if not title:
            issues.append(dict(rule="missing_title", where=where, detail="no <title>"))
        if s is None or e is None:
            issues.append(dict(rule="bad_timestamp", where=where, detail=f"start={p.get('start')} stop={p.get('stop')}")); continue
        if e <= s:
            issues.append(dict(rule="stop_before_start", where=where, detail=f"{s:%H:%M} -> {e:%H:%M}")); continue
        by_ch.setdefault(ch, []).append((s, e, title))
    for ch, items in by_ch.items():
        items.sort()
        for (s1, e1, t1), (s2, e2, t2) in zip(items, items[1:]):
            if s2 < e1:
                issues.append(dict(rule="overlap", where=ch, detail=f"'{t1}' ends {e1:%H:%M}, '{t2}' starts {s2:%H:%M}"))
            elif s2 - e1 > timedelta(minutes=30):
                issues.append(dict(rule="gap", where=ch, detail=f"{(s2 - e1).seconds // 60} min without programmes before {s2:%H:%M}"))
    return issues


if __name__ == "__main__":
    f = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "data" / "raw" / "sample_xmltv.xml"
    res = validate(f)
    print(f"{f.name}: {len(res)} issue(s)")
    for x in res:
        print(f"  [{x['rule']}] {x['where']}: {x['detail']}")
