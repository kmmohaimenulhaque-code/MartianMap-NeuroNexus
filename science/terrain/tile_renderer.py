from __future__ import annotations

import math
from functools import lru_cache
from io import BytesIO
from xml.sax.saxutils import escape

import numpy as np
from PIL import Image

from science.terrain.mola128_resolver import MOLA128Resolver


MOLA_PPD = 128
MOLA_TILE_SIZE = 180
MARS_RADIUS_M = 3_396_000.0

MIN_ELEVATION_M = -8208.0
MAX_ELEVATION_M = 21249.0

LAT_LIMIT = 88.0


# Multiscale cartographic contour intervals.
#
# Zoom 0-1  : 2 km
# Zoom 2    : 1 km
# Zoom 3    : 500 m
# Zoom 4    : 250 m
# Zoom 5    : 200 m
# Zoom 6-7  : 125 m
#
CONTOUR_INTERVALS_M = {
    0: 2000,
    1: 2000,
    2: 1000,
    3: 500,
    4: 250,
    5: 200,
    6: 125,
    7: 125,
}

INDEX_EVERY = 5


# Marching Squares edge definitions.
#
# Corner ordering:
#
#   0 -------- 1
#   |          |
#   |          |
#   3 -------- 2
#
EDGE_CORNERS = (
    (0, 1),  # top
    (1, 2),  # right
    (2, 3),  # bottom
    (3, 0),  # left
)


CORNER_XY = (
    (0.0, 0.0),
    (1.0, 0.0),
    (1.0, 1.0),
    (0.0, 1.0),
)


CASE_SEGMENTS = {
    0: (),
    1: ((3, 0),),
    2: ((0, 1),),
    3: ((3, 1),),
    4: ((1, 2),),
    5: ((3, 0), (1, 2)),
    6: ((0, 2),),
    7: ((3, 2),),
    8: ((2, 3),),
    9: ((0, 2),),
    10: ((0, 1), (2, 3)),
    11: ((1, 2),),
    12: ((1, 3),),
    13: ((0, 1),),
    14: ((0, 3),),
    15: (),
}


class MOLA128TileRenderer:
    """
    NASA MOLA 128 pixels/degree cartographic tile renderer.

    Outputs two independent visual products:

    1. PNG relief tiles
       - pale Mars elevation tint
       - subtle hillshade

    2. SVG contour tiles
       - real MOLA-derived isolines
       - minor contour lines
       - thicker index contours
       - labelled index contours

    No procedural terrain is generated.
    """

    def __init__(
        self,
        resolver: MOLA128Resolver | None = None,
        tile_size: int = MOLA_TILE_SIZE,
    ):
        self.resolver = (
            resolver
            or MOLA128Resolver()
        )

        self.tile_size = int(
            tile_size
        )

    @property
    def max_zoom(self) -> int:
        return 7

    @property
    def min_zoom(self) -> int:
        return 0

    def metadata(self) -> dict:
        return {
            "source": (
                "NASA MOLA MEGDR "
                "128 pixels/degree"
            ),
            "dataset": (
                "MGS-M-MOLA-5-MEGDR-L3-V1.0"
            ),
            "pixels_per_degree": MOLA_PPD,
            "native_zoom": self.max_zoom,
            "tile_size": self.tile_size,
            "latitude_range_deg": [
                -88.0,
                88.0,
            ],
            "longitude_range_deg": [
                0.0,
                360.0,
            ],
            "elevation_min_m": int(
                MIN_ELEVATION_M
            ),
            "elevation_max_m": int(
                MAX_ELEVATION_M
            ),
            "rendering": (
                "pale cartographic relief + "
                "hillshade + "
                "MOLA-derived SVG contours"
            ),
            "contours": {
                "intervals_m": {
                    str(z): int(
                        interval
                    )
                    for z, interval in (
                        CONTOUR_INTERVALS_M.items()
                    )
                },
                "index_every": INDEX_EVERY,
                "labels": True,
                "format": "SVG",
            },
        }

    def _validate_tile(
        self,
        z: int,
        x: int,
        y: int,
    ) -> None:
        if not (
            self.min_zoom
            <= z
            <= self.max_zoom
        ):
            raise ValueError(
                f"Unsupported terrain zoom "
                f"{z}; expected "
                f"{self.min_zoom}.."
                f"{self.max_zoom}"
            )

        x_count = 2 ** (z + 1)
        y_count = 2 ** z

        if not (
            0
            <= x
            < x_count
        ):
            raise ValueError(
                f"Tile x={x} outside "
                f"range 0.."
                f"{x_count - 1}"
            )

        if not (
            0
            <= y
            < y_count
        ):
            raise ValueError(
                f"Tile y={y} outside "
                f"range 0.."
                f"{y_count - 1}"
            )

    def _tile_coordinates(
        self,
        z: int,
        x: int,
        y: int,
        *,
        halo: int = 0,
    ) -> tuple[
        np.ndarray,
        np.ndarray,
    ]:
        degrees_per_pixel = (
            1.0
            /
            (2 ** z)
        )

        row_indices = (
            np.arange(
                -halo,
                self.tile_size + halo,
                dtype=np.float64,
            )
            + 0.5
            + y
            * self.tile_size
        )

        col_indices = (
            np.arange(
                -halo,
                self.tile_size + halo,
                dtype=np.float64,
            )
            + 0.5
            + x
            * self.tile_size
        )

        latitudes = (
            90.0
            -
            row_indices
            * degrees_per_pixel
        )

        longitudes = (
            col_indices
            * degrees_per_pixel
        ) % 360.0

        return (
            latitudes,
            longitudes,
        )

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
            shape=(
                tile.rows,
                tile.cols,
            ),
        )

        rows = np.floor(
            (
                tile.lat_max
                -
                latitudes
            )
            *
            tile.pixels_per_degree
        ).astype(
            np.int64
        )

        cols = np.floor(
            (
                longitudes
                -
                tile.lon_min
            )
            *
            tile.pixels_per_degree
        ).astype(
            np.int64
        )

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
            data[
                np.ix_(
                    rows,
                    cols,
                )
            ],
            dtype=np.float32,
        )

    def _read_elevation(
        self,
        latitudes: np.ndarray,
        longitudes: np.ndarray,
    ) -> tuple[
        np.ndarray,
        np.ndarray,
    ]:
        elevation = np.full(
            (
                latitudes.size,
                longitudes.size,
            ),
            np.nan,
            dtype=np.float32,
        )

        valid_lat = (
            (latitudes >= -LAT_LIMIT)
            &
            (latitudes <= LAT_LIMIT)
        )

        normalized_longitudes = (
            np.mod(
                longitudes,
                360.0,
            )
        )

        for (
            lat_min,
            lat_max,
            _,
        ) in self._latitude_bands():

            lat_mask = (
                (latitudes >= lat_min)
                &
                (latitudes <= lat_max)
                &
                valid_lat
            )

            lat_indices = (
                np.flatnonzero(
                    lat_mask
                )
            )

            if (
                lat_indices.size
                == 0
            ):
                continue

            for (
                lon_min,
                lon_max,
                _,
            ) in self._longitude_bands():

                lon_mask = (
                    (
                        normalized_longitudes
                        >= lon_min
                    )
                    &
                    (
                        normalized_longitudes
                        < lon_max
                    )
                )

                lon_indices = (
                    np.flatnonzero(
                        lon_mask
                    )
                )

                if (
                    lon_indices.size
                    == 0
                ):
                    continue

                representative_lat = (
                    float(
                        latitudes[
                            lat_indices[0]
                        ]
                    )
                )

                representative_lon = (
                    float(
                        normalized_longitudes[
                            lon_indices[0]
                        ]
                    )
                )

                tile = (
                    self.resolver.tile_for(
                        representative_lat,
                        representative_lon,
                    )
                )

                block = (
                    self._tile_read(
                        tile,
                        latitudes[
                            lat_indices
                        ],
                        normalized_longitudes[
                            lon_indices
                        ],
                    )
                )

                elevation[
                    np.ix_(
                        lat_indices,
                        lon_indices,
                    )
                ] = block

        return (
            elevation,
            np.isfinite(
                elevation
            ),
        )

    @staticmethod
    def _latitude_bands():
        return (
            (
                44.0,
                88.0,
                "88n",
            ),
            (
                0.0,
                44.0,
                "44n",
            ),
            (
                -44.0,
                0.0,
                "00n",
            ),
            (
                -88.0,
                -44.0,
                "44s",
            ),
        )

    @staticmethod
    def _longitude_bands():
        return (
            (
                0.0,
                90.0,
                "000",
            ),
            (
                90.0,
                180.0,
                "090",
            ),
            (
                180.0,
                270.0,
                "180",
            ),
            (
                270.0,
                360.0,
                "270",
            ),
        )

    def _hillshade(
        self,
        elevation: np.ndarray,
        latitudes: np.ndarray,
        z: int,
    ) -> np.ndarray:
        degrees_per_pixel = (
            1.0
            /
            (2 ** z)
        )

        lat_rad = np.radians(
            latitudes
        )

        north_m = (
            MARS_RADIUS_M
            *
            lat_rad
        )

        east_spacing_m = (
            MARS_RADIUS_M
            *
            np.cos(
                lat_rad
            )
            *
            np.radians(
                degrees_per_pixel
            )
        )

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
            /
            east_spacing_m[
                :, None
            ]
        )

        # Stable fixed illumination direction
        # for the cartographic relief layer.
        altitude = np.radians(
            45.0
        )

        azimuth = np.radians(
            315.0
        )

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
            np.sin(altitude)
            *
            np.cos(slope)
            +
            np.cos(altitude)
            *
            np.sin(slope)
            *
            np.cos(
                azimuth
                -
                aspect
            )
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
        # Pale scientific/cartographic
        # Mars hypsometric ramp.
        stops = np.array(
            [
                [
                    230,
                    236,
                    234,
                ],
                [
                    241,
                    239,
                    229,
                ],
                [
                    239,
                    228,
                    207,
                ],
                [
                    225,
                    205,
                    179,
                ],
                [
                    204,
                    175,
                    145,
                ],
            ],
            dtype=np.float32,
        )

        normalized = (
            elevation
            -
            MIN_ELEVATION_M
        ) / (
            MAX_ELEVATION_M
            -
            MIN_ELEVATION_M
        )

        normalized = np.clip(
            normalized,
            0.0,
            1.0,
        )

        scaled = (
            normalized
            *
            (
                len(stops)
                -
                1
            )
        )

        low = np.floor(
            scaled
        ).astype(
            np.int64
        )

        high = np.clip(
            low + 1,
            0,
            len(stops) - 1,
        )

        fraction = (
            scaled
            -
            low
        )[..., None]

        base = (
            stops[low]
            *
            (
                1.0
                -
                fraction
            )
            +
            stops[high]
            *
            fraction
        )

        # Keep relief subtle so contour lines
        # remain the primary topographic signal.
        light = (
            0.82
            +
            0.18
            *
            hillshade
        )[..., None]

        rgb = np.clip(
            base
            *
            light,
            0.0,
            255.0,
        )

        rgba = np.empty(
            (
                *elevation.shape,
                4,
            ),
            dtype=np.uint8,
        )

        rgba[..., :3] = (
            rgb.astype(
                np.uint8
            )
        )

        rgba[..., 3] = (
            np.where(
                valid,
                255,
                0,
            ).astype(
                np.uint8
            )
        )

        return rgba

    @staticmethod
    def _edge_intersection(
        corners: tuple[
            float,
            ...,
        ],
        edge: int,
        level: float,
    ) -> tuple[
        float,
        float,
    ]:
        first, second = (
            EDGE_CORNERS[edge]
        )

        value_first = (
            corners[first]
        )

        value_second = (
            corners[second]
        )

        delta = (
            value_second
            -
            value_first
        )

        if abs(delta) < 1e-9:
            fraction = 0.5
        else:
            fraction = (
                level
                -
                value_first
            ) / delta

        fraction = float(
            np.clip(
                fraction,
                0.0,
                1.0,
            )
        )

        x1, y1 = (
            CORNER_XY[first]
        )

        x2, y2 = (
            CORNER_XY[second]
        )

        return (
            x1
            +
            fraction
            *
            (
                x2 - x1
            ),
            y1
            +
            fraction
            *
            (
                y2 - y1
            ),
        )

    def _contour_segments(
        self,
        elevation: np.ndarray,
        valid: np.ndarray,
        z: int,
    ) -> dict[
        int,
        list[
            tuple[
                float,
                float,
                float,
                float,
            ]
        ],
    ]:
        interval = float(
            CONTOUR_INTERVALS_M.get(
                z,
                CONTOUR_INTERVALS_M[
                    self.max_zoom
                ],
            )
        )

        rows, cols = (
            elevation.shape
        )

        segments: dict[
            int,
            list[
                tuple[
                    float,
                    float,
                    float,
                    float,
                ]
            ],
        ] = {}

        for row in range(
            rows - 1
        ):
            for col in range(
                cols - 1
            ):
                if not bool(
                    np.all(
                        valid[
                            row:row + 2,
                            col:col + 2,
                        ]
                    )
                ):
                    continue

                corners = (
                    float(
                        elevation[
                            row,
                            col,
                        ]
                    ),
                    float(
                        elevation[
                            row,
                            col + 1,
                        ]
                    ),
                    float(
                        elevation[
                            row + 1,
                            col + 1,
                        ]
                    ),
                    float(
                        elevation[
                            row + 1,
                            col,
                        ]
                    ),
                )

                local_min = min(
                    corners
                )

                local_max = max(
                    corners
                )

                if (
                    not math.isfinite(
                        local_min
                    )
                    or
                    not math.isfinite(
                        local_max
                    )
                    or
                    local_max <=
                        local_min
                ):
                    continue

                first_k = int(
                    math.ceil(
                        local_min
                        /
                        interval
                    )
                )

                last_k = int(
                    math.floor(
                        local_max
                        /
                        interval
                    )
                )

                if (
                    last_k <
                    first_k
                ):
                    continue

                for level_k in range(
                    first_k,
                    last_k + 1,
                ):
                    level = (
                        level_k
                        *
                        interval
                    )

                    square_index = (
                        (
                            1
                            if corners[0]
                            >= level
                            else 0
                        )
                        |
                        (
                            2
                            if corners[1]
                            >= level
                            else 0
                        )
                        |
                        (
                            4
                            if corners[2]
                            >= level
                            else 0
                        )
                        |
                        (
                            8
                            if corners[3]
                            >= level
                            else 0
                        )
                    )

                    if square_index in (
                        0,
                        15,
                    ):
                        continue

                    # Resolve the two classic ambiguous
                    # saddle cases using the cell centre.
                    case_segments = (
                        CASE_SEGMENTS[
                            square_index
                        ]
                    )

                    if square_index in (
                        5,
                        10,
                    ):
                        center_value = (
                            sum(
                                corners
                            )
                            /
                            4.0
                        )

                        if (
                            square_index
                            == 5
                        ):
                            if (
                                center_value
                                >= level
                            ):
                                case_segments = (
                                    (
                                        (0, 1),
                                        (2, 3),
                                    )
                                )
                            else:
                                case_segments = (
                                    (
                                        (3, 0),
                                        (1, 2),
                                    )
                                )

                        else:
                            if (
                                center_value
                                >= level
                            ):
                                case_segments = (
                                    (
                                        (3, 0),
                                        (1, 2),
                                    )
                                )
                            else:
                                case_segments = (
                                    (
                                        (0, 1),
                                        (2, 3),
                                    )
                                )

                    for (
                        first_edge,
                        second_edge,
                    ) in case_segments:
                        x1, y1 = (
                            self._edge_intersection(
                                corners,
                                first_edge,
                                level,
                            )
                        )

                        x2, y2 = (
                            self._edge_intersection(
                                corners,
                                second_edge,
                                level,
                            )
                        )

                        segments.setdefault(
                            level_k,
                            [],
                        ).append(
                            (
                                x1 + col,
                                y1 + row,
                                x2 + col,
                                y2 + row,
                            )
                        )

        return segments

    @staticmethod
    def _svg_path(
        segment: tuple[
            float,
            float,
            float,
            float,
        ],
    ) -> str:
        x1, y1, x2, y2 = (
            segment
        )

        return (
            f"M {x1:.2f} {y1:.2f} "
            f"L {x2:.2f} {y2:.2f}"
        )

    @staticmethod
    def _longest_segment(
        segments: list[
            tuple[
                float,
                float,
                float,
                float,
            ]
        ],
    ):
        best = None
        best_length = -1.0

        for segment in segments:
            x1, y1, x2, y2 = (
                segment
            )

            length = math.hypot(
                x2 - x1,
                y2 - y1,
            )

            if length > best_length:
                best_length = length
                best = segment

        return (
            best,
            best_length,
        )

    def _build_contour_svg(
        self,
        segments: dict[
            int,
            list[
                tuple[
                    float,
                    float,
                    float,
                    float,
                ]
            ],
        ],
        z: int,
    ) -> str:
        interval = int(
            CONTOUR_INTERVALS_M.get(
                z,
                CONTOUR_INTERVALS_M[
                    self.max_zoom
                ],
            )
        )

        svg = [
            (
                '<?xml version="1.0" '
                'encoding="UTF-8"?>'
            ),
            (
                '<svg '
                'xmlns="http://www.w3.org/2000/svg" '
                f'width="{self.tile_size}" '
                f'height="{self.tile_size}" '
                f'viewBox="0 0 '
                f'{self.tile_size} '
                f'{self.tile_size}" '
                'preserveAspectRatio="none">'
            ),
            (
                '<g fill="none" '
                'stroke-linecap="round" '
                'stroke-linejoin="round">'
            ),
        ]

        label_candidates = []

        for level_k in sorted(
            segments
        ):
            level_segments = (
                segments[level_k]
            )

            is_index = (
                level_k
                %
                INDEX_EVERY
                == 0
            )

            if is_index:
                stroke = (
                    "#76563c"
                )

                opacity = (
                    "0.94"
                )

                stroke_width = (
                    "1.55"
                )

            else:
                stroke = (
                    "#a88767"
                )

                opacity = (
                    "0.72"
                )

                stroke_width = (
                    "0.82"
                )

            for segment in (
                level_segments
            ):
                path = (
                    self._svg_path(
                        segment
                    )
                )

                svg.append(
                    f'<path '
                    f'd="{path}" '
                    f'stroke="{stroke}" '
                    f'stroke-width="'
                    f'{stroke_width}" '
                    f'opacity="{opacity}" '
                    f'vector-effect='
                    '"non-scaling-stroke"/>'
                )

            if is_index:
                (
                    longest,
                    length,
                ) = (
                    self._longest_segment(
                        level_segments
                    )
                )

                if (
                    longest is not None
                    and length >= 24
                ):
                    label_candidates.append(
                        (
                            level_k,
                            longest,
                        )
                    )

        svg.append(
            '</g>'
        )

        # Label major/index contours.
        svg.append(
            '<g '
            'font-family="Inter, Arial, sans-serif" '
            'font-size="7" '
            'font-weight="600" '
            'fill="#70523b" '
            'stroke="#f8f5ec" '
            'stroke-width="2.6" '
            'paint-order="stroke" '
            'stroke-linejoin="round">'
        )

        for (
            level_k,
            segment,
        ) in label_candidates:
            x1, y1, x2, y2 = (
                segment
            )

            label = (
                f"{int(level_k * interval):,} m"
            )

            x = (
                x1 + x2
            ) / 2.0

            y = (
                y1 + y2
            ) / 2.0

            x = min(
                max(
                    11.0,
                    x,
                ),
                self.tile_size
                - 11.0,
            )

            y = min(
                max(
                    9.0,
                    y,
                ),
                self.tile_size
                - 7.0,
            )

            svg.append(
                f'<text '
                f'x="{x:.2f}" '
                f'y="{y:.2f}" '
                f'text-anchor="middle">'
                f'{escape(label)}'
                f'</text>'
            )

        svg.append(
            '</g>'
        )

        svg.append(
            '</svg>'
        )

        return ''.join(
            svg
        )

    @lru_cache(
        maxsize=256
    )
    def render_png(
        self,
        z: int,
        x: int,
        y: int,
    ) -> bytes:
        self._validate_tile(
            z,
            x,
            y,
        )

        halo = 1

        latitudes, longitudes = (
            self._tile_coordinates(
                z,
                x,
                y,
                halo=halo,
            )
        )

        elevation, valid = (
            self._read_elevation(
                latitudes,
                longitudes,
            )
        )

        finite_values = (
            elevation[
                valid
            ]
        )

        if finite_values.size:
            fill_value = float(
                np.median(
                    finite_values
                )
            )
        else:
            fill_value = 0.0

        gradient_elevation = (
            np.where(
                valid,
                elevation,
                fill_value,
            )
        )

        hillshade = (
            self._hillshade(
                gradient_elevation,
                latitudes,
                z,
            )
        )

        rgba = (
            self._colorize(
                elevation,
                valid,
                hillshade,
            )
        )

        image = Image.fromarray(
            rgba,
            mode="RGBA",
        )

        image = image.crop(
            (
                halo,
                halo,
                self.tile_size
                + halo,
                self.tile_size
                + halo,
            )
        )

        output = BytesIO()

        image.save(
            output,
            format="PNG",
            optimize=True,
        )

        return output.getvalue()

    @lru_cache(
        maxsize=256
    )
    def render_svg(
        self,
        z: int,
        x: int,
        y: int,
    ) -> str:
        self._validate_tile(
            z,
            x,
            y,
        )

        # One-cell halo gives the contour calculation
        # enough neighbouring elevation data at tile edges.
        halo = 1

        latitudes, longitudes = (
            self._tile_coordinates(
                z,
                x,
                y,
                halo=halo,
            )
        )

        elevation, valid = (
            self._read_elevation(
                latitudes,
                longitudes,
            )
        )

        contours = (
            self._contour_segments(
                elevation,
                valid,
                z,
            )
        )

        svg = (
            self._build_contour_svg(
                contours,
                z,
            )
        )

        return svg
