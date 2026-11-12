"""The README "What's validated" table equals validation/reports/latest.json (no hand-typed numbers)."""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
LATEST = ROOT / "validation" / "reports" / "latest.json"


@pytest.mark.skipif(not LATEST.exists(), reason="validation suite not run yet")
def test_readme_table_matches_latest_json():
    result = subprocess.run([sys.executable, str(ROOT / "tools/update_readme_validation.py"), "--check"],
                            capture_output=True, text=True)
    assert result.returncode == 0, result.stderr


@pytest.mark.skipif(not LATEST.exists(), reason="validation suite not run yet")
def test_every_headline_number_carries_n_and_ci():
    latest = json.loads(LATEST.read_text())
    assert latest["schema_version"] == "neuronexus.validation.v1"
    for site in latest["sites"].values():
        assert site["headline"], "no headline metrics"
        for h in site["headline"]:
            assert h["n"] > 0 and h["value"] and h["meaning"]
            assert h["ci95"] is None or h["ci95"][0] <= h["ci95"][1]


def test_every_headline_value_lies_inside_its_own_ci():
    """A headline must pair a statistic with that statistic's CI (regression: V6 once showed a median with the mean's CI)."""
    import json
    from pathlib import Path

    latest = json.loads((Path(__file__).resolve().parents[1] / "validation/reports/latest.json").read_text())
    for site, entry in latest["sites"].items():
        for h in entry["headline"]:
            if h.get("ci95") and isinstance(h.get("number"), (int, float)):
                lo, hi = h["ci95"]
                value = h["number"] * (100 if h["id"] == "V4" and hi > 1 >= h["number"] else 1)
                assert lo - 0.051 <= value <= hi + 0.051, (site, h["id"], h["label"], h["number"], h["ci95"])
