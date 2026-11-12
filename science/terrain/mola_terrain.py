from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import numpy as np

from science.spatial.mola_unified import MolaUnified


@dataclass(frozen=True)
class TerrainWindow:
    """A small regularly sampled MOLA elevation window."""

    center_latitude: float
    center_longitude: float
    latitudes: np.ndarray
    longitudes: np.ndarray
    elevations_m: np.ndarray
    spacing_deg: float


class MolaTerrainSampler:
    """
    Sample a local terrain window from the validated unified MOLA engine.

    The sampler intentionally works on a small regional window rather than
    constructing a giant global Mars raster in memory.
    """

    def __init__(
        self,
        mola: MolaUnified | None = None,
    ) -> None:
        self.mola = mola or MolaUnified()

    def sample(
        self,
        latitude: float,
        longitude: float,
        *,
        radius: int = 2,
        spacing_deg: float = 1.0 / 128.0,
    ) -> TerrainWindow:
        """
        Sample a square elevation window around a Mars coordinate.

        Parameters
        ----------
        latitude:
            Planetocentric latitude in degrees.
        longitude:
            Longitude in degrees. Any longitude is accepted and normalized
            by the underlying MOLA engine.
        radius:
            Number of samples on each side of the centre.
            radius=2 produces a 5x5 window.
        spacing_deg:
            Angular spacing between neighbouring samples.

        Returns
        -------
        TerrainWindow
            Regular latitude/longitude grid plus MOLA elevations.
        """

        if radius < 0:
            raise ValueError("radius must be >= 0")

        if spacing_deg <= 0:
            raise ValueError("spacing_deg must be > 0")

        if not -90.0 <= latitude <= 90.0:
            raise ValueError("latitude must be between -90 and 90 degrees")

        offsets = np.arange(
            -radius,
            radius + 1,
            dtype=np.float64,
        )

        latitudes = latitude + offsets * spacing_deg
        longitudes = longitude + offsets * spacing_deg

        if np.any(latitudes < -90.0) or np.any(latitudes > 90.0):
            raise ValueError(
                "requested terrain window extends beyond Mars latitude bounds"
            )

        elevations = np.empty(
            (len(latitudes), len(longitudes)),
            dtype=np.float64,
        )

        for row, lat in enumerate(latitudes):
            for column, lon in enumerate(longitudes):
                elevations[row, column] = self.mola.elevation_at(
                    float(lat),
                    float(lon),
                )

        return TerrainWindow(
            center_latitude=float(latitude),
            center_longitude=float(longitude % 360.0),
            latitudes=latitudes,
            longitudes=longitudes % 360.0,
            elevations_m=elevations,
            spacing_deg=float(spacing_deg),
        )
