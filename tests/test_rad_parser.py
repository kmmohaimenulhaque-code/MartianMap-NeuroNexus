"""RAD RDR stream parser on a real archive excerpt, plus the conditions contract (WS6)."""
from __future__ import annotations

import json
from datetime import UTC, datetime
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from science.conditions import rad

FIXTURE = Path(__file__).parent / "fixtures" / "rad_rdr_sol4843_excerpt.txt"


def test_parser_reads_dose_rates_from_a_real_rdr_excerpt():
    with FIXTURE.open("rb") as fh:
        records = rad.parse_lines(fh)
    assert len(records) == 1
    r = records[0]
    assert r["start_utc"] == "2026-080 17:18:00" and r["duration_s"] == 961.0
    assert r["dose_e_ugy_h"] == pytest.approx(6.58689) and r["dose_b_ugy_h"] == pytest.approx(6.84128)


def test_doy_timestamps():
    assert rad.utc_from_doy("2026-080 17:18:00") == datetime(2026, 3, 21, 17, 18, tzinfo=UTC)


def test_latest_window_reports_lag_and_insufficient_data(tmp_path, monkeypatch):
    sols = {str(s): {"sol": s, "status": "OK", "median_e_ugy_h": 6.5 + 0.01 * s % 3, "first_utc": "2026-080 17:18:00"}
            for s in range(4814, 4844)}
    snap = tmp_path / "rad.json"
    snap.write_text(json.dumps({"sols": sols, "retrieved_at": "2026-10-20"}))
    monkeypatch.setattr(rad, "SNAPSHOT", snap)
    w = rad.latest_window(today=datetime(2026, 10, 20, tzinfo=UTC))
    assert w["latest_sol"] == 4843 and w["lag_days"] == 212 and w["status"] == "ARCHIVED"
    assert w["iqr"][0] <= w["rate_E_median"] <= w["iqr"][1]
    snap.write_text(json.dumps({"sols": {"4843": sols["4843"]}}))
    assert rad.latest_window()["status"] == "INSUFFICIENT DATA FOR AN ESTIMATE"


def test_conditions_contract_labels_every_block(monkeypatch):
    from science.conditions import rems
    monkeypatch.setattr(rems, "feed", lambda category="msl": rems.load_snapshot(category))
    from science.weather.api.environment import app
    body = TestClient(app).get("/conditions", params={"site": "jezero"}).json()
    assert body["weather"]["label"].startswith("OUTREACH FEED") and body["weather"]["ledger_id"] == "MSL_REMS_OUTREACH"
    assert body["meda"]["status"] == "NO RECENT DATA" and body["meda"]["ledger_id"] == "M2020_MEDA_OUTREACH"
    assert body["rad"]["ledger_id"] == "MSL_RAD_RDR"
    assert body["dust"]["ledger_id"] == "NASA_AMES_MGCM"
    assert TestClient(app).get("/conditions", params={"site": "utopia"}).status_code == 400
