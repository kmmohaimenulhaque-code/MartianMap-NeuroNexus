"""Datum family detection and mismatch exclusion against a stand-in MOLA (T1.4)."""
from __future__ import annotations

import numpy as np
import pytest

from science.hires import datum, reader
from tests.hires_fixtures import HREF_PREFIX, write_product

SPHERE_MINUS_AREOID_M = 1500.0  # stand-in for 3,396,190 m minus the local areoid radius


class FakeMola:
    def sample(self, lat, lon, kind="t"):
        return -2500.0 + 0.0 * np.asarray(lat, float)

    def sphere_to_areoid_offset(self, lat, lon):
        return SPHERE_MINUS_AREOID_M + 0.0 * np.asarray(lat, float)


@pytest.fixture()
def corridor(tmp_path, monkeypatch):
    monkeypatch.setattr(reader, "corridor_dir", lambda: tmp_path)
    return tmp_path


@pytest.mark.parametrize("family,offset,status,convert", [
    ("HIRISE", 5.0, "ACCEPTED", "none"),
    ("CTX", -45.0, "ACCEPTED", "none"),
    ("HIRISE", -45.0, "DATUM MISMATCH", "none"),
    ("CTX", -SPHERE_MINUS_AREOID_M + 10.0, "ACCEPTED (CONVERTED)", "sphere_to_areoid"),
    ("CTX", 700.0, "DATUM MISMATCH", "none"),
])
def test_datum_check(corridor, family, offset, status, convert):
    write_product(corridor / "d.tif", -4.7, 137.4, lambda e, n: -2500.0 + offset + 0.0 * e, half_m=300.0, res=5.0)
    result = datum._check(HREF_PREFIX + "d.tif", family, FakeMola())
    assert result["status"] == status
    assert result["n"] >= datum.MIN_SAMPLES
    assert result.get("convert", "none") == convert
    assert result["accepted"] is status.startswith("ACCEPTED")


def test_too_few_valid_pixels_is_insufficient(corridor):
    write_product(corridor / "tiny.tif", -4.7, 137.4, lambda e, n: 0.0 * e, half_m=20.0, res=5.0)
    result = datum._check(HREF_PREFIX + "tiny.tif", "HIRISE", FakeMola())
    assert result["status"] == "INSUFFICIENT DATA" and not result["accepted"]


def test_nmad():
    assert datum.nmad(np.array([1.0, 2.0, 3.0, 4.0, 100.0])) == pytest.approx(1.4826 * 1.0)
