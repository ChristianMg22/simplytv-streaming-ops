-- schema.sql : dimensional (star) model for streaming-data operations
-- Motor: SQLite 3.45 (syntax compatible with Postgres/BigQuery except date functions)

PRAGMA foreign_keys = ON;

DROP VIEW  IF EXISTS v_incident;
DROP VIEW  IF EXISTS v_delivery;
DROP TABLE IF EXISTS fact_incident;
DROP TABLE IF EXISTS fact_delivery;
DROP TABLE IF EXISTS dim_event_region;
DROP TABLE IF EXISTS dim_event;
DROP TABLE IF EXISTS dim_sla;
DROP TABLE IF EXISTS dim_feed;
DROP TABLE IF EXISTS dim_client;
DROP TABLE IF EXISTS dq_log;

CREATE TABLE dim_client (
    client_id     TEXT PRIMARY KEY,
    client_name   TEXT NOT NULL,
    segment       TEXT NOT NULL,
    region        TEXT NOT NULL,
    tier          TEXT NOT NULL CHECK (tier IN ('Gold','Silver','Bronze')),
    onboard_date  TEXT NOT NULL
);

CREATE TABLE dim_feed (
    feed_id         TEXT PRIMARY KEY,
    client_id       TEXT NOT NULL REFERENCES dim_client(client_id),
    feed_type       TEXT NOT NULL,
    start_date      TEXT NOT NULL,
    base_records    REAL,
    sched_hour      INTEGER,
    base_latency_s  REAL
);

CREATE TABLE dim_sla (
    severity   TEXT NOT NULL CHECK (severity IN ('P1','P2','P3','P4')),
    tier       TEXT NOT NULL CHECK (tier IN ('Gold','Silver','Bronze')),
    sla_hours  REAL NOT NULL,
    PRIMARY KEY (severity, tier)
);

CREATE TABLE dim_event (
    event_id     TEXT PRIMARY KEY,
    event_date   TEXT NOT NULL,
    name         TEXT NOT NULL,
    kind         TEXT,
    region_scope TEXT,
    url          TEXT
);

CREATE TABLE dim_event_region (          -- "explosion" of region_scope (1 row per affected region)
    event_id TEXT NOT NULL REFERENCES dim_event(event_id),
    region   TEXT NOT NULL,
    PRIMARY KEY (event_id, region)
);

CREATE TABLE fact_delivery (             -- 1 row per feed and day
    feed_id           TEXT NOT NULL REFERENCES dim_feed(feed_id),
    client_id         TEXT NOT NULL REFERENCES dim_client(client_id),
    delivery_ts       TEXT NOT NULL,
    delivery_date     TEXT NOT NULL,
    status            TEXT NOT NULL CHECK (status IN ('OK','DEGRADED','FAILED')),
    records_delivered INTEGER NOT NULL,
    records_expected  INTEGER NOT NULL,
    latency_s         INTEGER NOT NULL,
    schema_version    TEXT,
    checksum          TEXT,
    completeness      REAL,
    PRIMARY KEY (feed_id, delivery_date)
);

CREATE TABLE fact_incident (
    incident_id        TEXT PRIMARY KEY,
    feed_id            TEXT NOT NULL REFERENCES dim_feed(feed_id),
    client_id          TEXT NOT NULL REFERENCES dim_client(client_id),
    opened_at          TEXT NOT NULL,
    closed_at          TEXT,
    category_raw       TEXT,
    category_final     TEXT,           -- normalized category; filled in by NLP triage if missing
    category_origin    TEXT,           -- 'reported' | 'nlp_triage'
    category_conf      REAL,           -- NLP triage confidence (NULL if it came reported)
    severity           TEXT NOT NULL CHECK (severity IN ('P1','P2','P3','P4')),
    detection          TEXT NOT NULL CHECK (detection IN ('auto','client')),
    team               TEXT,
    escalated          INTEGER NOT NULL,
    first_response_min REAL,
    notes              TEXT,
    dq_flag            TEXT            -- NULL = clean
);

CREATE INDEX ix_inc_client   ON fact_incident(client_id, opened_at);
CREATE INDEX ix_inc_feed     ON fact_incident(feed_id, opened_at);
CREATE INDEX ix_inc_opened   ON fact_incident(opened_at);
CREATE INDEX ix_del_status   ON fact_delivery(status, delivery_date);

CREATE TABLE dq_log (
    step   TEXT NOT NULL,
    metric TEXT NOT NULL,
    value  REAL NOT NULL
);
