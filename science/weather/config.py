"""Weather/dust configuration shared by the environment engine and the /dust API."""

from __future__ import annotations

import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

# The mars-gcm submodule copy is canonical; the repository-root copy is the
# fallback when the submodule is not checked out (e.g. slim deployments).
# NEURONEXUS_DUST_FILE overrides both.
DUST_CANDIDATES = (
    ROOT / "external" / "mars-gcm" / "data" / "DustScenario_MY34.nc",
    ROOT / "DustScenario_MY34.nc",
)


def dust_file() -> Path:
    override = os.environ.get("NEURONEXUS_DUST_FILE")
    if override:
        return Path(override)
    for candidate in DUST_CANDIDATES:
        if candidate.exists():
            return candidate
    raise FileNotFoundError("DustScenario_MY34.nc not found in external/mars-gcm/data or the repository root.")
