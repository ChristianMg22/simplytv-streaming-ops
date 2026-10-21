"""Unit tests for the investigator. Run: python -m pytest tests -q  (or: python tests/test_investigate.py)"""
import importlib.util
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("inv", ROOT / "src" / "07_investigate.py")
inv = importlib.util.module_from_spec(spec); spec.loader.exec_module(inv)

OK = "2026-06-01T01:04:23Z INFO feed=F-0165 client=C-103 status=OK records=17169 expected=16968 latency_s=232 schema=v3.1 checksum=ok"


def test_parse_valid_line():
    d = inv.parse_line(OK)
    assert d["feed"] == "F-0165" and d["records"] == 17169 and d["date"] == "2026-06-01" and d["completeness"] > 1.0


def test_parse_junk_lines_return_none():
    for junk in ["2026-06-01T01:09:05Z DEBUG scheduler heartbeat ok", "", "garbage", OK[:60]]:
        assert inv.parse_line(junk) is None


def test_zero_expected_does_not_divide_by_zero():
    assert inv.parse_line(OK.replace("expected=16968", "expected=0"))["completeness"] == 0.0


def _row(**k):
    base = dict(date="2026-08-01", status="OK", records=100, expected=100, latency=100, schema="v3.1", checksum="ok", completeness=1.0)
    return base | k


BASE = dict(n=60, records=100, latency=100, completeness=1.0, schema="v3.1")


def test_schema_change_is_detected_and_ranked_first():
    rows = [_row(schema="v3.2", checksum="MISMATCH")]
    sy = inv.detect(rows, BASE, "2026-08-01", "2026-08-01")
    assert {s["code"] for s in sy} >= {"schema_change", "checksum_mismatch"}
    assert inv.diagnose(sy, "VOD_CATALOG")[0]["family"] == "schema"


def test_failed_deliveries_point_to_transport_owned_by_operations():
    rows = [_row(status="FAILED", records=0, completeness=0.0, date=f"2026-08-0{i}") for i in range(1, 4)]
    top = inv.diagnose(inv.detect(rows, BASE, "2026-08-01", "2026-08-03"), "EPG_LINEAR")[0]
    assert top["family"] == "transport" and top["owner"] == "Operations"


def test_content_candidates_follow_feed_type():
    sy = inv.detect([_row(status="DEGRADED", records=60, completeness=0.6)], BASE, "2026-08-01", "2026-08-01")
    assert inv.diagnose(sy, "ARTWORK")[0]["cause"] == "image_gap"
    assert inv.diagnose(sy, "SPORTS")[0]["cause"] == "stale_schedule"


def test_healthy_feed_needs_no_action():
    assert inv.decide(inv.diagnose(inv.detect([_row()], BASE, "2026-08-01", "2026-08-01"), "EPG_LINEAR"))[0] == "No action"


if __name__ == "__main__":
    for n, f in list(globals().items()):
        if n.startswith("test_"):
            f(); print("ok", n)
