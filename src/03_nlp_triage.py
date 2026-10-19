"""
03_nlp_triage.py
----------------
Automatic root-cause triage from the ticket's free text (EN / ES / PT).
Tickets with no category (~11%) are filled in with TF-IDF + logistic regression.
If confidence is low (<0.45) the ticket stays 'unclassified' instead of guessing.

Evaluated in two ways:
  1) hold-out on already-labeled tickets
  2) against the simulation ground truth on the tickets that were unlabeled
"""
import json
import sqlite3
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import accuracy_score, f1_score, confusion_matrix
from sklearn.model_selection import train_test_split
from sklearn.pipeline import make_pipeline

ROOT = Path(__file__).resolve().parents[1]
DB = ROOT / "data" / "processed" / "simplytv_ops.db"
OUT = ROOT / "outputs"
OUT.mkdir(exist_ok=True)
CONF_MIN = 0.45


def build_model():
    return make_pipeline(
        TfidfVectorizer(ngram_range=(1, 2), sublinear_tf=True, min_df=2, strip_accents="unicode", lowercase=True),
        LogisticRegression(C=6, max_iter=2000, class_weight="balanced"),
    )


def main():
    con = sqlite3.connect(DB)
    df = pd.read_sql("SELECT incident_id, notes, category_final, category_origin FROM fact_incident", con)
    lab = df[df["category_origin"] == "reported"]
    unl = df[df["category_final"].isna()]

    Xtr, Xte, ytr, yte = train_test_split(lab["notes"], lab["category_final"], test_size=.25,
                                          random_state=7, stratify=lab["category_final"])
    m = build_model().fit(Xtr, ytr)
    pred = m.predict(Xte)
    acc = accuracy_score(yte, pred)
    f1 = f1_score(yte, pred, average="macro")
    classes = sorted(lab["category_final"].unique())
    cm = confusion_matrix(yte, pred, labels=classes)
    per_class = {c: round(float(f1_score(yte, pred, labels=[c], average="macro")), 3) for c in classes}

    # final model with all labeled data
    m = build_model().fit(lab["notes"], lab["category_final"])
    proba = m.predict_proba(unl["notes"])
    best = proba.argmax(axis=1)
    conf = proba.max(axis=1)
    label = np.where(conf >= CONF_MIN, m.classes_[best], "unclassified")

    # validation against simulation ground truth (only possible because the data is synthetic)
    truth = pd.read_csv(ROOT / "data" / "raw" / "sim_truth_incidents.csv").set_index("incident_id")["true_category"]
    t = unl["incident_id"].map(truth)
    conf_mask = conf >= CONF_MIN
    acc_truth_all = float((m.classes_[best] == t.values).mean())
    acc_truth_conf = float((m.classes_[best][conf_mask] == t.values[conf_mask]).mean())

    cur = con.cursor()
    cur.executemany(
        "UPDATE fact_incident SET category_final=?, category_origin='nlp_triage', category_conf=? WHERE incident_id=?",
        [(str(l), float(round(c, 4)), i) for l, c, i in zip(label, conf, unl["incident_id"])])
    con.commit()

    res = dict(
        n_labeled=int(len(lab)), n_unlabeled=int(len(unl)),
        holdout_accuracy=round(float(acc), 4), holdout_macro_f1=round(float(f1), 4),
        per_class_f1=per_class, classes=classes, confusion=cm.tolist(),
        imputed_confident=int(conf_mask.sum()), imputed_unclassified=int((~conf_mask).sum()),
        conf_threshold=CONF_MIN,
        acc_vs_truth_all=round(acc_truth_all, 4), acc_vs_truth_confident=round(acc_truth_conf, 4),
        model="TF-IDF (1-2 gramas) + LogisticRegression (class_weight=balanced)",
    )
    (OUT / "nlp_triage.json").write_text(json.dumps(res, indent=2, ensure_ascii=False))
    print(json.dumps({k: v for k, v in res.items() if k not in ("confusion",)}, indent=2, ensure_ascii=False))
    con.close()


if __name__ == "__main__":
    main()
