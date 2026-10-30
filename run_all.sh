#!/usr/bin/env bash
# Runs the whole project, from raw data to dashboard. Requires Python 3.10+.
set -euo pipefail
cd "$(dirname "$0")"
python3 src/01_generate_data.py   # synthetic raw data (fixed seed)
python3 src/02_etl.py             # extract / transform / load -> SQLite
python3 src/03_nlp_triage.py      # fills in missing root causes with NLP
python3 src/04_sql_analytics.py   # 18 analytical queries -> outputs/sql_results.json
python3 src/05_models.py          # classification, forecast, anomalies
python3 src/07_investigate.py --top 10
python3 src/08_validate_investigator.py
python3 src/10_alert_simulation.py
python3 src/11_runbook.py
python3 src/06_build_dashboard.py # dashboard/index.html
echo "Done: open dashboard/index.html"
