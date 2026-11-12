from __future__ import annotations

from science.terrain.derivatives import calculate_derivatives
from science.terrain.mola_netcdf import MolaNetCDFSampler


class MarsTerrainAssessment:
    def __init__(self) -> None:
        self.sampler = MolaNetCDFSampler()

    def assess(
        self,
        latitude: float,
        longitude: float,
    ) -> dict:
        window = self.sampler.sample(
            latitude=latitude,
            longitude=longitude,
        )

        derivatives = calculate_derivatives(window)

        centre = window.elevations_m.shape[0] // 2

        return {
            "location": {
                "latitude_deg": latitude,
                "longitude_deg": longitude % 360.0,
            },
            "elevation_m": float(
                window.elevations_m[centre, centre]
            ),
            "slope_deg": derivatives.slope_deg,
            "aspect_deg": derivatives.aspect_deg,
            "roughness_m": derivatives.roughness_m,
            "source": "NASA MOLA",
            "dataset": "mars_topo_mola16.nc",
        }
