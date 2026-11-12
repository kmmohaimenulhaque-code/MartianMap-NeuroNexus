"""The single-container server routes like the Vite proxy and nginx.conf."""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from science import serve


@pytest.fixture()
def client(tmp_path, monkeypatch):
    (tmp_path / "index.html").write_text("<!doctype html><title>NeuroNexus</title>")
    (tmp_path / "assets").mkdir()
    (tmp_path / "assets" / "app.js").write_text("console.log(1)")
    monkeypatch.setattr(serve, "console", serve.ConsoleFiles(directory=tmp_path, html=True))
    return TestClient(serve.app)


def test_api_prefix_is_stripped(client):
    assert client.get("/api/openapi.json").json()["info"]["title"].startswith("NeuroNexus")


def test_console_and_spa_fallback(client):
    assert "NeuroNexus" in client.get("/").text
    assert "NeuroNexus" in client.get("/marswalk").text
    assert client.get("/assets/app.js").status_code == 200
    assert client.get("/assets/missing.js").status_code == 404


def test_fallback_pages_follow_the_three_entries():
    from science.serve import fallback_page

    assert fallback_page("console/settings") == "console/index.html"
    assert fallback_page("/console") == "console/index.html"
    assert fallback_page("tutorials/terrain-ladder") == "tutorials/index.html"
    assert fallback_page("marswalk") == "index.html"
