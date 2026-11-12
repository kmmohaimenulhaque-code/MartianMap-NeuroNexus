"""NASA / partner data-source ledger (compatibility wrapper).

The canonical ledger is data/manifests/source_ledger.json (schema v3, science/sources/ledger.py).
This module keeps the v2 ``source_ledger()`` output for /ai/provenance and existing callers.

Distinguishes EXTERNAL SOURCE, DERIVED OUTPUT, TEAM EXPERIMENT,
TEAM BENCHMARK, TEAM METHOD and AI INTERPRETATION so that AI prose is never
presented as a NASA observation.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
LEDGER_FILE = ROOT / "data" / "manifests" / "source_ledger.json"

CLASSES = ["EXTERNAL SOURCE", "DERIVED OUTPUT", "TEAM EXPERIMENT", "TEAM BENCHMARK", "TEAM METHOD", "AI INTERPRETATION"]

EVIDENCE_STATUSES = {
    "PROJECT DATA": "Stored in this application's own state.",
    "NASA OBSERVED": "A real instrument measurement from a NASA mission archive.",
    "NASA REFERENCE": "A published NASA/USGS reference value or catalog entry.",
    "MODELED": "Output of a physical model (e.g. NASA Ames Mars GCM).",
    "DERIVED": "Computed by NeuroNexus from observed or modeled inputs.",
    "COMPUTED": "Pure geometry or arithmetic computed by NeuroNexus.",
    "SIMULATED": "A configurable NeuroNexus simulation value, not a measurement.",
    "UNAVAILABLE": "No evidence is ingested; nothing is inferred.",
}

def _entries_from_canonical_ledger() -> list[dict[str, Any]]:
    """The v2 ENTRIES shape, generated from the canonical v3 ledger (lowercase ids are its aliases)."""
    from science.sources import ledger

    out = []
    for entry in ledger.load()["entries"]:
        prov = entry.get("provenance")
        if not prov:
            continue
        legacy_id = next((a for a in entry["aliases"] if a.islower()), entry["id"])
        out.append({"id": legacy_id, "class": prov["class"], "organisation": entry["organization"],
                    "title": entry["product_title"], "url": entry.get("url"), "use": prov["use"],
                    "ledger_id": entry["id"]})
    return out


ENTRIES: list[dict[str, Any]] = _entries_from_canonical_ledger()


def source_ledger() -> dict[str, Any]:
    payload: dict[str, Any] = {
        "schema": "neuronexus.source-ledger.v2",
        "classes": CLASSES,
        "evidence_statuses": EVIDENCE_STATUSES,
        "entries": ENTRIES,
        "boundary": "AI-generated prose is an AI INTERPRETATION and is never a NASA observation.",
        "canonical_ledger": "data/manifests/source_ledger.json (neuronexus.source-ledger.v3); GET /sources",
    }
    try:
        payload["repository_ledger"] = json.loads(LEDGER_FILE.read_text())
    except Exception:
        payload["repository_ledger"] = {"status": "UNAVAILABLE"}
    return payload
