"""
08_validate_investigator.py -- does the rule-based investigator agree with what really happened?
Samples incidents, investigates the feed on the day the incident opened (3-day window) and compares the top-ranked
family with the family of the incident's final category (ground truth of the simulation). Writes outputs/investigator_eval.json.
"""
import importlib.util
import json
import random
import sqlite3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("inv", ROOT / "src" / "07_investigate.py")
inv = importlib.util.module_from_spec(spec); spec.loader.exec_module(inv)


def main(n=400, seed=11):
    con = sqlite3.connect(inv.DB)
    rows = con.execute("SELECT feed_id, open_date, category FROM v_incident WHERE category != 'unclassified' AND open_date >= '2024-01-01'").fetchall()
    random.Random(seed).shuffle(rows)
    hit = top3 = det = 0
    per, n_ok, conf = {}, 0, {}
    for feed, day, cat in rows[:n]:
        r = inv.investigate(feed, day, 3, con)
        top = r["ranked"][0] if r["ranked"] else None
        if top: conf[(inv.FAMILY[cat], top["family"])] = conf.get((inv.FAMILY[cat], top["family"]), 0) + 1
        n_ok += 1
        det += bool(top)
        ok = bool(top) and inv.FAMILY[cat] == top["family"]
        hit += ok
        top3 += bool(top) and cat in top["candidates"][:3]
        p = per.setdefault(cat, [0, 0]); p[1] += 1; p[0] += ok
    sym = sum(conf.values())
    fams = [f for (f, _), c in conf.items() for _ in range(c)]
    base_acc = max(fams.count(f) for f in set(fams)) / len(fams)
    prec = {f: round(sum(c for (t, p), c in conf.items() if p == f and t == f) / max(1, sum(c for (t, p), c in conf.items() if p == f)), 2) for f in ("schema", "transport", "content")}
    rec = {f: round(sum(c for (t, p), c in conf.items() if p == f and t == f) / max(1, sum(c for (t, p), c in conf.items() if t == f)), 2) for f in ("schema", "transport", "content")}
    res = dict(n=n_ok, detected=round(det / n_ok, 3), symptomatic_share=round(sym / n_ok, 3), family_accuracy_when_symptomatic=round(hit / sym, 3), majority_family_baseline=round(base_acc, 3), precision_by_family=prec, recall_by_family=rec, exact_cause_in_candidates=round(top3 / sym, 3),
               by_category={k: dict(n=v[1], family_accuracy=round(v[0] / v[1], 2)) for k, v in sorted(per.items())})
    (ROOT / "outputs" / "investigator_eval.json").write_text(json.dumps(res, indent=2), encoding="utf-8")
    print(json.dumps(res, indent=2))


if __name__ == "__main__":
    main()
