"""MOLA tiles resolve without Git LFS: repository copy, then the PDS cache, else an honest 503."""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from science.terrain import mola_store


def test_tile_names_for_hero_sites():
    assert mola_store.tile_name_for(-4.6, 137.4) == "megt00n090hb"
    assert mola_store.tile_name_for(18.4, 77.4) == "megt44n000hb"
    assert mola_store.tile_name_for(18.4, -282.6, "r") == "megr44n000hb"
    assert mola_store.tile_bounds("megt00n090hb") == (-44.0, 0.0, 90.0, 180.0)
    with pytest.raises(ValueError):
        mola_store.tile_name_for(89.0, 0.0)


def test_lfs_stub_is_not_a_tile(tmp_path):
    stub = tmp_path / "megt00n090hb.img"
    stub.write_text("version https://git-lfs.github.com/spec/v1\n")
    assert not mola_store.is_real_tile(stub)


def test_cache_copy_is_used_when_repository_holds_a_stub(tmp_path, monkeypatch):
    monkeypatch.setenv("NEURONEXUS_MOLA_DIR", str(tmp_path))
    monkeypatch.setattr(mola_store, "REPO_DIR", tmp_path / "repo")
    tile = tmp_path / "megt00n090hb.img"
    with tile.open("wb") as fh:  # sparse file with the exact MEG128 size
        fh.truncate(mola_store.TILE_BYTES)
    assert mola_store.tile_path("megt00n090hb") == tile
    assert mola_store.status()["tiles"]["megt00n090hb"] == "pds-cache"


def test_missing_tile_keeps_the_honest_503(tmp_path, monkeypatch):
    monkeypatch.setenv("NEURONEXUS_MOLA_DIR", str(tmp_path))
    monkeypatch.setattr(mola_store, "REPO_DIR", tmp_path / "repo")
    with pytest.raises(FileNotFoundError, match="fetch_mola.py"):
        mola_store.tile_path("megt00n090hb")
    from science.weather.api.environment import app

    response = TestClient(app).get("/terrain/window", params={"latitude": -4.6, "longitude": 137.4})
    assert response.status_code == 503


@pytest.mark.network
def test_pds_serves_full_size_tiles():
    import requests

    response = requests.head(f"{mola_store.PDS_MEG128_URL}megt00n090hb.img", timeout=30, allow_redirects=True)
    assert response.status_code == 200
    assert int(response.headers["content-length"]) == mola_store.TILE_BYTES
