import importlib.util
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("xv", ROOT / "src" / "09_xmltv_validate.py")
xv = importlib.util.module_from_spec(spec); spec.loader.exec_module(xv)


def test_planted_defects_are_found():
    rules = {i["rule"] for i in xv.validate(ROOT / "data" / "raw" / "sample_xmltv.xml")}
    assert {"stop_before_start", "missing_title", "unknown_channel"} <= rules


def test_malformed_xml_is_reported(tmp_path):
    f = tmp_path / "bad.xml"; f.write_text("<tv><programme></tv>")
    assert xv.validate(f)[0]["rule"] == "well_formed"


def test_clean_file_has_no_issues(tmp_path):
    f = tmp_path / "ok.xml"
    f.write_text('<tv><channel id="a"/><programme start="20260101080000 +0000" stop="20260101090000 +0000" channel="a"><title>X</title></programme></tv>')
    assert xv.validate(f) == []
