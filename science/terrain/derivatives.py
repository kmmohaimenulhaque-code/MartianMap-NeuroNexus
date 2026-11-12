from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from science.terrain.mola128_window import TerrainWindow as MOLA128TerrainWindow


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


@dataclass(frozen=True)
class LegacyTerrainDerivatives:
    """
    Backward-compatible scalar derivatives for the existing
    MarsEnvironmentEngine terrain assessment.
    """

    slope_deg: float
    aspect_deg: float
    roughness_m: float


class MOLA128Derivatives:
    def __init__(
        self,
        mars_radius_m: float = MARS_RADIUS_M,
    ):
        self.mars_radius_m = float(mars_radius_m)

    def compute(
        self,
        window: MOLA128TerrainWindow,
    ) -> TerrainDerivatives:
        elevation = window.elevations_m.astype(np.float64)

        if elevation.shape[0] < 3 or elevation.shape[1] < 3:
            raise ValueError(
                "Terrain window must be at least 3x3 "
                "for derivative calculation."
            )

        latitudes_deg = np.asarray(
            window.latitudes_deg,
            dtype=np.float64,
        )

        longitudes_deg = np.asarray(
            window.longitudes_deg,
            dtype=np.float64,
        )

        center_latitude_deg = float(
            window.center_latitude_deg
        )

        return self._compute(
            elevation=elevation,
            latitudes_deg=latitudes_deg,
            longitudes_deg=longitudes_deg,
            center_latitude_deg=center_latitude_deg,
        )

    def _compute(
        self,
        *,
        elevation: np.ndarray,
        latitudes_deg: np.ndarray,
        longitudes_deg: np.ndarray,
        center_latitude_deg: float,
    ) -> TerrainDerivatives:
        lat_rad = np.radians(latitudes_deg)
        lon_rad = np.radians(longitudes_deg)

        north_m = (
            self.mars_radius_m * lat_rad
        )

        center_lat_rad = np.radians(
            center_latitude_deg
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

        gradient_magnitude = np.hypot(
            dz_d_north,
            dz_d_east,
        )

        slope_deg = np.degrees(
            np.arctan(gradient_magnitude)
        )

        downhill_north = -dz_d_north
        downhill_east = -dz_d_east

        aspect_deg = (
            np.degrees(
                np.arctan2(
                    downhill_east,
                    downhill_north,
                )
            )
            + 360.0
        ) % 360.0

        padded = np.pad(
            elevation,
            1,
            mode="edge",
        )

        neighborhoods = (
            np.lib.stride_tricks.sliding_window_view(
                padded,
                (3, 3),
            )
        )

        roughness_m = neighborhoods.std(
            axis=(-2, -1)
        )

        return TerrainDerivatives(
            slope_deg=slope_deg,
            aspect_deg=aspect_deg,
            roughness_m=roughness_m,
        )


def calculate_derivatives(
    window,
) -> LegacyTerrainDerivatives:
    """
    Backward-compatible derivative calculation for the
    existing MolaNetCDFSampler terrain assessment.

    The legacy sampler exposes:
        center_latitude
        latitudes
        longitudes
        elevations_m
        spacing_deg

    Returns scalar center-cell values because the existing
    environment API expects JSON-safe site morphology values.
    """

    elevation = np.asarray(
        window.elevations_m,
        dtype=np.float64,
    )

    if elevation.shape[0] < 3 or elevation.shape[1] < 3:
        raise ValueError(
            "Terrain window must be at least 3x3 "
            "for derivative calculation."
        )

    latitudes = np.asarray(
        window.latitudes,
        dtype=np.float64,
    )

    longitudes = np.asarray(
        window.longitudes,
        dtype=np.float64,
    )

    center_latitude = float(
        window.center_latitude
    )

    derivatives = MOLA128Derivatives()._compute(
        elevation=elevation,
        latitudes_deg=latitudes,
        longitudes_deg=longitudes,
        center_latitude_deg=center_latitude,
    )

    centre = elevation.shape[0] // 2

    return LegacyTerrainDerivatives(
        slope_deg=float(
            derivatives.slope_deg[centre, centre]
        ),
        aspect_deg=float(
            derivatives.aspect_deg[centre, centre]
        ),
        roughness_m=float(
            derivatives.roughness_m[centre, centre]
        ),
    )
