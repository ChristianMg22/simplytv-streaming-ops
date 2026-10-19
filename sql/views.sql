-- views.sql : semantic layer for analysis (a single definition of "SLA breach")

DROP VIEW IF EXISTS v_incident;
DROP VIEW IF EXISTS v_delivery;

CREATE VIEW v_incident AS
WITH base AS (
    SELECT
        i.incident_id, i.feed_id, i.client_id,
        c.segment, c.region, c.tier, c.onboard_date,
        f.feed_type,
        i.opened_at, i.closed_at,
        i.category_final AS category, i.category_origin,
        i.severity, i.detection, i.team, i.escalated, i.first_response_min,
        s.sla_hours,
        CASE
            WHEN i.dq_flag = 'negative_duration' THEN 'invalid_closure'
            WHEN i.closed_at IS NULL            THEN 'open'
            ELSE 'resolved'
        END AS state,
        CASE WHEN i.closed_at IS NOT NULL AND i.dq_flag IS NULL
             THEN (julianday(i.closed_at) - julianday(i.opened_at)) * 24.0 END AS resolution_hours,
        CAST(strftime('%H', i.opened_at) AS INTEGER) AS open_hour,
        CAST(strftime('%w', i.opened_at) AS INTEGER) AS open_dow,      -- 0 = Sunday
        strftime('%Y-%m', i.opened_at)               AS open_month,
        date(i.opened_at)                            AS open_date,
        CAST(julianday(date(i.opened_at)) - julianday(f.start_date) AS INTEGER) AS feed_age_days
    FROM fact_incident i
    JOIN dim_client c ON c.client_id = i.client_id
    JOIN dim_feed   f ON f.feed_id   = i.feed_id
    JOIN dim_sla    s ON s.severity  = i.severity AND s.tier = c.tier
)
SELECT *,
       CASE WHEN resolution_hours IS NULL THEN NULL
            WHEN resolution_hours > sla_hours THEN 1 ELSE 0 END AS sla_breach
FROM base;

CREATE VIEW v_delivery AS
SELECT d.*, c.segment, c.region, c.tier, f.feed_type,
       CASE WHEN d.status <> 'OK' THEN 1 ELSE 0 END AS is_bad
FROM fact_delivery d
JOIN dim_client c ON c.client_id = d.client_id
JOIN dim_feed   f ON f.feed_id   = d.feed_id;
