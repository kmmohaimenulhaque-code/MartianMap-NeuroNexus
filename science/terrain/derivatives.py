from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from science.terrain.mola_terrain import TerrainWindow


MARS_RADIUS_M = 3_389_500.0


@dataclass(frozen=True)
class TerrainDerivatives:
    """Terrain quantities derived from a local MOLA elevation window."""

    slope_deg: float
    aspect_deg: float
    roughness_m: float


def _metres_per_degree(latitude_deg: float) -> tuple[float, float]:
    """
    Approximate Mars surface distance represented by one degree.

    Returns
    -------
    (dx, dy)
        East-west and north-south metres per degree.
    """
    latitude_rad = np.deg2rad(latitude_deg)

    metres_per_degree = (
        2.0 * np.pi * MARS_RADIUS_M / 360.0
    )

    dx = metres_per_degree * np.cos(latitude_rad)
    dy = metres_per_degree

    return dx, dy


def calculate_derivatives(
    window: TerrainWindow,
) -> TerrainDerivatives:
    """
    Calculate terrain derivatives at the centre of a MOLA window.

    The centre must have neighbours on all four sides.
    """

    elevation = window.elevations_m

    if elevation.ndim != 2:
        raise ValueError("elevation grid must be two-dimensional")

    rows, columns = elevation.shape

    if rows < 3 or columns < 3:
        raise ValueError(
            "terrain window must contain at least a 3x3 grid"
        )

    centre_row = rows // 2
    centre_column = columns // 2

    if (
        centre_row == 0
        or centre_row == rows - 1
        or centre_column == 0
        or centre_column == columns - 1
    ):
        raise ValueError(
            "terrain centre must have neighbours on all sides"
        )

    spacing_deg = window.spacing_deg

    dx_per_degree, dy_per_degree = _metres_per_degree(
        window.center_latitude
    )

    dx = dx_per_degree * spacing_deg
    dy = dy_per_degree * spacing_deg

    dz_dx = (
        elevation[centre_row, centre_column + 1]
        - elevation[centre_row, centre_column - 1]
    ) / (2.0 * dx)

    dz_dy = (
        elevation[centre_row - 1, centre_column]
        - elevation[centre_row + 1, centre_column]
    ) / (2.0 * dy)

    slope_rad = np.arctan(
        np.sqrt(dz_dx**2 + dz_dy**2)
    )

    slope_deg = float(np.rad2deg(slope_rad))

    # Aspect convention:
    #   0°   = north
    #   90°  = east
    #   180° = south
    #   270° = west
    #
    # atan2(eastward, northward) gives clockwise-from-north.
    aspect_deg = float(
        np.rad2deg(
            np.arctan2(dz_dx, dz_dy)
        ) % 360.0
    )

    local_patch = elevation[
        centre_row - 1 : centre_row + 2,
        centre_column - 1 : centre_column + 2,
    ]

    roughness_m = float(
        local_patch.max() - local_patch.min()
    )

    return TerrainDerivatives(
        slope_deg=slope_deg,
        aspect_deg=aspect_deg,
        roughness_m=roughness_m,
    )
