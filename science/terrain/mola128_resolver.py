from __future__ import annotations

from pathlib import Path

from science.terrain.mola128 import MOLA128Tile


class MOLA128Resolver:
    ROOT = Path("data/raw/mola/meg128/topography")

    LON_BANDS = {
        0: "000",
        90: "090",
        180: "180",
        270: "270",
    }

    def tile_for(
        self,
        latitude: float,
        longitude: float,
    ) -> MOLA128Tile:
        if not -88.0 <= latitude <= 88.0:
            raise ValueError(f"Latitude outside MOLA range: {latitude}")

        longitude = longitude % 360.0

        if latitude >= 44.0:
            lat_code = "88n"
            lat_min, lat_max = 44.0, 88.0
        elif latitude >= 0.0:
            lat_code = "44n"
            lat_min, lat_max = 0.0, 44.0
        elif latitude >= -44.0:
            lat_code = "00n"
            lat_min, lat_max = -44.0, 0.0
        else:
            lat_code = "44s"
            lat_min, lat_max = -88.0, -44.0

        lon_start = int(longitude // 90) * 90
        lon_code = self.LON_BANDS[lon_start]

        path = self.ROOT / f"megt{lat_code}{lon_code}hb.img"

        if not path.exists():
            raise FileNotFoundError(
                f"MOLA tile not found: {path}"
            )

        return MOLA128Tile(
            path=path,
            lat_min=lat_min,
            lat_max=lat_max,
            lon_min=float(lon_start),
            lon_max=float(lon_start + 90),
        )

    def elevation(
        self,
        latitude: float,
        longitude: float,
    ) -> int:
        tile = self.tile_for(latitude, longitude)
        return tile.elevation(latitude, longitude)
