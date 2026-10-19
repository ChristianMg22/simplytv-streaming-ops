"""
01_generate_data.py
-------------------
Generates the project's RAW data (deliberately messy).

IMPORTANT: Simply.TV does not publish its operational logs. Everything operational here is
SYNTHETIC. What is public and used as a calibration anchor:
  - business segments (TV Operators, Streaming, Broadcasters, Research, Hospitality)
  - product lines (EPG, VOD, Sports, Artwork/images, Keywords)
  - dated milestones (LATAM launch, InFlow Media acquisition, Allente, DTP, ...)
  - geographic expansion (Nordics, DACH, Iberia/LATAM, Brazil, Benelux, MEA, NA)
Clients are ANONYMIZED (Client-001...). No incident is attributed
to a real company.

Outputs (data/raw):
  clients.csv, feeds.csv         -> catalog (CSV with format noise)
  events.xml                     -> public milestones (XML, with source URL)
  deliveries.log.gz              -> feed delivery log (text, with junk lines)
  incidents_raw.jsonl            -> incident tickets (JSON, mixed formats)
  sim_truth.csv                  -> simulation ground truth (only to VALIDATE models)
"""
import gzip
import json
from pathlib import Path
import xml.etree.ElementTree as ET

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "data" / "raw"
RAW.mkdir(parents=True, exist_ok=True)

rng = np.random.default_rng(2026)
START, END = pd.Timestamp("2023-06-01"), pd.Timestamp("2026-09-30")
DAYS = pd.date_range(START, END, freq="D")
N_CLIENTS = 120

# --------------------------------------------------------------------------
# 1. Public milestones (source: press releases / Simply.TV website)
# --------------------------------------------------------------------------
# "scope" = regions where the analyst expects operational impact.
# "sim_*" = simulation-only parameters (they do not appear in events.xml).
EVENTS = [
    dict(id="E01", date="2021-11-23", name="Vestel signs multi-year EPG contract (50+ countries)", kind="customer",
         scope="Turkey / MEA / APAC", sim_boost=1.0, sim_tau=1,
         url="https://digitaltveurope.com/2021/11/23/vestel-partners-with-simply-tv-for-metadata-services"),
    dict(id="E02", date="2022-08-23", name="Acquisition of GVIDI (~25 clients)", kind="acquisition",
         scope="Benelux", sim_boost=1.0, sim_tau=1,
         url="https://digitaltveurope.com/2022/08/23/simply-tv-acquires-epg-specialist-gvidi"),
    dict(id="E03", date="2023-06-08", name="Launch of operations in Latin America", kind="expansion",
         scope="Iberia & LATAM-ES|Brazil (LATAM-PT)", sim_boost=1.8, sim_tau=75,
         url="https://simply.tv/post/simply-tv-is-launching-in-latin-america"),
    dict(id="E04", date="2023-09-09", name="GO Malta chooses Simply.TV (EPG + VOD)", kind="customer",
         scope="Other Europe", sim_boost=1.0, sim_tau=1,
         url="https://www.cbinsights.com/investor/simply-tv"),
    dict(id="E05", date="2024-07-03", name="Acquisition of InFlow Media (Nordics)", kind="acquisition",
         scope="Nordics", sim_boost=2.0, sim_tau=60,
         url="https://www.simply.tv/company/simply-acquires-inflow-media"),
    dict(id="E06", date="2024-07-09", name="Allente selects Simply.TV (Nordics)", kind="customer",
         scope="Nordics", sim_boost=1.5, sim_tau=45,
         url="https://www.cbinsights.com/investor/simply-tv"),
    dict(id="E07", date="2026-06-18", name="Simply.TV joins Deutsche TV-Plattform", kind="partnership",
         scope="DACH", sim_boost=1.7, sim_tau=45,
         url="https://www.simply.tv/insights/simply.tv-joins-deutsche-tv-plattform"),
    # 'Placebo' event: CEO appointment. It should not move the data operation.
    dict(id="E08", date="2026-09-04", name="New CEO: Richard Cusick", kind="corporate",
         scope="ALL", sim_boost=1.0, sim_tau=1,
         url="https://www.simply.tv/insights/simply.tv-appoints-entertainment-metadata-veteran-richard-cusick-as-chief-executive-officer"),
]


def write_events_xml():
    root = ET.Element("events", source="Simply.TV public announcements", retrieved="2026-10-15")
    for e in EVENTS:
        ET.SubElement(root, "event", id=e["id"], date=e["date"], kind=e["kind"],
                      region_scope=e["scope"], url=e["url"]).text = e["name"]
    ET.indent(root)
    ET.ElementTree(root).write(RAW / "events.xml", encoding="utf-8", xml_declaration=True)


# --------------------------------------------------------------------------
# 2. Clients and feeds
# --------------------------------------------------------------------------
SEGMENTS = {  # weight, complexity multiplier
    "TV Operators": (0.38, 1.10), "Streaming": (0.22, 1.30), "Broadcasters": (0.17, 1.00),
    "Hospitality": (0.13, 0.70), "Research": (0.10, 0.60),
}
REGIONS = {
    "Nordics": 0.14, "DACH": 0.14, "Iberia & LATAM-ES": 0.16, "Brazil (LATAM-PT)": 0.08,
    "Benelux": 0.10, "Other Europe": 0.18, "Turkey / MEA / APAC": 0.12, "North America": 0.08,
}
FEED_TYPES = {  # mean records/day, failure multiplier
    "EPG_LINEAR": (20000, 1.00), "VOD_CATALOG": (60000, 1.15), "SPORTS": (4000, 1.50),
    "ARTWORK": (25000, 0.90), "KEYWORDS": (15000, 0.70),
}
FEED_MIX = {  # probability of each type per segment (FEED_TYPES order)
    "TV Operators": [.45, .20, .15, .10, .10], "Streaming": [.10, .45, .10, .20, .15],
    "Broadcasters": [.50, .15, .20, .05, .10], "Hospitality": [.70, .10, .05, .10, .05],
    "Research": [.10, .30, .10, .10, .40],
}
TIERS = {"Gold": 0.25, "Silver": 0.40, "Bronze": 0.35}


def _u(a, b):
    a, b = pd.Timestamp(a), pd.Timestamp(b)
    return a + pd.Timedelta(days=int(rng.integers(0, (b - a).days + 1)))


def sample_onboard(region):
    r = rng.random()
    if region == "Nordics":
        return _u("2021-01-01", "2024-06-30") if r < .45 else _u("2024-07-03", "2024-12-31")
    if region == "DACH":
        return _u("2021-01-01", "2026-05-31") if r < .70 else _u("2026-06-18", "2026-09-15")
    if region == "Iberia & LATAM-ES":
        return _u("2023-06-08", "2026-06-30")
    if region == "Brazil (LATAM-PT)":
        return _u("2023-09-01", "2026-03-31")
    if region == "Benelux":
        return _u("2020-01-01", "2023-05-31")
    if region == "Turkey / MEA / APAC":
        return _u("2021-11-23", "2025-12-31")
    if region == "North America":
        return _u("2025-01-01", "2026-08-31")
    return _u("2019-06-01", "2026-03-31")


def build_catalog():
    seg_names = list(SEGMENTS)
    seg_p = np.array([SEGMENTS[s][0] for s in seg_names])
    reg_names = list(REGIONS)
    reg_p = np.array(list(REGIONS.values()))
    reg_p = reg_p / reg_p.sum()
    clients, feeds = [], []
    fid = 0
    for i in range(1, N_CLIENTS + 1):
        seg = rng.choice(seg_names, p=seg_p / seg_p.sum())
        reg = rng.choice(reg_names, p=reg_p)
        tier = rng.choice(list(TIERS), p=list(TIERS.values()))
        onboard = sample_onboard(reg)
        clients.append(dict(client_id=f"C-{i:03d}", client_name=f"Client {i:03d}", segment=seg, region=reg,
                            tier=tier, onboard_date=onboard.strftime("%Y-%m-%d"),
                            frailty=float(rng.gamma(4.0, 0.25))))
        n_feeds = 1 + int(rng.random() < .45) + int(rng.random() < .15)
        types = rng.choice(list(FEED_TYPES), size=n_feeds, replace=False, p=FEED_MIX[seg])
        for k, ft in enumerate(types):
            fid += 1
            start = onboard + pd.Timedelta(days=0 if k == 0 else int(rng.integers(5, 120)))
            feeds.append(dict(feed_id=f"F-{fid:04d}", client_id=f"C-{i:03d}", feed_type=ft,
                              start_date=start.strftime("%Y-%m-%d"),
                              base_records=float(rng.lognormal(np.log(FEED_TYPES[ft][0]), 0.5)),
                              sched_hour=int(rng.integers(1, 6)),
                              base_latency_s=float(rng.lognormal(np.log(420), 0.4))))
    return pd.DataFrame(clients), pd.DataFrame(feeds)


# --------------------------------------------------------------------------
# 3. Daily deliveries per feed
# --------------------------------------------------------------------------
def simulate_deliveries(clients, feeds):
    cl = clients.set_index("client_id")
    frames = []
    for f in feeds.itertuples():
        c = cl.loc[f.client_id]
        fstart = max(pd.Timestamp(f.start_date), START)
        days = pd.date_range(fstart, END, freq="D")
        n = len(days)
        if n == 0:
            continue
        age = (days - pd.Timestamp(f.start_date)).days.values
        dow = days.dayofweek.values
        newness = 1 + 2.5 * np.exp(-age / 70)
        ev = np.ones(n)
        for e in EVENTS:
            if e["sim_boost"] == 1.0:
                continue
            if c.region in e["scope"].split("|"):
                dd = (days - pd.Timestamp(e["date"])).days.values
                m = dd >= 0
                ev[m] *= 1 + (e["sim_boost"] - 1) * np.exp(-dd[m] / e["sim_tau"])
        wk = np.where(dow == 0, 1.35, np.where(dow >= 5, 0.85, 1.0))
        mult = SEGMENTS[c.segment][1] * FEED_TYPES[f.feed_type][1] * newness * ev * c.frailty
        p_fail = np.clip(0.008 * mult * wk, 0, .5)
        p_deg = np.clip(0.020 * mult * wk, 0, .5)
        u = rng.random(n)
        status = np.where(u < p_fail, "FAILED", np.where(u < p_fail + p_deg, "DEGRADED", "OK"))
        silent = (status == "OK") & (rng.random(n) < 0.004)
        client_init = rng.random(n) < np.clip(0.003 * mult * np.where(dow >= 5, 0.4, 1.0), 0, .3)

        # expected records (fixed baseline) vs actual (with weekly seasonality)
        expected = np.round(f.base_records * (1 + 0.0002 * np.arange(n))).astype(int)
        amp = 0.30 if f.feed_type == "SPORTS" else 0.05
        seas = 1 + np.where(dow >= 5, amp, 0.0)
        true = f.base_records * (1 + 0.0002 * np.arange(n)) * seas * (1 + rng.normal(0, 0.02, n))
        records = true.copy()
        latency = f.base_latency_s * rng.lognormal(0, 0.3, n)
        schema = np.array(["v3.1"] * n, dtype=object)
        checksum = np.array(["ok"] * n, dtype=object)
        forced_cat = np.array([""] * n, dtype=object)

        deg = status == "DEGRADED"
        mode = rng.choice([1, 2, 3], size=n, p=[.5, .3, .2])
        m1, m2, m3 = deg & (mode == 1), deg & (mode == 2), deg & (mode == 3)
        records[m1] = true[m1] * rng.uniform(.5, .9, m1.sum())
        latency[m2] *= rng.uniform(4, 10, m2.sum())
        records[m3] = true[m3] * rng.uniform(.85, 1.0, m3.sum())
        schema[m3] = "v3.2"
        checksum[m3] = "MISMATCH"
        forced_cat[m3 & (rng.random(n) < .8)] = "schema_drift"
        fl = status == "FAILED"
        zero = fl & (rng.random(n) < .7)
        records[fl] = true[fl] * rng.uniform(0, .05, fl.sum())
        records[zero] = 0
        latency[fl] = rng.uniform(3600, 14400, fl.sum())
        records[silent] = true[silent] * rng.uniform(.80, .95, silent.sum())
        latency[silent] *= rng.uniform(1.0, 1.5, silent.sum())

        sched = days + pd.to_timedelta(f.sched_hour, unit="h") + pd.to_timedelta(rng.integers(0, 3600, n), unit="s")
        ts = sched + pd.to_timedelta(latency, unit="s")
        frames.append(pd.DataFrame(dict(
            feed_id=f.feed_id, client_id=f.client_id, date=days, ts=ts, status=status,
            records=np.round(records).astype(int), expected=expected, latency_s=np.round(latency).astype(int),
            schema=schema, checksum=checksum, silent=silent, forced_cat=forced_cat, client_init=client_init,
            age=age, newness=newness)))
    return pd.concat(frames, ignore_index=True)


def write_delivery_log(dl):
    lvl = dl["status"].map({"OK": "INFO", "DEGRADED": "WARN", "FAILED": "ERROR"})
    lines = (dl["ts"].dt.strftime("%Y-%m-%dT%H:%M:%SZ") + " " + lvl + " feed=" + dl["feed_id"] +
             " client=" + dl["client_id"] + " status=" + dl["status"] + " records=" + dl["records"].astype(str) +
             " expected=" + dl["expected"].astype(str) + " latency_s=" + dl["latency_s"].astype(str) +
             " schema=" + dl["schema"] + " checksum=" + dl["checksum"]).tolist()
    out = []
    for ln in lines:
        out.append(ln)
        r = rng.random()
        if r < 0.010:
            out.append(ln[:20] + " DEBUG scheduler heartbeat ok")
        elif r < 0.012:
            out.append(ln[:20] + " WARN feed=F-0000 status= records=NaN expected=?? latency_s=")
        elif r < 0.015:
            out.append(ln)  # exact duplicate
    # the log is generated per feed; it is sorted chronologically as a real aggregator would
    order = np.argsort([l[:20] for l in out], kind="stable")
    out = [out[i] for i in order]
    with gzip.open(RAW / "deliveries.log.gz", "wt", encoding="utf-8") as fh:
        fh.write("\n".join(out) + "\n")
    return len(out)


# --------------------------------------------------------------------------
# 4. Incidents
# --------------------------------------------------------------------------
CAT_BY_TYPE = {
    "EPG_LINEAR": dict(source_outage=.22, stale_schedule=.28, mapping_error=.15, schema_drift=.08,
                       delivery_endpoint=.15, duplicate_ids=.02, image_gap=.02, client_config=.08),
    "VOD_CATALOG": dict(schema_drift=.22, duplicate_ids=.22, source_outage=.15, mapping_error=.12, image_gap=.08,
                        delivery_endpoint=.12, client_config=.05, stale_schedule=.04),
    "SPORTS": dict(source_outage=.35, stale_schedule=.25, schema_drift=.12, mapping_error=.10,
                   delivery_endpoint=.10, duplicate_ids=.04, client_config=.04),
    "ARTWORK": dict(image_gap=.55, delivery_endpoint=.15, source_outage=.10, mapping_error=.08,
                    schema_drift=.05, client_config=.07),
    "KEYWORDS": dict(schema_drift=.25, mapping_error=.20, duplicate_ids=.20, source_outage=.15,
                     delivery_endpoint=.10, client_config=.10),
}
CLIENT_CAT = dict(mapping_error=.35, image_gap=.25, stale_schedule=.15, duplicate_ids=.10, client_config=.15)
FAIL_BOOST = {"source_outage": 1.8, "delivery_endpoint": 1.8}
DEG_BOOST = {"mapping_error": 1.5, "duplicate_ids": 1.5, "image_gap": 1.5, "stale_schedule": 1.5, "schema_drift": 1.5}
ESC_P = dict(schema_drift=.55, source_outage=.45, duplicate_ids=.40, mapping_error=.30, stale_schedule=.25,
             image_gap=.20, delivery_endpoint=.20, client_config=.10)
TEAM_BY_CAT = dict(schema_drift="Development", duplicate_ids="Development", mapping_error="Streaming",
                   stale_schedule="Streaming", source_outage="Operations", image_gap="Streaming",
                   delivery_endpoint="Operations", client_config="Streaming")
SLA = {  # resolution hours by severity and tier
    "P1": dict(Gold=4, Silver=8, Bronze=12), "P2": dict(Gold=8, Silver=16, Bronze=24),
    "P3": dict(Gold=24, Silver=48, Bronze=72), "P4": dict(Gold=72, Silver=120, Bronze=168),
}
BASE_H = {"P1": 1.9, "P2": 5.6, "P3": 16.0, "P4": 43.0}
CAT_EFF = dict(source_outage=.25, schema_drift=.35, duplicate_ids=.15, stale_schedule=-.15, image_gap=-.05,
               mapping_error=.05, delivery_endpoint=-.10, client_config=.10)
TIER_EFF = dict(Gold=-.25, Silver=0.0, Bronze=.30)

NOTES = {
    "source_outage": {
        "en": ["Upstream provider did not deliver schedule data for {n} channels",
               "No source files received since {h}h, provider feed down", "Source feed unavailable, daily ingest empty"],
        "es": ["El proveedor no entregó la programación de {n} canales", "Fuente caída desde hace {h} horas, ingesta vacía"],
        "pt": ["Fornecedor não entregou a grade de {n} canais"]},
    "schema_drift": {
        "en": ["Unexpected field change in source XML, parser rejected {n} records",
               "Schema version mismatch, new element in payload breaks ingestion", "Source changed date format in JSON feed"],
        "es": ["Cambio de esquema en el XML de origen, {n} registros rechazados", "Campo nuevo en el JSON rompe la ingesta"],
        "pt": ["Mudança de esquema no XML, {n} registros rejeitados"]},
    "duplicate_ids": {
        "en": ["Duplicate content IDs found across {n} titles after merge",
               "Unified ID collision, two series share same identifier", "Same episode listed twice in catalog"],
        "es": ["IDs duplicados en {n} títulos tras la unificación", "Misma serie aparece dos veces en el catálogo"],
        "pt": ["IDs duplicados em {n} títulos"]},
    "stale_schedule": {
        "en": ["EPG not refreshed, schedule data is {h}h old", "Stale listings in guide, tomorrow's schedule missing",
               "Program guide shows outdated schedule for {n} channels"],
        "es": ["La guía no se actualizó, datos con {h} horas de retraso", "Programación desactualizada en {n} canales"],
        "pt": ["Guia desatualizado, dados com {h} horas"]},
    "image_gap": {
        "en": ["Missing artwork for {n} titles in client UI", "Posters not loading, image URLs return 404",
               "Wrong aspect ratio images delivered for kids content"],
        "es": ["Faltan carátulas de {n} títulos", "Imágenes no cargan, URLs devuelven 404"],
        "pt": ["Faltam imagens de {n} títulos"]},
    "mapping_error": {
        "en": ["Channel mapping incorrect, {n} services show wrong schedule", "Wrong program matched to live channel",
               "Service ID mapping missing for new channel lineup"],
        "es": ["Mapeo de canales incorrecto, {n} servicios con programación equivocada", "Programa equivocado asignado al canal"],
        "pt": ["Mapeamento de canais incorreto, {n} serviços"]},
    "delivery_endpoint": {
        "en": ["Delivery to client endpoint failed, HTTP 401 on push", "SFTP upload timeout to customer server",
               "API endpoint returning 5xx, client cannot pull feed"],
        "es": ["Falla de entrega al endpoint del cliente, error 401", "Tiempo de espera agotado en el SFTP del cliente"],
        "pt": ["Falha na entrega ao endpoint do cliente"]},
    "client_config": {
        "en": ["Client requested wrong language pack, config needs update", "Customer integration pointing to old feed version",
               "Platform settings mismatch on client side"],
        "es": ["Cliente configurado con paquete de idioma incorrecto", "Integración apunta a versión antigua del feed"],
        "pt": ["Cliente com configuração incorreta de idioma"]},
}
GENERIC = ["Feed issue, please check", "Problem reported by customer", "Data not correct",
           "Issue with delivery", "Please investigate urgently"]
CATS = list(NOTES)


def pick_cat(probs):
    k = list(probs)
    p = np.array([probs[x] for x in k], dtype=float)
    return rng.choice(k, p=p / p.sum())


def make_note(cat, region):
    r = rng.random()
    if r < .12:
        return str(rng.choice(GENERIC))
    if r < .17:
        cat = rng.choice(CATS)  # label noise
    lang = "en"
    if region == "Iberia & LATAM-ES" and rng.random() < .6:
        lang = "es"
    elif region == "Brazil (LATAM-PT)" and rng.random() < .6:
        lang = "pt"
    t = str(rng.choice(NOTES[cat][lang]))
    return t.format(n=int(rng.integers(2, 60)), h=int(rng.integers(3, 48)))


def fmt_time(ts, kind):
    if ts is None or pd.isna(ts):
        return None
    if kind == 0:
        return ts.strftime("%Y-%m-%dT%H:%M:%SZ")
    if kind == 1:
        return ts.strftime("%d/%m/%Y %H:%M")
    if kind == 2:
        return ts.strftime("%b %-d, %Y %I:%M %p")
    return int(ts.timestamp())


def simulate_incidents(dl, clients, feeds):
    cl = clients.set_index("client_id")
    fd = feeds.set_index("feed_id")
    rows = []
    # (a) incidents that originate from failed/degraded deliveries
    el = dl[dl["status"].isin(["FAILED", "DEGRADED"])]
    for r in el.itertuples():
        auto_p = .95 if r.status == "FAILED" else .80
        u = rng.random()
        if u < auto_p:
            det, opened = "auto", r.ts + pd.Timedelta(minutes=float(rng.uniform(3, 25)))
        elif rng.random() < .55:
            det = "client"
            hrs = float(np.clip(rng.lognormal(np.log(6), .6), 1, 72))
            opened = r.ts + pd.Timedelta(hours=hrs)
        else:
            continue  # never detected/reported
        probs = dict(CAT_BY_TYPE[fd.loc[r.feed_id, "feed_type"]])
        boost = FAIL_BOOST if r.status == "FAILED" else DEG_BOOST
        for k, b in boost.items():
            if k in probs:
                probs[k] *= b
        cat = r.forced_cat if r.forced_cat else pick_cat(probs)
        sev = rng.choice(["P1", "P2", "P3"], p=[.35, .45, .20]) if r.status == "FAILED" else \
            rng.choice(["P2", "P3", "P4"], p=[.25, .50, .25])
        rows.append((r.feed_id, r.client_id, opened, det, cat, sev, r.age))
    # (b) client-initiated incidents (content quality)
    ci = dl[dl["client_init"]]
    for r in ci.itertuples():
        hr = float(np.clip(rng.normal(11, 3.5), 0, 23.9))
        opened = r.date + pd.Timedelta(hours=hr)
        sev = rng.choice(["P2", "P3", "P4"], p=[.15, .50, .35])
        rows.append((r.feed_id, r.client_id, opened, "client", pick_cat(CLIENT_CAT), sev, r.age))

    inc = pd.DataFrame(rows, columns=["feed_id", "client_id", "opened", "detection", "category", "sev", "age"])
    inc = inc[inc["opened"] <= END + pd.Timedelta(hours=23, minutes=59)].copy()
    inc = inc.sort_values("opened").reset_index(drop=True)
    inc["incident_id"] = [f"INC-{i:06d}" for i in range(1, len(inc) + 1)]
    inc["tier"] = inc["client_id"].map(cl["tier"])
    inc["region"] = inc["client_id"].map(cl["region"])
    # Gold: severity is sometimes raised one level
    up = (inc["tier"] == "Gold") & (rng.random(len(inc)) < .3)
    inc.loc[up, "sev"] = inc.loc[up, "sev"].map({"P4": "P3", "P3": "P2", "P2": "P1", "P1": "P1"})
    # escalation
    p_esc = inc["category"].map(ESC_P) * np.where(inc["sev"] == "P1", 1.4, 1.0)
    inc["escalated"] = rng.random(len(inc)) < np.clip(p_esc, 0, .95)
    inc["team"] = np.where(inc["escalated"] & (rng.random(len(inc)) < .6), "Development",
                           inc["category"].map(TEAM_BY_CAT))
    # daily load (z-score) -> more incidents that day, slower resolution
    day = inc["opened"].dt.floor("D")
    cnt = day.map(day.value_counts())
    load_z = ((cnt - cnt.mean()) / cnt.std()).values
    hr = inc["opened"].dt.hour
    weekend = (inc["opened"].dt.dayofweek >= 5).astype(float)
    night = ((hr >= 22) | (hr < 6)).astype(float)
    mu = (np.log(inc["sev"].map(BASE_H)) + inc["category"].map(CAT_EFF) + inc["tier"].map(TIER_EFF)
          + 0.30 * (inc["detection"] == "client") + 0.28 * weekend + 0.20 * night + 0.10 * load_z
          + 0.25 * np.exp(-inc["age"] / 90) + 0.35 * inc["escalated"])
    inc["res_hours"] = np.exp(mu + 0.70 * rng.standard_normal(len(inc)))
    inc["closed"] = inc["opened"] + pd.to_timedelta(inc["res_hours"], unit="h")
    inc["sla_hours"] = [SLA[s][t] for s, t in zip(inc["sev"], inc["tier"])]
    inc["breach_true"] = inc["res_hours"] > inc["sla_hours"]
    frm = inc["sev"].map({"P1": 10, "P2": 20, "P3": 45, "P4": 90}) * (1 + .5 * (weekend + night).clip(0, 1)) * \
        np.where(inc["detection"] == "client", 1.4, 1.0)
    inc["first_resp_min"] = np.round(frm * rng.lognormal(0, .5, len(inc)), 1)
    return inc


def write_incidents_raw(inc):
    cutoff = END + pd.Timedelta(hours=23, minutes=59)
    sev_variants = {"P1": ["P1", 1, "p1", "Critical"], "P2": ["P2", 2, "p2", "High"],
                    "P3": ["P3", 3, "p3", "Medium"], "P4": ["P4", 4, "p4", "Low"]}
    cat_variants = lambda c: [c, c.upper(), c.replace("_", " ").title(), c.replace("_", "-"), c.replace("_", "")]
    src_variants = {"auto": ["auto", "AUTO", "monitoring"], "client": ["client", "Client Report", "customer"]}
    team_variants = {"Streaming": ["Streaming", "streaming team", "STREAMING"],
                     "Development": ["Development", "Dev", "DEV"], "Operations": ["Operations", "Ops", "OPS"]}
    esc_variants = {True: [True, "Y", 1], False: [False, "N", 0]}
    cl = None
    out, truth = [], []
    for r in inc.itertuples():
        t_fmt = int(rng.choice([0, 1, 2, 3], p=[.70, .15, .10, .05]))
        closed = r.closed if r.closed <= cutoff else None
        if closed is not None and rng.random() < .01:  # error de datos: cierre antes de apertura
            closed = r.opened - pd.Timedelta(hours=float(rng.uniform(1, 5)))
        cat = r.category
        cat_raw = None if rng.random() < .09 else str(rng.choice(cat_variants(cat)))
        if cat_raw is not None and rng.random() < .02:
            cat_raw = "unknown"
        rec = dict(
            id=r.incident_id, feed=r.feed_id,
            client=None if rng.random() < .005 else r.client_id,
            opened=fmt_time(r.opened, t_fmt), closed=fmt_time(closed, 0 if t_fmt != 3 else 3),
            cat=cat_raw, sev=sev_variants[r.sev][int(rng.integers(0, 4))],
            src=str(rng.choice(src_variants[r.detection])),
            team=str(rng.choice(team_variants[r.team])), esc=esc_variants[bool(r.escalated)][int(rng.integers(0, 3))],
            first_resp_min=r.first_resp_min,
            notes=make_note(cat, r.region))
        out.append(rec)
        if rng.random() < .015:  # reintento duplicado del sistema de monitoreo
            dup = dict(rec)
            dup["opened"] = fmt_time(r.opened, 0)
            out.append(dup)
        truth.append(dict(incident_id=r.incident_id, true_category=cat, true_res_hours=round(r.res_hours, 3)))
    with open(RAW / "incidents_raw.jsonl", "w", encoding="utf-8") as fh:
        for rec in out:
            fh.write(json.dumps(rec, ensure_ascii=False) + "\n")
    return len(out), pd.DataFrame(truth)


def main():
    write_events_xml()
    clients, feeds = build_catalog()
    dl = simulate_deliveries(clients, feeds)
    n_lines = write_delivery_log(dl)
    inc = simulate_incidents(dl, clients, feeds)
    n_inc_raw, truth_inc = write_incidents_raw(inc)

    # catalog with format noise
    c_out = clients.drop(columns=["frailty"]).copy()
    c_out["tier"] = [t.lower() if rng.random() < .03 else t for t in c_out["tier"]]
    c_out["region"] = [r + " " if rng.random() < .03 else r for r in c_out["region"]]
    c_out.to_csv(RAW / "clients.csv", index=False)
    feeds.drop(columns=[]).round({"base_records": 0, "base_latency_s": 0}).to_csv(RAW / "feeds.csv", index=False)

    truth_dl = dl.loc[dl["silent"], ["feed_id", "date"]].assign(silent_degradation=1)
    truth_dl["date"] = truth_dl["date"].dt.strftime("%Y-%m-%d")
    truth_dl.to_csv(RAW / "sim_truth_silent.csv", index=False)
    truth_inc.to_csv(RAW / "sim_truth_incidents.csv", index=False)

    print(f"clients={len(clients)} feeds={len(feeds)} feed_days={len(dl):,} log_lines={n_lines:,}")
    print(f"incidents (unique)={len(inc):,} raw_rows={n_inc_raw:,} breach_rate_true={inc['breach_true'].mean():.3f}")
    print(inc["category"].value_counts(normalize=True).round(3).to_dict())
    print("status:", dl["status"].value_counts(normalize=True).round(4).to_dict(), "silent:", int(dl['silent'].sum()))


if __name__ == "__main__":
    main()
