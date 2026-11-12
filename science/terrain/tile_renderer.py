from __future__ import annotations

from functools import lru_cache
from io import BytesIO
from pathlib import Path

import numpy as np
from PIL import Image

from science.terrain.mola128_resolver import MOLA128Resolver


MOLA_PPD = 128
MOLA_TILE_SIZE = 180

MIN_ELEVATION_M = -8208.0
MAX_ELEVATION_M = 21249.0

LAT_LIMIT = 88.0


class MOLA128TileRenderer:
    """
    Server-side renderer for the global 128 px/degree MOLA MEGDR dataset.

    The Leaflet map uses a custom 180 px tile size:

        zoom 0 = 1 px/degree
        zoom 1 = 2 px/degree
        ...
        zoom 7 = 128 px/degree

    Therefore zoom 7 corresponds directly to the native MOLA grid.
    """

    def __init__(
        self,
        resolver: MOLA128Resolver | None = None,
        tile_size: int = MOLA_TILE_SIZE,
    ):
        self.resolver = resolver or MOLA128Resolver()
        self.tile_size = int(tile_size)

    @property
    def max_zoom(self) -> int:
        return 7

    @property
    def min_zoom(self) -> int:
        return 0

    def metadata(self) -> dict:
        return {
            "source": "NASA MOLA MEGDR 128 pixels/degree",
            "pixels_per_degree": MOLA_PPD,
            "native_zoom": self.max_zoom,
            "tile_size": self.tile_size,
            "latitude_range_deg": [-88.0, 88.0],
            "longitude_range_deg": [0.0, 360.0],
            "elevation_min_m": int(MIN_ELEVATION_M),
            "elevation_max_m": int(MAX_ELEVATION_M),
        }

    def _validate_tile(
        self,
        z: int,
        x: int,
        y: int,
    ) -> None:
        if not self.min_zoom <= z <= self.max_zoom:
            raise ValueError(
                f"Unsupported terrain zoom {z}; "
                f"expected {self.min_zoom}..{self.max_zoom}"
            )

        x_count = 2 ** (z + 1)
        y_count = 2 ** z

        if not 0 <= x < x_count:
            raise ValueError(
                f"Tile x={x} outside range 0..{x_count - 1}"
            )

        if not 0 <= y < y_count:
            raise ValueError(
                f"Tile y={y} outside range 0..{y_count - 1}"
            )

    def _tile_coordinates(
        self,
        z: int,
        x: int,
        y: int,
    ) -> tuple[np.ndarray, np.ndarray]:
        """
        Return pixel-center latitude/longitude arrays.

        Leaflet rows increase southward, so latitude decreases
        as image row increases.
        """

        degrees_per_pixel = 1.0 / (2 ** z)

        tile_lat_span = self.tile_size * degrees_per_pixel
        tile_lon_span = self.tile_size * degrees_per_pixel

        north_map_y = y * tile_lat_span
        west_lon = x * tile_lon_span

        latitudes = (
            90.0
            - (
                north_map_y
                + (
                    np.arange(
                        self.tile_size,
                        dtype=np.float64,
                    )
                    + 0.5
                )
                * degrees_per_pixel
            )
        )

        longitudes = (
            west_lon
            + (
                np.arange(
                    self.tile_size,
                    dtype=np.float64,
                )
                + 0.5
            )
            * degrees_per_pixel
        )

        longitudes %= 360.0

        return latitudes, longitudes

    @staticmethod
    def _tile_read(
        tile,
        latitudes: np.ndarray,
        longitudes: np.ndarray,
    ) -> np.ndarray:
        data = np.memmap(
            tile.path,
            dtype=">i2",
            mode="r",
            shape=(tile.rows, tile.cols),
        )

        rows = np.floor(
            (tile.lat_max - latitudes)
            * tile.pixels_per_degree
        ).astype(np.int64)

        cols = np.floor(
            (longitudes - tile.lon_min)
            * tile.pixels_per_degree
        ).astype(np.int64)

        rows = np.clip(
            rows,
            0,
            tile.rows - 1,
        )

        cols = np.clip(
            cols,
            0,
            tile.cols - 1,
        )

        return np.asarray(
            data[np.ix_(rows, cols)],
            dtype=np.float32,
        )

    def _read_elevation(
        self,
        latitudes: np.ndarray,
        longitudes: np.ndarray,
    ) -> tuple[np.ndarray, np.ndarray]:
        elevation = np.full(
            (latitudes.size, longitudes.size),
            np.nan,
            dtype=np.float32,
        )

        valid_lat = (
            (latitudes >= -LAT_LIMIT)
            & (latitudes <= LAT_LIMIT)
        )

        lat_indices = np.flatnonzero(valid_lat)

        if lat_indices.size == 0:
            return elevation, np.zeros_like(
                elevation,
                dtype=bool,
            )

        valid_longitudes = np.mod(
            longitudes,
            360.0,
        )

        for lat_min, lat_max, _ in (
            self._latitude_bands()
        ):
            band_mask = (
                (latitudes >= lat_min)
                & (latitudes <= lat_max)
                & valid_lat
            )

            selected_lat_indices = np.flatnonzero(
                band_mask
            )

            if selected_lat_indices.size == 0:
                continue

            for lon_min, lon_max, _ in (
                self._longitude_bands()
            ):
                lon_mask = (
                    (valid_longitudes >= lon_min)
                    & (valid_longitudes < lon_max)
                )

                selected_lon_indices = np.flatnonzero(
                    lon_mask
                )

                if selected_lon_indices.size == 0:
                    continue

                representative_lat = float(
                    latitudes[selected_lat_indices[0]]
                )

                representative_lon = float(
                    valid_longitudes[selected_lon_indices[0]]
                )

                tile = self.resolver.tile_for(
                    representative_lat,
                    representative_lon,
                )

                selected_latitudes = latitudes[
                    selected_lat_indices
                ]

                selected_longitudes = valid_longitudes[
                    selected_lon_indices
                ]

                block = self._tile_read(
                    tile,
                    selected_latitudes,
                    selected_longitudes,
                )

                elevation[
                    np.ix_(
                        selected_lat_indices,
                        selected_lon_indices,
                    )
                ] = block

        valid = np.isfinite(elevation)

        return elevation, valid

    @staticmethod
    def _latitude_bands():
        return (
            (44.0, 88.0, "88n"),
            (0.0, 44.0, "44n"),
            (-44.0, 0.0, "00n"),
            (-88.0, -44.0, "44s"),
        )

    @staticmethod
    def _longitude_bands():
        return (
            (0.0, 90.0, "000"),
            (90.0, 180.0, "090"),
            (180.0, 270.0, "180"),
            (270.0, 360.0, "270"),
        )

    def _colorize(
        self,
        elevation: np.ndarray,
        valid: np.ndarray,
    ) -> np.ndarray:
        normalized = (
            elevation - MIN_ELEVATION_M
        ) / (
            MAX_ELEVATION_M - MIN_ELEVATION_M
        )

        normalized = np.clip(
            normalized,
            0.0,
            1.0,
        )

        # Mars-toned grayscale/elevation rendering.
        # The existing global map remains underneath this layer.
        value = (
            35.0
            + normalized * 190.0
        ).astype(np.uint8)

        rgba = np.empty(
            (*value.shape, 4),
            dtype=np.uint8,
        )

        rgba[..., 0] = value
        rgba[..., 1] = (
            value.astype(np.float32) * 0.90
        ).clip(0, 255).astype(np.uint8)
        rgba[..., 2] = (
            value.astype(np.float32) * 0.78
        ).clip(0, 255).astype(np.uint8)

        rgba[..., 3] = np.where(
            valid,
            210,
            0,
        ).astype(np.uint8)

        return rgba

    @lru_cache(maxsize=256)
    def render_png(
        self,
        z: int,
        x: int,
        y: int,
    ) -> bytes:
        self._validate_tile(z, x, y)

        latitudes, longitudes = (
            self._tile_coordinates(
                z,
                x,
                y,
            )
        )

        elevation, valid = self._read_elevation(
            latitudes,
            longitudes,
        )

        rgba = self._colorize(
            elevation,
            valid,
        )

        image = Image.fromarray(
            rgba,
            mode="RGBA",
        )

        output = BytesIO()

        image.save(
            output,
            format="PNG",
            optimize=True,
        )

        return output.getvalue()
