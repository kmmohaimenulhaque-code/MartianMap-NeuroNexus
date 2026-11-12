from __future__ import annotations

from dataclasses import dataclass

import xarray as xr


@dataclass(frozen=True)
class DustObservation:
    sol_index: int
    areocentric_longitude: float
    latitude: float
    longitude: float
    opacity: float
    height_km: float


class DustDataset:
    def __init__(self, path: str):
        self.path = path
        self.ds = xr.open_dataset(path)

    def observation(
        self,
        sol_index: int,
        latitude: float,
        longitude: float,
    ) -> DustObservation:
        if not 1 <= sol_index <= self.ds.sizes["time"]:
            raise ValueError(
                f"sol_index must be between 1 and {self.ds.sizes['time']}"
            )

        longitude = longitude % 360.0

        sample = self.ds.sel(
            time=float(sol_index),
            lat=latitude,
            lon=longitude,
            method="nearest",
        )

        return DustObservation(
            sol_index=sol_index,
            areocentric_longitude=float(sample["areo"].values),
            latitude=float(sample["lat"].values),
            longitude=float(sample["lon"].values),
            opacity=float(sample["tau"].values),
            height_km=float(sample["zmax"].values),
        )

    def close(self) -> None:
        self.ds.close()
