"""Synthetic terrain so route tests never require the 2 GB MOLA LFS payload."""

from __future__ import annotations

import numpy as np

from science.routing.engine import TerrainGrid

PPD = 128.0


def ridge_grid(center_lat: float = -5.4, center_lon: float = 137.8, span_deg: float = 0.5) -> TerrainGrid:
    """A north-south ridge between start and destination, plus gentle texture."""
    lats = np.arange(center_lat + span_deg / 2, center_lat - span_deg / 2, -1.0 / PPD)
    lons = np.arange(center_lon - span_deg / 2, center_lon + span_deg / 2, 1.0 / PPD)
    lat_grid, lon_grid = np.meshgrid(lats, lons, indexing="ij")
    elevation = (
        -4400.0
        + 900.0 * np.exp(-(((lon_grid - center_lon) / 0.03) ** 2)) * (np.abs(lat_grid - center_lat) < 0.18)
        + 25.0 * np.sin(lat_grid * 45.0)
        + 15.0 * np.cos(lon_grid * 60.0)
    )
    return TerrainGrid.from_elevation(lats, lons, elevation)
