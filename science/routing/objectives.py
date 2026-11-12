"""Objective weights, presets and the documented scalarisation."""

from __future__ import annotations

import math
from typing import Any

OBJECTIVE_KEYS: tuple[str, ...] = ("eva", "terrain", "science", "operational")

OBJECTIVE_LABELS: dict[str, str] = {
    "eva": "EVA burden",
    "terrain": "Terrain burden",
    "science": "Science opportunity",
    "operational": "Operational burden",
}

PRESETS: dict[str, dict[str, Any]] = {
    "LOW_EVA": {
        "label": "Low EVA",
        "weights": {"eva": 100, "terrain": 0, "science": 0, "operational": 0},
        "basis": "Single objective: minimise ESTIMATED EVA TIME (distance / pace + ascent allowance).",
    },
    "LOW_TERRAIN": {
        "label": "Low terrain burden",
        "weights": {"eva": 0, "terrain": 100, "science": 0, "operational": 0},
        "basis": "Single objective: minimise length-weighted MOLA slope/roughness burden.",
    },
    "SCIENCE_FIRST": {
        "label": "Science first",
        "weights": {"eva": 15, "terrain": 20, "science": 55, "operational": 10},
        "basis": "Weighted sum dominated by proximity to catalogued evidence items.",
    },
    "BALANCED": {
        "label": "Balanced",
        "weights": {"eva": 25, "terrain": 25, "science": 25, "operational": 25},
        "basis": "Equal weights across the four normalised objectives.",
    },
}

# Candidates optimised for a single physical quantity that is not one of
# the four weighted objectives.
SPECIAL_CANDIDATES: dict[str, dict[str, str]] = {
    "LOW_DISTANCE": {
        "label": "Low distance",
        "basis": "Single objective: minimise surface path length on the planning grid.",
    },
    "LOW_RISK": {
        "label": "Low terrain-risk proxy",
        "basis": (
            "Single objective: minimise a convex extreme-terrain edge cost "
            "L * (1 + (slope/15 deg)^3 + (max slope/15 deg)^3 + (roughness/50 m)^3)."
        ),
    },
}

SCALARISATION = (
    "objective_score = sum_i (w_i / 100) * f_i / f_i*, where f_i is the route's "
    "accumulated edge cost for objective i and f_i* is the minimum achievable value "
    "of that objective on the same planning grid (its single-objective optimum). "
    "Lower is better; 1.0 would mean every objective sits at its own optimum."
)


def normalise_weights(weights: dict[str, Any] | None) -> dict[str, int]:
    """Return integer weights over OBJECTIVE_KEYS that sum to exactly 100.

    Uses the largest-remainder method so rounding never breaks the total.
    Empty or all-zero input falls back to the BALANCED preset.
    """
    raw: dict[str, float] = {}
    for key in OBJECTIVE_KEYS:
        try:
            value = float((weights or {}).get(key, 0) or 0)
        except (TypeError, ValueError):
            value = 0.0
        raw[key] = value if math.isfinite(value) and value > 0 else 0.0
    total = sum(raw.values())
    if total <= 0:
        return dict(PRESETS["BALANCED"]["weights"])
    scaled = {key: raw[key] * 100.0 / total for key in OBJECTIVE_KEYS}
    floors = {key: int(math.floor(scaled[key])) for key in OBJECTIVE_KEYS}
    remainder = 100 - sum(floors.values())
    order = sorted(
        OBJECTIVE_KEYS,
        key=lambda k: (-(scaled[k] - floors[k]), OBJECTIVE_KEYS.index(k)),
    )
    for key in order[:remainder]:
        floors[key] += 1
    return floors


def weights_equal(a: dict[str, int], b: dict[str, int]) -> bool:
    return all(int(a.get(k, 0)) == int(b.get(k, 0)) for k in OBJECTIVE_KEYS)
