from __future__ import annotations

from dataclasses import dataclass
from math import atan, cos, degrees, radians, sqrt

import numpy as np

from science.terrain.mola128_resolver import (
    MOLA128Resolver,
)


MARS_RADIUS_M = 3_396_000.0
MOLA_PPD = 128
DEGREE_STEP = 1.0 / MOLA_PPD


@dataclass(frozen=True)
class WaypointTerrain:
    elevation_m: float
    slope_deg: float
    aspect_deg: float
    roughness_m: float
    local_min_m: float
    local_max_m: float
    sample_grid_size: int


def _read_elevation(
    resolver: MOLA128Resolver,
    latitude_deg: float,
    longitude_deg: float,
) -> float:
    return float(
        resolver.elevation(
            latitude=latitude_deg,
            longitude=longitude_deg % 360.0,
        )
    )


def sample_waypoint(
    latitude_deg: float,
    longitude_deg: float,
    *,
    resolver: MOLA128Resolver | None = None,
) -> WaypointTerrain:
    """
    Analyze only a 3x3 MOLA neighborhood around a single waypoint.

    This is intentionally local. It must never construct a route-sized
    raster or corridor.
    """

    if not (
        -88.0 <= latitude_deg <= 88.0
    ):
        raise ValueError(
            "Local MOLA waypoint analysis is limited "
            "to latitudes between -88 and 88 degrees."
        )

    resolver = (
        resolver
        or MOLA128Resolver()
    )

    longitude_deg = longitude_deg % 360.0

    latitudes = np.array(
        [
            latitude_deg + DEGREE_STEP,
            latitude_deg,
            latitude_deg - DEGREE_STEP,
        ],
        dtype=np.float64,
    )

    longitudes = np.array(
        [
            longitude_deg - DEGREE_STEP,
            longitude_deg,
            longitude_deg + DEGREE_STEP,
        ],
        dtype=np.float64,
    )

    values = np.empty(
        (3, 3),
        dtype=np.float64,
    )

    for row, latitude in enumerate(
        latitudes
    ):
        if not (
            -88.0 <= latitude <= 88.0
        ):
            raise ValueError(
                "Waypoint neighborhood crosses "
                "the supported MOLA latitude range."
            )

        for col, longitude in enumerate(
            longitudes
        ):
            values[row, col] = _read_elevation(
                resolver,
                float(latitude),
                float(longitude),
            )

    center_elevation = float(
        values[1, 1]
    )

    center_lat_rad = radians(
        latitude_deg
    )

    north_spacing_m = (
        MARS_RADIUS_M
        * radians(DEGREE_STEP)
    )

    east_spacing_m = (
        MARS_RADIUS_M
        * max(
            cos(center_lat_rad),
            1e-6,
        )
        * radians(DEGREE_STEP)
    )

    dz_d_north = (
        values[0, 1]
        - values[2, 1]
    ) / (
        2.0 * north_spacing_m
    )

    dz_d_east = (
        values[1, 2]
        - values[1, 0]
    ) / (
        2.0 * east_spacing_m
    )

    gradient_magnitude = sqrt(
        dz_d_north ** 2
        + dz_d_east ** 2
    )

    slope_deg = degrees(
        atan(gradient_magnitude)
    )

    downhill_north = -dz_d_north
    downhill_east = -dz_d_east

    aspect_deg = (
        degrees(
            np.arctan2(
                downhill_east,
                downhill_north,
            )
        )
        + 360.0
    ) % 360.0

    roughness_m = float(
        values.std()
    )

    return WaypointTerrain(
        elevation_m=center_elevation,
        slope_deg=float(slope_deg),
        aspect_deg=float(aspect_deg),
        roughness_m=roughness_m,
        local_min_m=float(values.min()),
        local_max_m=float(values.max()),
        sample_grid_size=3,
    )
