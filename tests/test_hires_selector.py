"""Deterministic product ranking, 404 handling and the ladder priority mosaic (T1.3, T1.6)."""
from __future__ import annotations

import numpy as np
import pytest

from science.hires import catalog, datum, ladder, reader, stac
from science.hires.catalog import Product
from tests.hires_fixtures import HREF_PREFIX, write_product

BBOX = [137.38, -4.72, 137.42, -4.68]


def _product(pid, family="HIRISE", gsd=1.0, median=0.0, nmad=5.0, ok=True, geometry_bbox=BBOX):
    x0, y0, x1, y1 = geometry_bbox
    geom = {"type": "Polygon", "coordinates": [[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]]}
    p = Product(product_id=pid, family=family, collection="c", gsd_m=gsd, bbox=list(geometry_bbox), geometry=geom,
                dtm_href=HREF_PREFIX + f"{pid}.tif", dtm_asset="dtm", datum_family="areoid")
    p.asset_status = {"status": "OK" if ok else "UNAVAILABLE", "reason": None if ok else "HTTP 404"}
    p.datum = {"accepted": True, "median_m": median, "nmad_m": nmad}
    return p


def test_ranking_order_is_deterministic():
    products = [
        _product("CTX_A", family="CTX", gsd=20.0),
        _product("DTEEC_B", median=12.0),
        _product("DTEEC_C", median=1.0),
        _product("DTEEC_D", ok=False),
        _product("DTEEC_E", median=1.0, geometry_bbox=[137.38, -4.72, 137.40, -4.68]),  # half coverage
        _product("DTEEC_F", gsd=2.0, median=1.0),
    ]
    ranked = sorted(products, key=lambda p: catalog.rank_key(p, BBOX))
    assert [p.product_id for p in ranked] == ["DTEEC_C", "DTEEC_B", "DTEEC_F", "DTEEC_E", "DTEEC_D", "CTX_A"]
    assert sorted(reversed(products), key=lambda p: catalog.rank_key(p, BBOX)) == ranked


def test_newer_product_id_breaks_ties():
    a, b = _product("DTEEC_009149"), _product("DTEEC_018854")
    assert sorted([a, b], key=lambda p: catalog.rank_key(p, BBOX))[0].product_id == "DTEEC_018854"


def test_jittery_ctx_fails_qa():
    assert not catalog.qa_pass(_product("CTX_J", family="CTX", gsd=20.0, nmad=55.0))


def test_parse_qa_metrics():
    text = "Max difference:       214.29 meters\nMean difference:      -0.31 meters\nMedian difference:    2.24 meters"
    assert catalog.parse_qa_metrics(text) == {"max_m": 214.29, "mean_m": -0.31, "median_m": 2.24}


def test_ladder_fills_by_priority_and_records_404(tmp_path, monkeypatch):
    monkeypatch.setattr(reader, "corridor_dir", lambda: tmp_path)
    # A covers the west and B the east, overlapping by 100 m; equal coverage, so |offset| decides.
    nodata = -3.4028226550889045e38
    write_product(tmp_path / "A.tif", -4.70, 137.40, lambda e, n: np.where(e < 50, -4400.0, nodata), half_m=400.0)
    write_product(tmp_path / "B.tif", -4.70, 137.40, lambda e, n: np.where(e > -50, -4401.0, nodata), half_m=400.0)
    a = _product("A", geometry_bbox=[137.385, -4.715, 137.4017, -4.685])
    b = _product("B", median=3.0, geometry_bbox=[137.3983, -4.715, 137.415, -4.685])
    missing = _product("Z_404", ok=False)
    monkeypatch.setattr(ladder, "_candidates", lambda grid, family: [a, b, missing] if family == "HIRISE" else [])
    monkeypatch.setattr(ladder, "_probe_and_check", lambda p: p)
    monkeypatch.setattr(datum.SAMPLER, "on_grid", lambda grid, kind="t": np.full(grid.shape, -4450.0, "float32"))
    monkeypatch.setattr(ladder, "_cache", type(ladder._cache)())
    window = ladder.build_window(-4.70, 137.40, 300.0, 2.0, "ladder")
    assert window.source_fractions()["HIRISE"] == 1.0
    used = [p["product_id"] for p in window.products]
    assert used == ["A", "B"]  # equal coverage: A ranks first (lower |offset|)
    assert any(e["product_id"] == "Z_404" and e["status"] == "UNAVAILABLE" for e in window.excluded)
    assert window.seams.any()
    assert window.seam_steps and window.seam_steps[0]["median_step_m"] == pytest.approx(1.0, abs=0.01)
    mola_only = ladder.build_window(-4.70, 137.40, 300.0, 2.0, "mola")
    assert mola_only.source_fractions()["MOLA"] == 1.0


def test_probe_records_unavailable(monkeypatch, tmp_path):
    monkeypatch.setenv("NEURONEXUS_CACHE_DIR", str(tmp_path))

    class R:
        status_code = 404
        headers = {}
    monkeypatch.setattr(stac, "_request", lambda *a, **k: R())
    entry = stac.probe_asset("https://astrogeo-ard.s3-us-west-2.amazonaws.com/x/missing.tif")
    assert entry["status"] == "UNAVAILABLE" and entry["reason"] == "HTTP 404"
    assert stac.asset_status()["https://astrogeo-ard.s3-us-west-2.amazonaws.com/x/missing.tif"]["reason"] == "HTTP 404"


def test_allowlist_rejects_other_hosts():
    from science import settings
    with pytest.raises(ValueError):
        settings.check_url("https://example.com/evil.tif")
    with pytest.raises(ValueError):
        settings.check_url("http://stac.astrogeology.usgs.gov/api")
