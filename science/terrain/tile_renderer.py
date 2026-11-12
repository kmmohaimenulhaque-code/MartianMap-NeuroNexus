from __future__ import annotations

from functools import lru_cache
from io import BytesIO

import numpy as np
from PIL import Image

from science.terrain.mola128_resolver import MOLA128Resolver


MOLA_PPD = 128
MOLA_TILE_SIZE = 180
MARS_RADIUS_M = 3_396_000.0

MIN_ELEVATION_M = -8208.0
MAX_ELEVATION_M = 21249.0

LAT_LIMIT = 88.0


class MOLA128TileRenderer:
    """
    Render map tiles directly from the NASA MOLA MEGDR 128 ppd dataset.

    z=7 is the native MOLA resolution:
        2^7 = 128 pixels/degree
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
            "rendering": "elevation tint + hillshade",
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
        *,
        halo: int = 0,
    ) -> tuple[np.ndarray, np.ndarray]:
        degrees_per_pixel = 1.0 / (2 ** z)

        row_indices = (
            np.arange(
                -halo,
                self.tile_size + halo,
                dtype=np.float64,
            )
            + 0.5
            + y * self.tile_size
        )

        col_indices = (
            np.arange(
                -halo,
                self.tile_size + halo,
                dtype=np.float64,
            )
            + 0.5
            + x * self.tile_size
        )

        latitudes = (
            90.0
            - row_indices * degrees_per_pixel
        )

        longitudes = (
            col_indices * degrees_per_pixel
        ) % 360.0

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

        normalized_longitudes = np.mod(
            longitudes,
            360.0,
        )

        for lat_min, lat_max, _ in (
            self._latitude_bands()
        ):
            lat_mask = (
                (latitudes >= lat_min)
                & (latitudes <= lat_max)
                & valid_lat
            )

            lat_indices = np.flatnonzero(lat_mask)

            if lat_indices.size == 0:
                continue

            for lon_min, lon_max, _ in (
                self._longitude_bands()
            ):
                lon_mask = (
                    (normalized_longitudes >= lon_min)
                    & (normalized_longitudes < lon_max)
                )

                lon_indices = np.flatnonzero(
                    lon_mask
                )

                if lon_indices.size == 0:
                    continue

                representative_lat = float(
                    latitudes[lat_indices[0]]
                )

                representative_lon = float(
                    normalized_longitudes[lon_indices[0]]
                )

                tile = self.resolver.tile_for(
                    representative_lat,
                    representative_lon,
                )

                block = self._tile_read(
                    tile,
                    latitudes[lat_indices],
                    normalized_longitudes[lon_indices],
                )

                elevation[
                    np.ix_(
                        lat_indices,
                        lon_indices,
                    )
                ] = block

        return elevation, np.isfinite(elevation)

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

    def _hillshade(
        self,
        elevation: np.ndarray,
        latitudes: np.ndarray,
        z: int,
    ) -> np.ndarray:
        degrees_per_pixel = 1.0 / (2 ** z)

        lat_rad = np.radians(latitudes)

        north_m = (
            MARS_RADIUS_M * lat_rad
        )

        east_spacing_m = (
            MARS_RADIUS_M
            * np.cos(lat_rad)
            * np.radians(degrees_per_pixel)
        )

        north_spacing_m = (
            MARS_RADIUS_M
            * np.radians(degrees_per_pixel)
        )

        # Because image rows move southward, using the latitude
        # coordinate directly preserves the correct north/south sign.
        dz_d_north = np.gradient(
            elevation,
            north_m,
            axis=0,
        )

        dz_d_east = (
            np.gradient(
                elevation,
                axis=1,
            )
            / east_spacing_m[:, None]
        )

        # Sun from northwest at 315° azimuth and 45° altitude.
        altitude = np.radians(45.0)
        azimuth = np.radians(315.0)

        slope = np.arctan(
            np.hypot(
                dz_d_north,
                dz_d_east,
            )
        )

        aspect = np.arctan2(
            -dz_d_east,
            dz_d_north,
        )

        illumination = (
            np.sin(altitude) * np.cos(slope)
            + np.cos(altitude)
            * np.sin(slope)
            * np.cos(azimuth - aspect)
        )

        return np.clip(
            illumination,
            0.0,
            1.0,
        )

    def _colorize(
        self,
        elevation: np.ndarray,
        valid: np.ndarray,
        hillshade: np.ndarray,
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

        base = (
            35.0
            + normalized * 190.0
        ).astype(np.float32)

        # Keep the existing Mars color family, but modulate
        # brightness with terrain illumination.
        light = (
            0.52
            + 0.48 * hillshade
        )

        red = np.clip(
            base * light,
            0,
            255,
        )

        green = np.clip(
            base * 0.90 * light,
            0,
            255,
        )

        blue = np.clip(
            base * 0.78 * light,
            0,
            255,
        )

        rgba = np.empty(
            (*base.shape, 4),
            dtype=np.uint8,
        )

        rgba[..., 0] = red.astype(np.uint8)
        rgba[..., 1] = green.astype(np.uint8)
        rgba[..., 2] = blue.astype(np.uint8)
        rgba[..., 3] = np.where(
            valid,
            225,
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

        halo = 1

        latitudes, longitudes = (
            self._tile_coordinates(
                z,
                x,
                y,
                halo=halo,
            )
        )

        elevation, valid = self._read_elevation(
            latitudes,
            longitudes,
        )

        # Fill only invalid edge cells temporarily so numerical
        # gradients remain finite; they stay transparent in output.
        finite_values = elevation[valid]

        if finite_values.size:
            fill_value = float(
                np.median(finite_values)
            )
        else:
            fill_value = 0.0

        gradient_elevation = np.where(
            valid,
            elevation,
            fill_value,
        )

        hillshade = self._hillshade(
            gradient_elevation,
            latitudes,
            z,
        )

        crop = slice(
            halo,
            -halo,
        )

        rgba = self._colorize(
            elevation[crop, crop],
            valid[crop, crop],
            hillshade[crop, crop],
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
