from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import numpy as np
import xarray as xr


DEFAULT_MOLA_PATH = (
    Path(__file__).resolve().parents[2]
    / "external"
    / "mars-gcm"
    / "data"
    / "mars_topo_mola16.nc"
)


@dataclass(frozen=True)
class TerrainWindow:
    """A local regularly sampled MOLA elevation window."""

    center_latitude: float
    center_longitude: float
    latitudes: np.ndarray
    longitudes: np.ndarray
    elevations_m: np.ndarray
    spacing_deg: float


class MolaNetCDFSampler:
    """Sample local terrain directly from the MOLA 16 px/degree NetCDF."""

    def __init__(self, path: str | Path = DEFAULT_MOLA_PATH) -> None:
        self.path = Path(path)
        self.ds = xr.open_dataset(self.path)

    def sample(
        self,
        latitude: float,
        longitude: float,
        *,
        radius: int = 2,
        spacing_deg: float = 1.0 / 128.0,
    ) -> TerrainWindow:

        if radius < 0:
            raise ValueError("radius must be >= 0")

        if spacing_deg <= 0:
            raise ValueError("spacing_deg must be > 0")

        if not -90.0 <= latitude <= 90.0:
            raise ValueError("latitude must be between -90 and 90 degrees")

        longitude = longitude % 360.0

        offsets = np.arange(
            -radius,
            radius + 1,
            dtype=np.float64,
        )

        latitudes = latitude + offsets * spacing_deg
        longitudes = (longitude + offsets * spacing_deg) % 360.0

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
                sample = self.ds.sel(
                    lat=float(lat),
                    lon=float(lon),
                    method="nearest",
                )

                elevations[row, column] = float(
                    sample["topo"].values
                )

        return TerrainWindow(
            center_latitude=float(latitude),
            center_longitude=float(longitude),
            latitudes=latitudes,
            longitudes=longitudes,
            elevations_m=elevations,
            spacing_deg=float(spacing_deg),
        )

    def close(self) -> None:
        self.ds.close()
