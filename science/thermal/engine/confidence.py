from __future__ import annotations

from dataclasses import dataclass
from math import inf


@dataclass(frozen=True)
class ThermalEvidence:
    observation_count: int
    seasonal_bins: int
    largest_ls_gap_deg: float
    spatial_cells: int
    years: int
    lst_span_hours: float


def score(e: ThermalEvidence) -> dict:
    """
    Evidence-support score.

    This is NOT a measurement-accuracy estimate.
    It describes how strongly a visualization is supported
    by the available THEMIS observations.
    """

    # Observation density: saturates at 12 observations.
    density = min(e.observation_count / 12.0, 1.0)

    # Seasonal coverage: 24 bins = full 15-degree cycle.
    seasonal = min(e.seasonal_bins / 24.0, 1.0)

    # Penalize large seasonal gaps.
    gap = max(0.0, 1.0 - max(e.largest_ls_gap_deg - 15.0, 0.0) / 90.0)

    # Multi-year support.
    years = min(e.years / 3.0, 1.0)

    # Spatial support.
    spatial = min(e.spatial_cells / 3.0, 1.0)

    # Prefer reasonably controlled local-solar-time sampling.
    lst = max(0.0, 1.0 - min(e.lst_span_hours / 6.0, 1.0))

    components = {
        "observation_density": density,
        "seasonal_coverage": seasonal,
        "seasonal_gap": gap,
        "multi_year_support": years,
        "spatial_support": spatial,
        "local_time_consistency": lst,
    }

    # Seasonal coverage and observations carry the most weight.
    weights = {
        "observation_density": 0.25,
        "seasonal_coverage": 0.25,
        "seasonal_gap": 0.20,
        "multi_year_support": 0.12,
        "spatial_support": 0.10,
        "local_time_consistency": 0.08,
    }

    raw = sum(components[k] * weights[k] for k in components)
    value = round(raw * 100.0, 1)

    if value >= 80:
        label = "strong evidence"
    elif value >= 60:
        label = "moderate evidence"
    elif value >= 40:
        label = "limited evidence"
    else:
        label = "sparse evidence"

    return {
        "score": value,
        "label": label,
        "components": components,
    }
