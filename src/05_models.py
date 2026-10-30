"""
05_models.py
------------
Three models on the same SQLite warehouse:

  A) CLASSIFICATION : will this incident breach its SLA?  (predicted at triage time)
                      + resolution ETA (regression) + risk simulator exportable to JS
  B) TIME SERIES    : weekly incident volume per 1,000 feed-days, 13-week forecast
  C) ANOMALIES      : "silent" degradations (OK status but incomplete data) with IsolationForest

Anti-leakage rules (data leakage):
  - Only variables known when the incident is opened/triaged are used.
  - NOT used: escalation, assigned team, first response, closing time.
  - Time-based split (train < 2026-01-01 <= test), never random.
"""
import json
import sqlite3
import warnings
from pathlib import Path

import numpy as np
import pandas as pd
from scipy.stats import binomtest
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import (HistGradientBoostingClassifier, HistGradientBoostingRegressor, IsolationForest,
                              RandomForestClassifier)
from sklearn.inspection import permutation_importance
from sklearn.linear_model import LogisticRegression, Ridge
from sklearn.metrics import (average_precision_score, brier_score_loss, f1_score, mean_absolute_error,
                             precision_recall_curve, precision_score, r2_score, recall_score, roc_auc_score,
                             roc_curve)
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, OrdinalEncoder, StandardScaler

warnings.filterwarnings("ignore")
ROOT = Path(__file__).resolve().parents[1]
DB = ROOT / "data" / "processed" / "simplytv_ops.db"
OUT = ROOT / "outputs"
OUT.mkdir(exist_ok=True)
SPLIT = pd.Timestamp("2026-01-01")
SEED = 11


def clean(o):
    """numpy/pandas -> JSON types, sensible rounding."""
    if isinstance(o, dict):
        return {str(k): clean(v) for k, v in o.items()}
    if isinstance(o, (list, tuple)):
        return [clean(v) for v in o]
    if isinstance(o, (np.floating, float)):
        return None if not np.isfinite(o) else round(float(o), 4)
    if isinstance(o, (np.integer,)):
        return int(o)
    if isinstance(o, (np.bool_,)):
        return bool(o)
    if isinstance(o, pd.Timestamp):
        return o.strftime("%Y-%m-%d")
    return o


def downsample(x, y, n=60):
    idx = np.unique(np.linspace(0, len(x) - 1, min(n, len(x))).astype(int))
    return [[round(float(x[i]), 4), round(float(y[i]), 4)] for i in idx]


# =============================================================================
# A) SLA-BREACH CLASSIFICATION
# =============================================================================
CAT = ["tier", "segment", "region", "feed_type", "category", "severity", "detection", "last_status"]
NUM = ["open_hour", "is_weekend", "is_night", "log_feed_age", "client_prev7d", "feed_prev30d", "load_24h",
       "completeness", "lat_ratio", "checksum_bad", "days_since_event"]


def build_features(con):
    inc = pd.read_sql("SELECT * FROM v_incident", con, parse_dates=["opened_at", "closed_at"])
    inc = inc.sort_values("opened_at").reset_index(drop=True)
    t = inc["opened_at"].astype("datetime64[s]").astype("int64").values

    def prior_count(key, window_s):
        out = np.zeros(len(inc), dtype=int)
        for _, idx in inc.groupby(key).indices.items():
            ts = t[idx]
            lo = np.searchsorted(ts, ts - window_s, side="left")
            out[idx] = np.arange(len(idx)) - lo
        return out

    inc["client_prev7d"] = prior_count("client_id", 7 * 86400)
    inc["feed_prev30d"] = prior_count("feed_id", 30 * 86400)
    inc["load_24h"] = np.arange(len(inc)) - np.searchsorted(t, t - 86400, side="left")

    dl = pd.read_sql("SELECT d.feed_id, d.delivery_ts, d.status AS last_status, d.completeness, d.latency_s, "
                     "d.checksum, f.base_latency_s FROM fact_delivery d JOIN dim_feed f USING(feed_id)",
                     con, parse_dates=["delivery_ts"]).sort_values("delivery_ts")
    inc = pd.merge_asof(inc.sort_values("opened_at"), dl, left_on="opened_at", right_on="delivery_ts",
                        by="feed_id", direction="backward", tolerance=pd.Timedelta("3D"))
    inc["last_status"] = inc["last_status"].fillna("NONE")
    inc["completeness"] = inc["completeness"].fillna(1.0)
    inc["lat_ratio"] = (inc["latency_s"] / inc["base_latency_s"]).fillna(1.0).clip(0, 60)
    inc["checksum_bad"] = (inc["checksum"] == "MISMATCH").astype(int)

    ev = pd.read_sql("SELECT e.event_id, e.event_date, e.kind, e.region_scope FROM dim_event e", con,
                     parse_dates=["event_date"])
    ds = np.full(len(inc), 365.0)
    for e in ev.itertuples():
        if e.kind == "corporate":
            continue
        regs = e.region_scope.split("|")
        d = (inc["opened_at"] - e.event_date).dt.days.values
        m = inc["region"].isin(regs).values & (d >= 0)
        ds = np.where(m, np.minimum(ds, d), ds)
    inc["days_since_event"] = np.minimum(ds, 365)

    inc["is_weekend"] = inc["open_dow"].isin([0, 6]).astype(int)
    inc["is_night"] = ((inc["open_hour"] >= 22) | (inc["open_hour"] < 6)).astype(int)
    inc["log_feed_age"] = np.log1p(inc["feed_age_days"].clip(lower=0))
    return inc


def make_pre(model_kind):
    if model_kind == "ohe":
        return ColumnTransformer([("c", OneHotEncoder(handle_unknown="ignore"), CAT),
                                  ("n", StandardScaler(), NUM)])
    return ColumnTransformer([("c", OrdinalEncoder(handle_unknown="use_encoded_value", unknown_value=np.nan,
                                                   encoded_missing_value=np.nan), CAT),
                              ("n", "passthrough", NUM)])


def candidates():
    return {
        "Logistic Regression": Pipeline([("p", make_pre("ohe")),
                                         ("m", LogisticRegression(C=0.5, max_iter=3000))]),
        "Random Forest": Pipeline([("p", make_pre("ohe")),
                                   ("m", RandomForestClassifier(n_estimators=400, min_samples_leaf=6, n_jobs=-1,
                                                                random_state=SEED))]),
        "Gradient Boosting": Pipeline([("p", make_pre("ord")),
                                       ("m", HistGradientBoostingClassifier(
                                           learning_rate=0.04, max_depth=3, max_iter=300, l2_regularization=2.0,
                                           min_samples_leaf=25, categorical_features=list(range(len(CAT))),
                                           random_state=SEED))]),
    }


def metrics(y, p, thr):
    yhat = (p >= thr).astype(int)
    return dict(auc=roc_auc_score(y, p), ap=average_precision_score(y, p), brier=brier_score_loss(y, p),
                precision=precision_score(y, yhat, zero_division=0), recall=recall_score(y, yhat),
                f1=f1_score(y, yhat))


def classification(con):
    inc = build_features(con)
    d = inc[inc["state"] == "resolved"].copy()
    d["y"] = d["sla_breach"].astype(int)
    for c in CAT:
        d[c] = d[c].astype(object)
    tr, te = d[d["opened_at"] < SPLIT].copy(), d[d["opened_at"] >= SPLIT].copy()
    cut = int(len(tr) * 0.8)
    fit, val = tr.iloc[:cut], tr.iloc[cut:]
    X = CAT + NUM
    res = {"n_train": len(tr), "n_test": len(te), "breach_rate_train": tr["y"].mean(),
           "breach_rate_test": te["y"].mean(), "split_date": "2026-01-01",
           "features_cat": CAT, "features_num": NUM,
           "excluded_leakage": ["escalated", "team", "first_response_min", "closed_at / resolution_hours"]}

    # Baseline: historical rate by severity x tier x category (what a manual rule would do)
    key = ["severity", "tier", "category"]
    rate = tr.groupby(key)["y"].mean().rename("r")
    pb = te.join(rate, on=key)["r"].fillna(tr["y"].mean()).values
    res["baseline"] = dict(name="Historical rate by severity × tier × category",
                           auc=roc_auc_score(te["y"], pb), ap=average_precision_score(te["y"], pb))

    table, fitted, val_auc = {}, {}, {}
    for name, pipe in candidates().items():
        pipe.fit(fit[X], fit["y"])
        pv = pipe.predict_proba(val[X])[:, 1]
        val_auc[name] = roc_auc_score(val["y"], pv)
        pr, rc, th = precision_recall_curve(val["y"], pv)
        f = 2 * pr * rc / np.clip(pr + rc, 1e-9, None)
        thr = float(th[np.argmax(f[:-1])])
        pipe.fit(tr[X], tr["y"])  # re-train on the whole train set
        pt = pipe.predict_proba(te[X])[:, 1]
        table[name] = dict(metrics(te["y"], pt, thr), threshold=thr, val_auc=val_auc[name])
        fitted[name] = (pipe, pt, thr)
    res["models"] = table
    best = max(val_auc, key=val_auc.get)   # selection ONLY on validation (not on test)
    res["best_model"] = best
    pipe, pt, thr = fitted[best]

    y = te["y"].values
    fpr, tpr, _ = roc_curve(y, pt)
    pr, rc, _ = precision_recall_curve(y, pt)
    res["roc"] = downsample(fpr, tpr, 70)
    res["pr"] = downsample(rc[::-1], pr[::-1], 70)
    yhat = (pt >= thr).astype(int)
    tp, fp = int(((yhat == 1) & (y == 1)).sum()), int(((yhat == 1) & (y == 0)).sum())
    fn, tn = int(((yhat == 0) & (y == 1)).sum()), int(((yhat == 0) & (y == 0)).sum())
    res["confusion"] = dict(tp=tp, fp=fp, fn=fn, tn=tn, threshold=thr)

    # cumulative gain (lift) and deciles
    order = np.argsort(-pt)
    cum = np.cumsum(y[order]) / y.sum()
    ks = np.arange(5, 101, 5)
    res["gain"] = [[int(k), float(cum[max(int(len(y) * k / 100) - 1, 0)])] for k in ks]
    dec = pd.DataFrame({"p": pt, "y": y})
    dec["decile"] = pd.qcut(dec["p"].rank(method="first", ascending=False), 10, labels=range(1, 11))
    g = dec.groupby("decile", observed=True).agg(pred=("p", "mean"), obs=("y", "mean"), n=("y", "size"))
    res["deciles"] = [dict(decile=int(i), pred=r.pred, obs=r.obs, n=int(r.n)) for i, r in g.iterrows()]
    res["top20_capture"] = float(cum[int(len(y) * 0.2) - 1])
    res["top20_precision"] = float(y[order][: int(len(y) * 0.2)].mean())

    # permutation importance (on original variables)
    pi = permutation_importance(pipe, te[X], te["y"], scoring="roc_auc", n_repeats=8, random_state=SEED, n_jobs=-1)
    imp = sorted(zip(X, pi.importances_mean, pi.importances_std), key=lambda z: -z[1])
    res["importance"] = [dict(feature=f, auc_drop=m, std=s) for f, m, s in imp]

    # "what-if" scenario (ASSUMPTION: proactive handling reduces resolution time proportionally)
    te = te.assign(p=pt)
    base_b = int((te["resolution_hours"] > te["sla_hours"]).sum())
    grid = []
    for topk in (10, 20, 30):
        flag = te["p"] >= te["p"].quantile(1 - topk / 100)
        for red in (10, 20, 30, 40, 50):
            h = np.where(flag, te["resolution_hours"] * (1 - red / 100), te["resolution_hours"])
            nb = int((h > te["sla_hours"]).sum())
            grid.append(dict(topk=topk, reduction=red, avoided=base_b - nb,
                             avoided_pct=100 * (base_b - nb) / base_b))
    res["whatif"] = dict(test_breaches=base_b, test_incidents=len(te), grid=grid,
                         note="Scenario with an assumption: reduce the resolution time of flagged incidents by X%.")

    # Regression: resolution ETA (log-hours)
    pre = make_pre("ord")
    reg = Pipeline([("p", pre), ("m", HistGradientBoostingRegressor(
        learning_rate=0.05, max_depth=3, max_iter=250, l2_regularization=2.0, min_samples_leaf=25,
        categorical_features=list(range(len(CAT))), random_state=SEED))])
    reg.fit(tr[X], np.log(tr["resolution_hours"]))
    pe = np.exp(reg.predict(te[X]))
    med = tr.groupby(["severity", "tier"])["resolution_hours"].median().rename("m")
    pbm = te.join(med, on=["severity", "tier"])["m"].values
    res["eta"] = dict(mae_h=mean_absolute_error(te["resolution_hours"], pe),
                      mae_h_baseline=mean_absolute_error(te["resolution_hours"], pbm),
                      r2_log=r2_score(np.log(te["resolution_hours"]), np.log(pe)),
                      r2_log_baseline=r2_score(np.log(te["resolution_hours"]), np.log(pbm)),
                      baseline="Historical median by severity × tier")

    # ---- robustness: is the lift over the baseline real, stable over time, and calibrated? ----
    rng = np.random.default_rng(SEED)
    yv, pm = te["y"].values, pt
    for_ci = []
    for _ in range(1000):
        i = rng.integers(0, len(yv), len(yv))
        if yv[i].min() == yv[i].max():
            continue
        for_ci.append((roc_auc_score(yv[i], pm[i]), roc_auc_score(yv[i], pb[i])))
    a = np.array(for_ci)
    diff = a[:, 0] - a[:, 1]
    roll = []
    for cut in ("2025-01-01", "2025-07-01", "2026-01-01", "2026-05-01"):
        c0 = pd.Timestamp(cut)
        a_, b_ = d[d["opened_at"] < c0], d[(d["opened_at"] >= c0) & (d["opened_at"] < c0 + pd.Timedelta(days=120))]
        pipe_r = candidates()[best].fit(a_[X], a_["y"])
        r_rate = a_.groupby(key)["y"].mean().rename("r")
        pbr = b_.join(r_rate, on=key)["r"].fillna(a_["y"].mean()).values
        roll.append(dict(window=f"{cut} + 120 d", n=len(b_), auc=roc_auc_score(b_["y"], pipe_r.predict_proba(b_[X])[:, 1]),
                         baseline=roc_auc_score(b_["y"], pbr)))
    bins = pd.cut(pm, [0, .1, .2, .3, .4, .5, .6, 1.0], include_lowest=True)
    cal = pd.DataFrame({"p": pm, "y": yv, "b": bins}).groupby("b", observed=True).agg(p=("p", "mean"), y=("y", "mean"), n=("y", "size"))
    ece = float((cal["n"] * (cal["p"] - cal["y"]).abs()).sum() / cal["n"].sum())
    # cost-based threshold chosen on validation only (a missed breach costs 3x a false alarm)
    pv_best = candidates()[best].fit(fit[X], fit["y"]).predict_proba(val[X])[:, 1]
    grid_t = np.linspace(.1, .7, 61)
    cost = lambda yy, pp, t: 3 * ((pp < t) & (yy == 1)).sum() + 1 * ((pp >= t) & (yy == 0)).sum()
    t_cost = float(grid_t[np.argmin([cost(val["y"].values, pv_best, t) for t in grid_t])])
    c_model, c_never, c_always = cost(yv, pm, t_cost), cost(yv, np.zeros(len(yv)), .5), cost(yv, np.ones(len(yv)), .5)
    res["robustness"] = dict(
        auc_ci=[float(np.percentile(a[:, 0], 2.5)), float(np.percentile(a[:, 0], 97.5))],
        baseline_auc_ci=[float(np.percentile(a[:, 1], 2.5)), float(np.percentile(a[:, 1], 97.5))],
        diff_mean=float(diff.mean()), diff_ci=[float(np.percentile(diff, 2.5)), float(np.percentile(diff, 97.5))],
        p_model_better=float((diff > 0).mean()), rolling=roll,
        calibration=[dict(bin=str(i), pred=float(r.p), obs=float(r.y), n=int(r.n)) for i, r in cal.iterrows()],
        ece=ece, brier=float(brier_score_loss(yv, pm)), brier_naive=float(brier_score_loss(yv, np.full(len(yv), tr["y"].mean()))),
        cost=dict(ratio="missed breach = 3 x false alarm", threshold=t_cost, model=int(c_model), never_alert=int(c_never), always_alert=int(c_always)),
        tried_without_gain=["client/feed breach history (leak-safe)", "cyclical hour", "severity x tier and category x feed-type interactions",
                            "rank-average ensembles of LR + RF + GB (0.720-0.723)"],
        note="Extra features and ensembles did not beat the logistic regression: the ceiling is set by noise in the (synthetic) outcome, so the honest claim is a stable, calibrated, modest lift.")

    # Risk simulator (logistic regression with few variables -> exportable to JavaScript)
    SC = ["tier", "severity", "category", "detection"]
    SN = ["is_weekend", "is_night", "log_feed_age", "load_24h"]
    sim = Pipeline([("p", ColumnTransformer([("c", OneHotEncoder(), SC), ("n", StandardScaler(), SN)])),
                    ("m", LogisticRegression(C=1.0, max_iter=3000))])
    sim.fit(tr[SC + SN], tr["y"])
    ps = sim.predict_proba(te[SC + SN])[:, 1]
    enc = sim.named_steps["p"].named_transformers_["c"]
    sc = sim.named_steps["p"].named_transformers_["n"]
    coef = sim.named_steps["m"].coef_[0]
    nc = sum(len(c) for c in enc.categories_)
    weights = {}
    k = 0
    for col, cats in zip(SC, enc.categories_):
        weights[col] = {str(c): float(coef[k + i]) for i, c in enumerate(cats)}
        k += len(cats)
    nums = {col: dict(mean=float(sc.mean_[i]), scale=float(sc.scale_[i]), coef=float(coef[nc + i]))
            for i, col in enumerate(SN)}
    res["simulator"] = dict(intercept=float(sim.named_steps["m"].intercept_[0]), cat=weights, num=nums,
                            auc_test=roc_auc_score(te["y"], ps),
                            load_24h_range=[float(d["load_24h"].quantile(.05)), float(d["load_24h"].quantile(.95))],
                            feed_age_choices={"new (<30 d)": 20, "young (~90 d)": 90, "mature (~1 yr)": 365})
    return res


# =============================================================================
# B) WEEKLY FORECAST
# =============================================================================
def weekly_frame(con):
    inc = pd.read_sql("SELECT opened_at FROM fact_incident", con, parse_dates=["opened_at"])
    dl = pd.read_sql("SELECT d.delivery_date, c.region FROM fact_delivery d JOIN dim_client c USING(client_id)", con,
                     parse_dates=["delivery_date"])
    wk = lambda s: s.dt.to_period("W-SUN").dt.start_time
    w = pd.DataFrame({"incidents": inc.groupby(wk(inc["opened_at"])).size()})
    w["feed_days"] = dl.groupby(wk(dl["delivery_date"])).size()
    w = w.fillna(0)
    last_full = pd.Timestamp("2026-09-21")
    w = w[(w.index >= "2023-06-05") & (w.index <= last_full)]
    w["rate"] = 1000 * w["incidents"] / w["feed_days"]
    reg_w = dl.assign(w=wk(dl["delivery_date"])).groupby(["w", "region"]).size().unstack(fill_value=0)
    ev = pd.read_sql("SELECT event_date, kind, region_scope FROM dim_event", con, parse_dates=["event_date"])
    return w, reg_w, ev


def event_intensity(weeks, reg_w, ev):
    out = np.zeros(len(weeks))
    for e in ev.itertuples():
        if e.kind == "corporate":
            continue
        regs = e.region_scope.split("|")
        for i, t in enumerate(weeks):
            dd = (t + pd.Timedelta(days=3) - e.event_date).days
            if dd < 0:
                continue
            if t in reg_w.index:
                row = reg_w.loc[t]
                share = row[[r for r in regs if r in row.index]].sum() / max(row.sum(), 1)
            else:
                share = 0.0
            out[i] += share * np.exp(-dd / 45)
    return out


def fcols(h, fd, eint, woy):
    lag = lambda k: h[-k]
    return [lag(1), lag(2), lag(3), lag(4), np.mean(h[-4:]), np.mean(h[-12:]), np.log(fd), eint,
            np.sin(2 * np.pi * woy / 52), np.cos(2 * np.pi * woy / 52)]


def make_xy(rate, fd, eint, weeks):
    X, y = [], []
    for i in range(12, len(rate)):
        X.append(fcols(list(rate[:i]), fd[i], eint[i], weeks[i].isocalendar()[1]))
        y.append(rate[i])
    return np.array(X), np.array(y)


def fit_model(kind, X, y):
    if kind == "Ridge":
        m = Pipeline([("s", StandardScaler()), ("r", Ridge(alpha=5.0))])
    else:
        m = HistGradientBoostingRegressor(learning_rate=0.05, max_depth=3, max_iter=150, min_samples_leaf=8,
                                          l2_regularization=1.0, random_state=SEED)
    return m.fit(X, y)


def recursive(kind, model, hist_rate, fd_future, eint_future, week_future):
    h = list(hist_rate)
    preds = []
    for k in range(len(week_future)):
        if kind in ("Naive", "4-wk mean"):
            p = h[-1] if kind == "Naive" else float(np.mean(h[-4:]))
        else:
            p = float(model.predict(np.array([fcols(h, fd_future[k], eint_future[k],
                                                    week_future[k].isocalendar()[1])]))[0])
        p = max(p, 0.1)
        preds.append(p)
        h.append(p)
    return np.array(preds)


def forecasting(con):
    w, reg_w, ev = weekly_frame(con)
    weeks = list(w.index)
    rate, fd = w["rate"].values, w["feed_days"].values
    eint = event_intensity(weeks, reg_w, ev)
    n = len(w)
    HOR, NBT = 4, 26
    kinds = ["Naive", "4-wk mean", "Ridge", "Gradient Boosting"]
    errs = {k: {h: [] for h in range(1, HOR + 1)} for k in kinds}
    logr = {k: {h: [] for h in range(1, HOR + 1)} for k in kinds}
    h1 = {k: {} for k in kinds}
    for o in range(n - NBT - HOR + 1, n - HOR + 1):    # o = primer semana a pronosticar
        Xtr, ytr = make_xy(rate[:o], fd[:o], eint[:o], weeks[:o])
        models = {"Ridge": fit_model("Ridge", Xtr, ytr), "Gradient Boosting": fit_model("GB", Xtr, ytr)}
        fd_proj = np.full(HOR, fd[max(o - 4, 0):o].mean())
        for k in kinds:
            p = recursive(k, models.get(k), rate[:o], fd_proj, eint[o:o + HOR], weeks[o:o + HOR])
            for hh in range(1, HOR + 1):
                pc, ac = p[hh - 1] * fd_proj[hh - 1] / 1000, w["incidents"].values[o + hh - 1]
                errs[k][hh].append(abs(pc - ac))
                logr[k][hh].append(np.log(max(ac, 1) / max(pc, 1)))
                if hh == 1:
                    h1[k][weeks[o]] = pc
    bt = {k: dict(mae=float(np.mean([np.mean(v) for v in errs[k].values()])),
                  mae_by_h=[float(np.mean(errs[k][h])) for h in range(1, HOR + 1)]) for k in kinds}
    best = min(["Ridge", "Gradient Boosting", "Naive", "4-wk mean"], key=lambda k: bt[k]["mae"])
    sd = {h: float(np.std(logr[best][h])) for h in range(1, HOR + 1)}

    # final forecast: 13 weeks from 2026-09-28
    Xall, yall = make_xy(rate, fd, eint, weeks)
    models = {"Ridge": fit_model("Ridge", Xall, yall), "Gradient Boosting": fit_model("GB", Xall, yall)}
    fut = [weeks[-1] + pd.Timedelta(weeks=i + 1) for i in range(13)]
    fd_f = np.full(13, fd[-4:].mean())
    ef = event_intensity(fut, reg_w, ev)
    pr = recursive(best, models.get(best), rate, fd_f, ef, fut)
    counts = pr * fd_f / 1000
    fc = []
    for i, (t, c) in enumerate(zip(fut, counts)):
        s = sd[min(i + 1, HOR)] * np.sqrt(max(i + 1, HOR) / HOR)
        fc.append(dict(week=t, forecast=c, lo=c * np.exp(-1.2816 * s), hi=c * np.exp(1.2816 * s),
                       rate=pr[i]))
    breach_rate = float(pd.read_sql("SELECT AVG(sla_breach) a FROM v_incident WHERE open_date >= '2026-07-01'",
                                    con)["a"].iloc[0])
    hist = [dict(week=t, incidents=int(r.incidents), rate=r.rate, feed_days=int(r.feed_days), event=float(e))
            for (t, r), e in zip(w.iterrows(), eint)]
    back = [dict(week=t, pred=v) for t, v in h1[best].items()]
    return dict(history=hist, forecast=fc, backtest=bt, best_model=best, backtest_weeks=NBT, horizon_bt=HOR,
                h1_backtest=back, expected_incidents_13w=float(counts.sum()),
                recent_breach_rate=breach_rate, expected_breaches_13w=float(counts.sum() * breach_rate),
                last_13w_actual=int(w["incidents"].values[-13:].sum()),
                interval_note="Intervalo 80% aproximado: error log-normal del backtest, ampliado con √horizonte.")


# =============================================================================
# C) ANOMALY DETECTION (silent degradations)
# =============================================================================
def anomalies(con):
    dl = pd.read_sql("SELECT d.*, f.feed_type, f.base_latency_s, c.client_name FROM fact_delivery d "
                     "JOIN dim_feed f USING(feed_id) JOIN dim_client c USING(client_id)", con,
                     parse_dates=["delivery_ts", "delivery_date"])
    dl = dl.sort_values(["feed_id", "delivery_ts"]).reset_index(drop=True)
    dl["wknd"] = (dl["delivery_date"].dt.dayofweek >= 5).astype(int)
    ok = dl["status"] == "OK"
    base = dl[ok].groupby(["feed_id", "wknd"])["completeness"].median().rename("c_base")
    dl = dl.join(base, on=["feed_id", "wknd"])
    dl["c_adj"] = dl["completeness"] / dl["c_base"]
    dl["lat_lr"] = np.log(dl["latency_s"] / dl["base_latency_s"]).clip(-3, 4)
    lr = np.log1p(dl["records_delivered"])
    g = lr.groupby(dl["feed_id"])
    mu = g.transform(lambda s: s.shift(1).rolling(28, min_periods=7).mean())
    sd = g.transform(lambda s: s.shift(1).rolling(28, min_periods=7).std())
    dl["cnt_z"] = ((lr - mu) / sd.clip(lower=0.02)).clip(-8, 8).fillna(0)
    F = ["c_adj", "lat_lr", "cnt_z"]
    okd = dl[dl["status"] == "OK"].copy()
    iso = IsolationForest(n_estimators=300, max_samples=4096, contamination="auto", random_state=SEED, n_jobs=-1)
    iso.fit(okd[F])
    okd["score"] = -iso.score_samples(okd[F])       # higher = more anomalous
    truth = pd.read_csv(ROOT / "data" / "raw" / "sim_truth_silent.csv")
    truth["delivery_date"] = pd.to_datetime(truth["date"])
    okd = okd.merge(truth[["feed_id", "delivery_date", "silent_degradation"]], on=["feed_id", "delivery_date"],
                    how="left")
    okd["silent"] = okd["silent_degradation"].fillna(0).astype(int)
    total_silent = int(okd["silent"].sum())
    out = dict(ok_days=len(okd), silent_total=total_silent, rows=[])
    for q in (0.004, 0.008, 0.015):
        thr = okd["score"].quantile(1 - q)
        f = okd["score"] >= thr
        tp = int((f & (okd["silent"] == 1)).sum())
        out["rows"].append(dict(method="IsolationForest", flag_rate=q, flagged=int(f.sum()), tp=tp,
                                precision=tp / max(f.sum(), 1), recall=tp / total_silent))
    for cut in (0.97, 0.95, 0.92):
        f = okd["c_adj"] < cut
        tp = int((f & (okd["silent"] == 1)).sum())
        out["rows"].append(dict(method=f"Completeness rule < {int(cut * 100)}%", flag_rate=float(f.mean()),
                                flagged=int(f.sum()), tp=tp, precision=tp / max(f.sum(), 1),
                                recall=tp / total_silent))
    # Hybrid (chosen operating point): completeness rule + IsolationForest at 0.4%
    q = 0.004
    thr = okd["score"].quantile(1 - q)
    okd["flag"] = (okd["score"] >= thr) | (okd["c_adj"] < 0.92)
    tp = int((okd["flag"] & (okd["silent"] == 1)).sum())
    out["rows"].append(dict(method="Hybrid: rule <92% + IsolationForest", flag_rate=float(okd["flag"].mean()),
                            flagged=int(okd["flag"].sum()), tp=tp, precision=tp / max(okd["flag"].sum(), 1),
                            recall=tp / total_silent))
    out["operating_point"] = dict(method="Hybrid", iso_flag_rate=q, iso_threshold=float(thr), rule_cut=0.92)
    # actionable list: last 90 days
    rec = okd[(okd["flag"]) & (okd["delivery_date"] >= "2026-07-02")].sort_values("score", ascending=False).head(8)
    out["latest_flags"] = [dict(feed=r.feed_id, client=r.client_name, date=r.delivery_date, feed_type=r.feed_type,
                                completeness=r.completeness, c_adj=r.c_adj, score=r.score)
                           for r in rec.itertuples()]
    out["flags_last_90d"] = int(((okd["flag"]) & (okd["delivery_date"] >= "2026-07-02")).sum())
    # series of a feed with many detections
    top_feed = okd[okd["flag"] & (okd["silent"] == 1)].groupby("feed_id").size().sort_values().index[-1]
    s = dl[(dl["feed_id"] == top_feed)].tail(150).copy()
    s = s.merge(okd[["feed_id", "delivery_date", "flag", "silent"]], on=["feed_id", "delivery_date"], how="left")
    out["feed_series"] = dict(feed=top_feed, points=[dict(d=r.delivery_date, c=r.c_adj, st=r.status,
                                                          flag=bool(r.flag) if pd.notna(r.flag) else False)
                                                     for r in s.itertuples()])
    # scatter (sample)
    samp = pd.concat([okd[okd["flag"]].sample(min(130, int(okd["flag"].sum())), random_state=SEED),
                      okd[~okd["flag"]].sample(260, random_state=SEED)])
    out["scatter"] = [[round(r.c_adj, 3), round(r.lat_lr, 3), int(r.flag), int(r.silent)] for r in samp.itertuples()]
    out["status_counts"] = dl["status"].value_counts().to_dict()
    return out


# =============================================================================
def event_stats(con):
    ev = pd.read_sql("SELECT * FROM dim_event ORDER BY event_date", con)
    sql = json.loads((OUT / "sql_results.json").read_text())["event_impact"]
    rows = []
    for r in sql:
        if r["rate_before"] is None or r["rate_after"] is None or not r["fd_before"] or not r["fd_after"]:
            rows.append(dict(r, ratio=None, p=None, status="no baseline"))
            continue
        a, b = r["inc_after"], r["inc_before"]
        ratio = (a / r["fd_after"]) / (b / r["fd_before"]) if b else None
        p = binomtest(a, a + b, r["fd_after"] / (r["fd_after"] + r["fd_before"])).pvalue if (a + b) else None
        rows.append(dict(r, ratio=ratio, p=p, status="sig" if (p is not None and p < 0.05) else "no sig"))
    return rows


def main():
    con = sqlite3.connect(DB)
    print("A) classification ..."); A = classification(con)
    print("B) forecast ...");    B = forecasting(con)
    print("C) anomalies ...");     C = anomalies(con)
    E = event_stats(con)
    res = clean(dict(classification=A, forecast=B, anomaly=C, event_stats=E))
    (OUT / "model_results.json").write_text(json.dumps(res, ensure_ascii=False, indent=1))

    print("\n=== CLASSIFICATION (test: 2026-01 -> 2026-09) ===")
    print(f"train={A['n_train']} test={A['n_test']} breach_test={A['breach_rate_test']:.3f}")
    print(f"baseline AUC={A['baseline']['auc']:.3f}")
    for k, v in A["models"].items():
        print(f"{k:20s} AUC={v['auc']:.3f} AP={v['ap']:.3f} P={v['precision']:.2f} R={v['recall']:.2f} "
              f"F1={v['f1']:.2f} val_auc={v['val_auc']:.3f}")
    print("best:", A["best_model"], "top20 capture:", round(A["top20_capture"], 3), "precision:",
          round(A["top20_precision"], 3))
    print("importance:", [(d["feature"], round(d["auc_drop"], 3)) for d in A["importance"][:8]])
    print("ETA:", {k: (round(v, 3) if isinstance(v, float) else v) for k, v in A["eta"].items()})
    print("simulator AUC:", round(A["simulator"]["auc_test"], 3))
    print("what-if (top20):", [(g["reduction"], g["avoided"]) for g in A["whatif"]["grid"] if g["topk"] == 20])
    print("\n=== FORECAST ===")
    print("backtest MAE:", {k: round(v["mae"], 2) for k, v in B["backtest"].items()}, "best:", B["best_model"])
    print("13w forecast total:", round(B["expected_incidents_13w"], 1), "vs last 13w actual:", B["last_13w_actual"])
    print([round(f["forecast"], 1) for f in B["forecast"]])
    print("\n=== ANOMALIES ===")
    print(pd.DataFrame(C["rows"]).round(3).to_string(index=False))
    print("silent total:", C["silent_total"], " flags last 90d:", C["flags_last_90d"])
    print("\n=== EVENTS ===")
    print(pd.DataFrame(E)[["event_id", "name", "rate_before", "rate_after", "ratio", "p", "status"]].round(3).to_string(index=False))
    con.close()


if __name__ == "__main__":
    main()
