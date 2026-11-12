from __future__ import annotations

from html import escape
from math import ceil, floor
from functools import lru_cache

import numpy as np
from skimage.measure import find_contours

from science.terrain.tile_renderer import MOLA128TileRenderer


MOLA_TILE_SIZE = 180
HALO = 1

# Deliberately cartographic rather than a NASA standard. These are display
# intervals chosen to keep the map readable across the available zooms.
ZOOM_CONTOUR_INTERVAL_M = {
    0: 1000.0,
    1: 1000.0,
    2: 500.0,
    3: 250.0,
    4: 200.0,
    5: 100.0,
    6: 50.0,
    7: 25.0,
}

INDEX_MULTIPLIER = 4
MIN_CONTOUR_LENGTH_PX = 3.5
MAX_LABELS_PER_TILE = 8


class MOLA128ContourRenderer:
    """Render transparent, real-MOLA contour SVG tiles."""

    def __init__(
        self,
        renderer: MOLA128TileRenderer | None = None,
        tile_size: int = MOLA_TILE_SIZE,
    ):
        self.renderer = renderer or MOLA128TileRenderer()
        self.tile_size = int(tile_size)

    @staticmethod
    def _interval(z: int) -> float:
        if z not in ZOOM_CONTOUR_INTERVAL_M:
            raise ValueError(f"Unsupported contour zoom {z}")
        return ZOOM_CONTOUR_INTERVAL_M[z]

    @staticmethod
    def _label(level_m: float) -> str:
        if abs(level_m) >= 1000.0 and abs(level_m % 1000.0) < 1e-6:
            return f"{int(level_m / 1000.0)} km"
        return f"{int(round(level_m))} m"

    @staticmethod
    def _longest_segment(contours: list[np.ndarray]) -> np.ndarray | None:
        best = None
        best_length = 0.0
        for points in contours:
            if len(points) < 2:
                continue
            diffs = np.diff(points, axis=0)
            length = float(np.sqrt((diffs * diffs).sum(axis=1)).sum())
            if length > best_length:
                best = points
                best_length = length
        if best is None or best_length < MIN_CONTOUR_LENGTH_PX:
            return None
        return best

    def _levels(self, values: np.ndarray, interval: float) -> np.ndarray:
        finite = values[np.isfinite(values)]
        if finite.size == 0:
            return np.empty(0, dtype=np.float64)
        low = floor(float(finite.min()) / interval) * interval
        high = ceil(float(finite.max()) / interval) * interval
        # Protect against pathological arrays producing enormous level counts.
        count = int(round((high - low) / interval)) + 1
        if count > 800:
            interval = max(interval, 100.0)
            low = floor(float(finite.min()) / interval) * interval
            high = ceil(float(finite.max()) / interval) * interval
        return np.arange(low, high + interval * 0.5, interval, dtype=np.float64)

    @lru_cache(maxsize=512)
    def render_svg(self, z: int, x: int, y: int) -> bytes:
        self.renderer._validate_tile(z, x, y)

        latitudes, longitudes = self.renderer._tile_coordinates(
            z,
            x,
            y,
            halo=HALO,
        )
        elevation, valid = self.renderer._read_elevation(
            latitudes,
            longitudes,
        )

        if not np.any(valid):
            return self._empty_svg().encode("utf-8")

        # find_contours works best with finite values and a mask. Keep invalid
        # MOLA/fill pixels outside the mask so no false isolines are created.
        safe = np.asarray(elevation, dtype=np.float64)
        finite = safe[valid]
        fill = float(np.median(finite))
        safe[~valid] = fill

        interval = self._interval(z)
        levels = self._levels(elevation, interval)
        index_interval = interval * INDEX_MULTIPLIER

        polylines: list[str] = []
        labels: list[str] = []
        label_count = 0

        for level in levels:
            contours = find_contours(
                safe,
                float(level),
                fully_connected="high",
                positive_orientation="low",
                mask=valid,
            )
            if not contours:
                continue

            is_index = abs((level / index_interval) - round(level / index_interval)) < 1e-6
            stroke_width = 1.65 if is_index else 0.72
            opacity = 0.82 if is_index else 0.62

            display_contours = []
            for contour in contours:
                # skimage -> (row, col); SVG -> (x, y). Remove halo offset.
                points = contour[:, [1, 0]].astype(np.float64)
                points[:, 0] -= HALO
                points[:, 1] -= HALO
                display_contours.append(points)

                if len(points) >= 2:
                    point_text = " ".join(
                        f"{float(px):.2f},{float(py):.2f}"
                        for px, py in points
                    )
                    polylines.append(
                        f'<polyline points="{point_text}" fill="none" '
                        f'stroke="#5d4029" stroke-width="{stroke_width:.2f}" '
                        f'stroke-linecap="round" stroke-linejoin="round" '
                        f'opacity="{opacity:.2f}"/>'
                    )

            if is_index and label_count < MAX_LABELS_PER_TILE:
                best = self._longest_segment(display_contours)
                if best is not None:
                    midpoint = best[len(best) // 2]
                    lx, ly = float(midpoint[0]), float(midpoint[1])
                    if -5.0 <= lx <= self.tile_size + 5.0 and -5.0 <= ly <= self.tile_size + 5.0:
                        text = escape(self._label(float(level)))
                        labels.append(
                            f'<text x="{lx:.2f}" y="{ly:.2f}" '
                            f'font-family="ui-monospace, SFMono-Regular, Menlo, monospace" '
                            f'font-size="7" font-weight="700" text-anchor="middle" '
                            f'fill="#5d4029" stroke="#eadfce" stroke-width="2.6" '
                            f'paint-order="stroke" opacity="0.92">{text}</text>'
                        )
                        label_count += 1

        svg = (
            f'<svg xmlns="http://www.w3.org/2000/svg" width="{self.tile_size}" '
            f'height="{self.tile_size}" viewBox="0 0 {self.tile_size} {self.tile_size}" '
            f'preserveAspectRatio="none" overflow="hidden">'
            f'<g>{"".join(polylines)}</g>'
            f'<g>{"".join(labels)}</g>'
            f'</svg>'
        )
        return svg.encode("utf-8")

    def _empty_svg(self) -> str:
        return (
            f'<svg xmlns="http://www.w3.org/2000/svg" width="{self.tile_size}" '
            f'height="{self.tile_size}" viewBox="0 0 {self.tile_size} {self.tile_size}"/>'
        )


contour_renderer = MOLA128ContourRenderer()
