"""API tests (FastAPI TestClient, no server needed). Run: python -m pytest tests -q"""
import sys
from pathlib import Path

from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from src.api import app  # noqa: E402

c = TestClient(app)


def test_health():
    r = c.get("/health"); assert r.status_code == 200 and r.json()["status"] == "ok"


def test_feeds_filter_and_limit():
    r = c.get("/feeds", params={"feed_type": "EPG_LINEAR", "limit": 3}).json()
    assert len(r) == 3 and all(x["feed_type"] == "EPG_LINEAR" for x in r)


def test_diagnosis_schema_case():
    r = c.get("/feeds/F-0062/diagnosis", params={"as_of": "2026-08-29"}).json()
    assert r["ranked"][0]["family"] == "schema" and r["action"][0].startswith("Escalate")


def test_ticket_is_markdown_with_client_message():
    t = c.get("/feeds/F-0062/ticket", params={"as_of": "2026-08-29"}).text
    assert t.startswith("# Escalation") and "Client message" in t


def test_validation_errors():
    assert c.get("/feeds/not-a-feed/diagnosis").status_code == 422
    assert c.get("/feeds/F-9999/diagnosis").status_code == 404
    assert c.get("/feeds/F-0062/diagnosis", params={"as_of": "yesterday"}).status_code == 422
