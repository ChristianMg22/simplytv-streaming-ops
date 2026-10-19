-- analytics.sql : analytical queries (CTEs, window functions, anti-joins, NTILE, LAG)
-- Each "-- name: x" block is run by src/04_sql_analytics.py and exported to outputs/sql_results.json

-- name: kpi_overview
WITH r AS (SELECT * FROM v_incident WHERE state = 'resolved'),
ranked AS (
    SELECT resolution_hours,
           ROW_NUMBER() OVER (ORDER BY resolution_hours) AS rn,
           COUNT(*)     OVER ()                          AS n
    FROM r
),
med AS (SELECT AVG(resolution_hours) AS v FROM ranked WHERE rn IN ((n + 1) / 2, (n + 2) / 2)),
p90 AS (SELECT resolution_hours AS v FROM ranked WHERE rn = CAST(0.9 * n AS INTEGER) + 1)
SELECT
    (SELECT COUNT(*) FROM v_incident)                                         AS incidents_total,
    (SELECT COUNT(*) FROM r)                                                  AS incidents_resolved,
    (SELECT COUNT(*) FROM v_incident WHERE state = 'open')                    AS incidents_open,
    (SELECT COUNT(*) FROM v_incident WHERE state = 'invalid_closure')         AS incidents_invalid_closure,
    (SELECT ROUND(100.0 * AVG(sla_breach), 2) FROM r)                         AS sla_breach_pct,
    (SELECT SUM(sla_breach) FROM r)                                           AS sla_breaches,
    (SELECT ROUND(v, 2) FROM med)                                             AS median_resolution_h,
    (SELECT ROUND(v, 2) FROM p90)                                             AS p90_resolution_h,
    (SELECT ROUND(AVG(first_response_min), 1) FROM v_incident)                AS mean_first_response_min,
    (SELECT ROUND(100.0 * AVG(escalated), 1) FROM v_incident)                 AS escalation_pct,
    (SELECT COUNT(*) FROM fact_delivery)                                      AS feed_days,
    (SELECT COUNT(*) FROM dim_client)                                         AS clients,
    (SELECT COUNT(*) FROM dim_feed)                                           AS feeds,
    (SELECT ROUND(100.0 * SUM(is_bad) / COUNT(*), 2) FROM v_delivery)         AS bad_delivery_pct,
    (SELECT MIN(delivery_date) FROM fact_delivery)                            AS data_from,
    (SELECT MAX(delivery_date) FROM fact_delivery)                            AS data_to;

-- name: monthly_trend
WITH inc AS (
    SELECT open_month AS m, COUNT(*) AS incidents, SUM(sla_breach) AS breaches, COUNT(sla_breach) AS resolved
    FROM v_incident GROUP BY open_month
),
dl AS (
    SELECT substr(delivery_date, 1, 7) AS m, COUNT(*) AS feed_days, SUM(is_bad) AS bad_days,
           COUNT(DISTINCT feed_id) AS active_feeds
    FROM v_delivery GROUP BY 1
)
SELECT dl.m AS month,
       COALESCE(inc.incidents, 0)                                              AS incidents,
       dl.active_feeds,
       dl.feed_days,
       ROUND(1000.0 * COALESCE(inc.incidents, 0) / dl.feed_days, 2)            AS incidents_per_1k_feeddays,
       ROUND(100.0 * inc.breaches / NULLIF(inc.resolved, 0), 1)                AS breach_pct,
       ROUND(100.0 * dl.bad_days / dl.feed_days, 2)                            AS bad_delivery_pct
FROM dl LEFT JOIN inc USING (m)
ORDER BY dl.m;

-- name: category_pareto
WITH c AS (
    SELECT category, COUNT(*) AS n, SUM(sla_breach) AS b, COUNT(sla_breach) AS r,
           ROUND(AVG(resolution_hours), 1) AS mean_h, ROUND(100.0 * AVG(escalated), 1) AS esc_pct
    FROM v_incident GROUP BY category
),
t AS (SELECT SUM(n) AS tot, SUM(b) AS tot_b FROM c)
SELECT category, n,
       ROUND(100.0 * n / tot, 1)                                                AS share_pct,
       ROUND(100.0 * SUM(n) OVER (ORDER BY n DESC ROWS UNBOUNDED PRECEDING) / tot, 1) AS cum_share_pct,
       ROUND(100.0 * b / r, 1)                                                  AS breach_pct,
       ROUND(100.0 * b / tot_b, 1)                                              AS breach_share_pct,
       mean_h, esc_pct
FROM c, t
ORDER BY n DESC;

-- name: sla_matrix
SELECT severity, tier, MAX(sla_hours) AS sla_hours, COUNT(*) AS incidents,
       ROUND(100.0 * AVG(sla_breach), 1) AS breach_pct,
       ROUND(AVG(resolution_hours), 1)   AS mean_resolution_h
FROM v_incident WHERE state = 'resolved'
GROUP BY severity, tier
ORDER BY severity, CASE tier WHEN 'Gold' THEN 1 WHEN 'Silver' THEN 2 ELSE 3 END;

-- name: segment_summary
SELECT segment, COUNT(*) AS incidents, ROUND(100.0 * AVG(sla_breach), 1) AS breach_pct,
       ROUND(AVG(resolution_hours), 1) AS mean_resolution_h, ROUND(100.0 * AVG(escalated), 1) AS esc_pct
FROM v_incident WHERE state = 'resolved'
GROUP BY segment ORDER BY incidents DESC;

-- name: region_summary
WITH d AS (
    SELECT region, COUNT(*) AS feed_days, COUNT(DISTINCT feed_id) AS feeds, COUNT(DISTINCT client_id) AS clients,
           ROUND(100.0 * SUM(is_bad) / COUNT(*), 2) AS bad_delivery_pct
    FROM v_delivery GROUP BY region
),
i AS (
    SELECT region, COUNT(*) AS incidents, SUM(sla_breach) AS b, COUNT(sla_breach) AS r,
           ROUND(AVG(resolution_hours), 1) AS mean_resolution_h
    FROM v_incident GROUP BY region
)
SELECT d.region, d.clients, d.feeds, d.feed_days, i.incidents,
       ROUND(1000.0 * i.incidents / d.feed_days, 2) AS incidents_per_1k_feeddays,
       ROUND(100.0 * i.b / i.r, 1) AS breach_pct, i.mean_resolution_h, d.bad_delivery_pct
FROM d JOIN i USING (region)
ORDER BY incidents_per_1k_feeddays DESC;

-- name: feed_type_summary
WITH d AS (
    SELECT feed_type, COUNT(*) AS feed_days, ROUND(100.0 * SUM(is_bad) / COUNT(*), 2) AS bad_delivery_pct
    FROM v_delivery GROUP BY feed_type
),
i AS (
    SELECT feed_type, COUNT(*) AS incidents, ROUND(100.0 * AVG(sla_breach), 1) AS breach_pct
    FROM v_incident GROUP BY feed_type
)
SELECT d.feed_type, d.feed_days, d.bad_delivery_pct, i.incidents,
       ROUND(1000.0 * i.incidents / d.feed_days, 2) AS incidents_per_1k_feeddays, i.breach_pct
FROM d JOIN i USING (feed_type) ORDER BY incidents_per_1k_feeddays DESC;

-- name: heatmap_dow_hour
-- 4-hour blocks (UTC) x day of week (0 = Sunday)
SELECT open_dow AS dow, open_hour / 4 AS block, COUNT(*) AS incidents,
       ROUND(100.0 * AVG(sla_breach), 1) AS breach_pct
FROM v_incident WHERE state = 'resolved'
GROUP BY open_dow, open_hour / 4
ORDER BY open_dow, block;

-- name: detection_summary
SELECT detection, COUNT(*) AS incidents,
       ROUND(AVG(first_response_min), 1)  AS mean_first_response_min,
       ROUND(AVG(resolution_hours), 1)    AS mean_resolution_h,
       ROUND(100.0 * AVG(sla_breach), 1)  AS breach_pct
FROM v_incident WHERE state = 'resolved'
GROUP BY detection;

-- name: detection_delay
-- MTTD: time between the feed's most recent faulty delivery and the incident opening
WITH m AS (
    SELECT i.incident_id, i.detection,
           (julianday(i.opened_at) - julianday(d.delivery_ts)) * 24.0 AS delay_h,
           ROW_NUMBER() OVER (PARTITION BY i.incident_id ORDER BY d.delivery_ts DESC) AS rk
    FROM v_incident i
    JOIN fact_delivery d ON d.feed_id = i.feed_id AND d.status <> 'OK'
                        AND d.delivery_ts <= i.opened_at
                        AND julianday(i.opened_at) - julianday(d.delivery_ts) < 4
)
SELECT detection, COUNT(*) AS matched_incidents, ROUND(AVG(delay_h), 2) AS mean_detection_delay_h,
       ROUND(MIN(delay_h), 2) AS min_h, ROUND(MAX(delay_h), 2) AS max_h
FROM m WHERE rk = 1 GROUP BY detection;

-- name: missed_failures
-- FAILED/DEGRADED deliveries that never generated an incident within 72 h (anti-join with EXISTS)
SELECT d.status,
       COUNT(*) AS bad_deliveries,
       SUM(CASE WHEN EXISTS (
               SELECT 1 FROM fact_incident i
               WHERE i.feed_id = d.feed_id AND i.opened_at >= d.delivery_ts
                 AND julianday(i.opened_at) - julianday(d.delivery_ts) <= 3) THEN 0 ELSE 1 END) AS no_incident
FROM fact_delivery d WHERE d.status <> 'OK'
GROUP BY d.status;

-- name: event_impact
-- Incidents per 1,000 feed-days, 45 days before vs 45 days after each public milestone,
-- only in the affected regions (CEO event = placebo: applies to all regions).
WITH w AS (
    SELECT event_id, name, event_date, 'before' AS side, date(event_date, '-45 day') AS d0, event_date AS d1 FROM dim_event
    UNION ALL
    SELECT event_id, name, event_date, 'after',  event_date, date(event_date, '+45 day') FROM dim_event
),
scope AS (
    SELECT e.event_id, r.region FROM dim_event e JOIN (SELECT DISTINCT region FROM dim_client) r
      ON e.region_scope = 'ALL'
      OR EXISTS (SELECT 1 FROM dim_event_region x WHERE x.event_id = e.event_id AND x.region = r.region)
),
fd AS (
    SELECT w.event_id, w.side, COUNT(*) AS feed_days
    FROM w JOIN scope s ON s.event_id = w.event_id
           JOIN v_delivery d ON d.region = s.region AND d.delivery_date >= w.d0 AND d.delivery_date < w.d1
    GROUP BY w.event_id, w.side
),
ic AS (
    SELECT w.event_id, w.side, COUNT(*) AS incidents
    FROM w JOIN scope s ON s.event_id = w.event_id
           JOIN v_incident i ON i.region = s.region AND i.open_date >= w.d0 AND i.open_date < w.d1
    GROUP BY w.event_id, w.side
)
SELECT e.event_id, e.event_date, e.name, e.kind, e.region_scope,
       b.feed_days AS fd_before, a.feed_days AS fd_after,
       COALESCE(ib.incidents, 0) AS inc_before, COALESCE(ia.incidents, 0) AS inc_after,
       ROUND(1000.0 * COALESCE(ib.incidents, 0) / NULLIF(b.feed_days, 0), 2) AS rate_before,
       ROUND(1000.0 * COALESCE(ia.incidents, 0) / NULLIF(a.feed_days, 0), 2) AS rate_after
FROM dim_event e
LEFT JOIN fd b  ON b.event_id  = e.event_id AND b.side  = 'before'
LEFT JOIN fd a  ON a.event_id  = e.event_id AND a.side  = 'after'
LEFT JOIN ic ib ON ib.event_id = e.event_id AND ib.side = 'before'
LEFT JOIN ic ia ON ia.event_id = e.event_id AND ia.side = 'after'
ORDER BY e.event_date;

-- name: client_pareto
-- What share of SLA breaches do the most problematic 10% / 20% of clients account for?
WITH cb AS (
    SELECT client_id, SUM(sla_breach) AS b FROM v_incident GROUP BY client_id
),
r AS (SELECT client_id, b, NTILE(10) OVER (ORDER BY b DESC) AS decile FROM cb)
SELECT decile, COUNT(*) AS clients, SUM(b) AS breaches,
       ROUND(100.0 * SUM(b) / (SELECT SUM(b) FROM cb), 1) AS share_pct,
       ROUND(100.0 * SUM(SUM(b)) OVER (ORDER BY decile) / (SELECT SUM(b) FROM cb), 1) AS cum_share_pct
FROM r GROUP BY decile ORDER BY decile;

-- name: top_clients
WITH s AS (
    SELECT client_id, segment, region, tier, COUNT(*) AS incidents, SUM(sla_breach) AS breaches,
           ROUND(100.0 * AVG(sla_breach), 1) AS breach_pct, ROUND(AVG(resolution_hours), 1) AS mean_h
    FROM v_incident WHERE state = 'resolved' GROUP BY client_id, segment, region, tier
)
SELECT RANK() OVER (ORDER BY breaches DESC) AS rank, c.client_name, s.segment, s.region, s.tier,
       s.incidents, s.breaches, s.breach_pct, s.mean_h
FROM s JOIN dim_client c USING (client_id)
ORDER BY breaches DESC, incidents DESC LIMIT 10;

-- name: recurrence
-- Recurrence: same feed + same cause within 14 days (LAG)
WITH s AS (
    SELECT category, opened_at,
           LAG(opened_at) OVER (PARTITION BY feed_id, category ORDER BY opened_at) AS prev
    FROM v_incident
)
SELECT category, COUNT(*) AS incidents,
       SUM(CASE WHEN prev IS NOT NULL AND julianday(opened_at) - julianday(prev) <= 14 THEN 1 ELSE 0 END) AS recurring,
       ROUND(100.0 * SUM(CASE WHEN prev IS NOT NULL AND julianday(opened_at) - julianday(prev) <= 14 THEN 1 ELSE 0 END)
             / COUNT(*), 1) AS recurring_pct
FROM s GROUP BY category ORDER BY recurring_pct DESC;

-- name: team_summary
SELECT team, COUNT(*) AS incidents, ROUND(AVG(resolution_hours), 1) AS mean_resolution_h,
       ROUND(100.0 * AVG(sla_breach), 1) AS breach_pct, ROUND(100.0 * AVG(escalated), 1) AS esc_pct
FROM v_incident WHERE state = 'resolved' GROUP BY team ORDER BY incidents DESC;

-- name: sla_utilization
-- Distribution of (resolution time / SLA): >100% = breach
SELECT CASE WHEN u < 0.25 THEN '0-25%' WHEN u < 0.5 THEN '25-50%' WHEN u < 0.75 THEN '50-75%'
            WHEN u < 1.0 THEN '75-100%' WHEN u < 1.5 THEN '100-150%' WHEN u < 2.0 THEN '150-200%' ELSE '200%+' END AS bucket,
       MIN(u) AS lo, COUNT(*) AS incidents
FROM (SELECT resolution_hours / sla_hours AS u FROM v_incident WHERE state = 'resolved')
GROUP BY bucket ORDER BY lo;

-- name: feed_age_effect
-- New feeds fail more: bad-delivery rate by feed age
SELECT CASE WHEN age < 30 THEN '0-30 d' WHEN age < 90 THEN '30-90 d' WHEN age < 180 THEN '90-180 d'
            WHEN age < 365 THEN '180-365 d' ELSE '>365 d' END AS feed_age,
       MIN(age) AS lo, COUNT(*) AS feed_days, ROUND(100.0 * AVG(is_bad), 2) AS bad_delivery_pct
FROM (SELECT d.is_bad, CAST(julianday(d.delivery_date) - julianday(f.start_date) AS INTEGER) AS age
      FROM v_delivery d JOIN dim_feed f USING (feed_id))
GROUP BY feed_age ORDER BY lo;
