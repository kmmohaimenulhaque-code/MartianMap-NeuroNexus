from __future__ import annotations

from science.terrain.local_waypoint_analysis import (
    sample_waypoint,
)
from science.spatial.mola_unified import (
    MolaUnified,
)


class MarsTerrainAssessment:
    """
    Coordinate-driven Mars terrain assessment.

    Uses the same unified MOLA engine as the route analyser,
    so site queries and route waypoint queries use the same
    scientific terrain source.
    """

    def __init__(self) -> None:
        self.mola = MolaUnified()

    def assess(
        self,
        latitude: float,
        longitude: float,
    ) -> dict:
        terrain = sample_waypoint(
            latitude_deg=latitude,
            longitude_deg=longitude,
            mola=self.mola,
        )

        return {
            "location": {
                "latitude_deg": float(
                    latitude,
                ),
                "longitude_deg": float(
                    longitude % 360.0,
                ),
            },

            "elevation_m": float(
                terrain.elevation_m,
            ),

            "slope_deg": float(
                terrain.slope_deg,
            ),

            "aspect_deg": float(
                terrain.aspect_deg,
            ),

            "roughness_m": float(
                terrain.roughness_m,
            ),

            "local_elevation_min_m": float(
                terrain.local_min_m,
            ),

            "local_elevation_max_m": float(
                terrain.local_max_m,
            ),

            "sample_grid": (
                f"{terrain.sample_grid_size}x"
                f"{terrain.sample_grid_size}"
            ),

            "pixels_per_degree": 128,

            "source": (
                "NASA MOLA MEGDR"
            ),

            "dataset": (
                "MGS-M-MOLA-5-MEGDR-L3-V1.0"
            ),

            "method": (
                "Unified MOLA global/polar "
                "3x3 local terrain sample"
            ),
        }
