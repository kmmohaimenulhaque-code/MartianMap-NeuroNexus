"""One canonical ledger (WS8): schema, unique ids and aliases, no drift, every ledger id in code resolves."""
from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from science.sources import ledger

ROOT = Path(__file__).resolve().parents[1]
PY_PATTERNS = [re.compile(r"""["']ledger_id["']\s*:\s*["']([A-Za-z0-9_]+)["']"""),
               re.compile(r"""ledger_id\s*=\s*["']([A-Za-z0-9_]+)["']"""),
               re.compile(r"""source_ref\(\s*["']([A-Za-z0-9_]+)["']""")]
JS_PATTERNS = [re.compile(r"""ledgerId\s*[:=]\s*\{?\s*["']([A-Za-z0-9_]+)["']"""),
               re.compile(r"""ledger_id\s*:\s*["']([A-Za-z0-9_]+)["']""")]


def _scan(files, patterns):
    found = {}
    for path in files:
        text = path.read_text(encoding="utf-8", errors="ignore")
        for pattern in patterns:
            for match in pattern.finditer(text):
                found.setdefault(match.group(1), str(path.relative_to(ROOT)))
    return found


def test_ledger_validates_against_schema_with_unique_ids_and_aliases():
    assert ledger.validate() == []
    data = ledger.load()
    assert data["schema"] == "neuronexus.source-ledger.v3"
    assert len(data["entries"]) >= 70


def test_generated_files_have_not_drifted():
    result = subprocess.run([sys.executable, str(ROOT / "tools/build_ledger.py"), "--check"], capture_output=True,
                            text=True)
    assert result.returncode == 0, result.stderr


def test_every_ledger_id_used_in_code_resolves():
    py = [p for p in (ROOT / "science").rglob("*.py")]
    js = [p for ext in ("*.js", "*.jsx", "*.ts") for p in (ROOT / "frontend/src").rglob(ext) if "__tests__" not in p.parts]
    used = {**_scan(py, PY_PATTERNS), **_scan(js, JS_PATTERNS)}
    from science.hires.catalog import FAMILY_LEDGER
    from science.marswalk.config import PARAMETERS
    used.update({v: "science/hires/catalog.py" for v in FAMILY_LEDGER.values()})
    used.update({p["ledger_id"]: "science/marswalk/config.py" for p in PARAMETERS.values()})
    missing = {k: where for k, where in used.items() if ledger.resolve(k) is None}
    assert not missing, f"unregistered sources: {missing}"


def test_status_changes_made_by_this_work():
    assert ledger.resolve("HIRISE")["ingestion_status"] == "INGESTED"
    assert ledger.resolve("CTX")["ingestion_status"] == "INGESTED"
    for untouched in ("CRISM", "SHARAD", "MCS"):
        assert ledger.resolve(untouched)["ingestion_status"] == "CATALOGED NOT INGESTED"


def test_old_ids_resolve_through_aliases():
    assert ledger.resolve("MOLA")["id"] == "MOLA_MEGDR"
    assert ledger.resolve("nasa_mola")["id"] == "MOLA_MEGDR"
    assert ledger.resolve("NASA_RAD")["id"] == "MSL_RAD_RDR"
    assert ledger.resolve("gemini")["evidence_class"] == "AI INTERPRETATION"


def test_provenance_wrapper_stays_compatible():
    from science.provenance import source_ledger

    payload = source_ledger()
    assert {"schema", "classes", "evidence_statuses", "entries", "boundary", "repository_ledger"} <= set(payload)
    ids = {e["id"] for e in payload["entries"]}
    assert {"nasa_mola", "usgs_nomenclature", "gemini", "nn_route_engine"} <= ids
    assert all(ledger.resolve(e["ledger_id"]) for e in payload["entries"])
    assert payload["repository_ledger"]["schema"] == "neuronexus.source-ledger.v3"


def test_sources_api_lists_and_resolves_aliases():
    from science.weather.api.environment import app

    client = TestClient(app)
    listing = client.get("/sources").json()
    assert listing["schema"] == "neuronexus.source-ledger.v3" and listing["count"] == len(listing["entries"])
    assert client.get("/sources/nasa_themis").json()["id"] == "THEMIS"
    missing = client.get("/sources/NOPE_404")
    assert missing.status_code == 404 and missing.json()["error"] == "NOT_FOUND"


@pytest.mark.parametrize("path", ["data/manifests/source_ledger.json", "data/manifests/updated_source_ledger.json",
                                  "docs/DATA_SOURCES.md"])
def test_readme_ledger_links_resolve(path):
    assert (ROOT / path).is_file()
