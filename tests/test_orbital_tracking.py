import pytest

from science.orbital.small_bodies import THRESHOLDS, classify, get_near_mars_tracking, parse_records, parse_time_sigma

PAYLOAD = {
    "signature": {"source": "NASA/JPL SBDB Close Approach Data API", "version": "1.5"},
    "count": 2,
    "fields": ["des", "orbit_id", "jd", "cd", "dist", "dist_min", "dist_max", "v_rel", "v_inf", "t_sigma_f", "h", "diameter", "diameter_sigma", "fullname"],
    "data": [
        ["2015 MY53", "17", "2461544.46", "2027-May-18 23:06", "0.0038", "0.0038", "0.0526", "10.31", "10.30", "5_04:33", "25.4", None, None, "  (2015 MY53)"],
        ["4205", "55", "2461326.47", "2026-Oct-12 23:20", "0.0290", "0.0290", "0.0290", "7.47", "7.47", "< 00:01", "14.48", "3.2", "0.4", "4205 Davidhartley"],
    ],
}


def test_parses_real_cad_field_layout():
    records = parse_records(PAYLOAD)
    assert len(records) == 2
    first = records[0]
    assert first["designation"] == "2015 MY53"
    assert first["distance_au"] == pytest.approx(0.0038)
    assert first["distance_km"] == pytest.approx(0.0038 * 149597870.7)
    assert first["relative_velocity_km_s"] == pytest.approx(10.31)
    assert first["sbdb_url"].endswith("2015%20MY53")
    assert records[1]["diameter_km"] == pytest.approx(3.2)


@pytest.mark.parametrize("raw,minutes,upper", [("5_04:33", 7473.0, False), ("< 00:01", 1.0, True), ("07:03", 423.0, False), (None, None, False), ("n/a", None, False)])
def test_time_uncertainty_parsing(raw, minutes, upper):
    assert parse_time_sigma(raw) == (minutes, upper)


def test_classification_uses_documented_thresholds():
    assert classify(0.004, 0.003, 0.05, 60) == "HIGH-PRIORITY MONITORING"
    assert classify(0.009, 0.009, 0.009, 1) == "REVIEW"
    assert classify(0.03, 0.03, 0.03, 2000) == "REVIEW"          # time uncertainty
    assert classify(0.03, 0.001 + THRESHOLDS["high_priority_min_distance_au"], 0.05, 1) == "REVIEW"  # spread
    assert classify(0.03, 0.0299, 0.0301, 1) == "MONITORING"
    assert classify(0.2, 0.2, 0.2, 1) == "LOW-CONCERN"
    assert classify(None, None, None, None) == "DATA ONLY"


def test_source_failure_reports_unavailable_and_invents_nothing():
    def failing(_params):
        raise RuntimeError("connection reset")

    payload = get_near_mars_tracking(fetch=failing, use_cache=False)
    assert payload["status"] == "unavailable"
    assert payload["tracking_status"] == "DATA SOURCE UNAVAILABLE"
    assert payload["objects"] == [] and payload["count"] == 0


def test_successful_query_is_labelled_live():
    payload = get_near_mars_tracking(fetch=lambda params: PAYLOAD, use_cache=False)
    assert payload["status"] == "live" and payload["count"] == 2
    assert payload["query"]["body"] == "Mars"
    assert "not an impact prediction" in " ".join(payload["limitations"]).lower()
