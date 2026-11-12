from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from science.terrain.mola128_window import TerrainWindow


MARS_RADIUS_M = 3_396_000.0


@dataclass(frozen=True)
class TerrainDerivatives:
    slope_deg: np.ndarray
    aspect_deg: np.ndarray
    roughness_m: np.ndarray

    @property
    def center_slope_deg(self) -> float:
        rows, cols = self.slope_deg.shape
        return float(self.slope_deg[rows // 2, cols // 2])

    @property
    def center_aspect_deg(self) -> float:
        rows, cols = self.aspect_deg.shape
        return float(self.aspect_deg[rows // 2, cols // 2])

    @property
    def center_roughness_m(self) -> float:
        rows, cols = self.roughness_m.shape
        return float(self.roughness_m[rows // 2, cols // 2])


class MOLA128Derivatives:
    def __init__(self, mars_radius_m: float = MARS_RADIUS_M):
        self.mars_radius_m = float(mars_radius_m)

    def compute(
        self,
        window: TerrainWindow,
    ) -> TerrainDerivatives:
        elevation = window.elevations_m.astype(np.float64)

        if elevation.shape[0] < 3 or elevation.shape[1] < 3:
            raise ValueError(
                "Terrain window must be at least 3x3 "
                "for derivative calculation."
            )

        lat_rad = np.radians(window.latitudes_deg)
        lon_rad = np.radians(window.longitudes_deg)

        # Northing coordinate in meters.
        north_m = self.mars_radius_m * lat_rad

        # Easting coordinate using the window-center latitude.
        center_lat_rad = np.radians(
            window.center_latitude_deg
        )

        east_m = (
            self.mars_radius_m
            * np.cos(center_lat_rad)
            * lon_rad
        )

        dz_d_north, dz_d_east = np.gradient(
            elevation,
            north_m,
            east_m,
            axis=(0, 1),
        )

        # Gradient magnitude gives rise/run.
        gradient_magnitude = np.hypot(
            dz_d_north,
            dz_d_east,
        )

        slope_deg = np.degrees(
            np.arctan(gradient_magnitude)
        )

        # Downhill direction.
        downhill_north = -dz_d_north
        downhill_east = -dz_d_east

        # Compass bearing:
        # 0° = north, 90° = east, 180° = south, 270° = west.
        aspect_deg = (
            np.degrees(
                np.arctan2(
                    downhill_east,
                    downhill_north,
                )
            )
            + 360.0
        ) % 360.0

        # Local 3x3 terrain roughness = standard deviation.
        padded = np.pad(
            elevation,
            1,
            mode="edge",
        )

        neighborhoods = np.lib.stride_tricks.sliding_window_view(
            padded,
            (3, 3),
        )

        roughness_m = neighborhoods.std(
            axis=(-2, -1)
        )

        return TerrainDerivatives(
            slope_deg=slope_deg,
            aspect_deg=aspect_deg,
            roughness_m=roughness_m,
        )
