"""The EVA brief carries the same RAD dose screening the console's CONDITIONS block shows."""
from science.marswalk import brief

WINDOW = {"status": "ARCHIVED", "rate_E_median": 600.0, "iqr": [580.0, 624.0], "latest_sol": 4843, "latest_utc": "2026-03-21T00:00:00",
          "lag_days": 212, "window_sols": 30, "unit": "uGy/day"}


def plan(eva_h=4, rover="msl"):
    return {"budget": {"eva_h": eva_h}, "request": {"base": {"rover": rover}}}


def test_dose_is_daily_rate_times_eva_fraction_with_iqr_band():
    d = brief.dose_screening(plan(8), WINDOW)
    assert d["value"] == 200.0 and d["band"] == [193.3, 208.0] and d["unit"] == "uGy"
    assert d["evidence"] == "DERIVED" and d["ledger_id"] == "NEURONEXUS_DOSE_SCREENING"
    assert d["input"]["ledger_id"] == "MSL_RAD_RDR" and d["input"]["lag_days"] == 212
    assert "safe" not in str(d).lower()


def test_no_number_when_the_archive_is_sparse_or_missing():
    sparse = {**WINDOW, "status": "INSUFFICIENT DATA FOR AN ESTIMATE", "reason": "fewer than 5 sols"}
    assert "value" not in brief.dose_screening(plan(), sparse)
    missing = brief.dose_screening(plan(), {"status": "UNAVAILABLE", "reason": "no RAD summaries"})
    assert missing["status"] == "UNAVAILABLE" and "value" not in missing


def test_jezero_says_the_rate_was_measured_at_gale():
    assert "Gale" in brief.dose_screening(plan(4, "m2020"), WINDOW)["note"]
