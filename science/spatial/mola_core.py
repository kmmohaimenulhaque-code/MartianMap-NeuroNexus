from __future__ import annotations

import json
from pathlib import Path

import numpy as np


PROJECT_ROOT = Path(__file__).resolve().parents[2]
CATALOG_PATH = PROJECT_ROOT / "data" / "manifests" / "mola_tiles.json"


class MolaSpatialCore:
    """
    NASA MOLA MEGDR spatial lookup engine.

    Current implementation:
        Global MEG128 topography

    Coordinates:
        latitude  = planetocentric degrees
        longitude = east longitude, normalized to [0, 360)

    Elevation:
        metres
    """

    def __init__(self, catalog_path: Path = CATALOG_PATH):

        self.catalog_path = catalog_path

        with catalog_path.open("r", encoding="utf-8") as f:
            self.catalog = json.load(f)

        self.tiles = self.catalog["tiles"]

        self.global_tiles = [
            tile
            for tile in self.tiles
            if tile.get("product") == "MOLA MEGDR 128 ppd"
            and tile.get("projection") == "SIMPLE CYLINDRICAL"
        ]

        if len(self.global_tiles) != 16:
            raise RuntimeError(
                "Expected 16 global MEG128 tiles, "
                f"found {len(self.global_tiles)}"
            )

        self._memmaps: dict[str, np.memmap] = {}

    # ------------------------------------------------------------------
    # Coordinate normalization
    # ------------------------------------------------------------------

    @staticmethod
    def normalize_longitude(longitude: float) -> float:
        """Normalize longitude to [0, 360)."""

        longitude = float(longitude) % 360.0

        if longitude >= 360.0:
            longitude = 0.0

        return longitude

    @staticmethod
    def validate_latitude(latitude: float) -> float:
        """Validate global MEG128 latitude coverage."""

        latitude = float(latitude)

        if not -88.0 <= latitude <= 88.0:
            raise ValueError(
                "Global MEG128 coverage is approximately "
                "-88° to +88°. Polar coordinates require "
                "the MEG512 polar products."
            )

        return latitude

    # ------------------------------------------------------------------
    # Tile selection
    # ------------------------------------------------------------------

    def tile_for(
        self,
        latitude: float,
        longitude: float,
    ) -> dict:
        """Return the unique NASA MOLA tile containing a coordinate."""

        latitude = self.validate_latitude(latitude)
        longitude = self.normalize_longitude(longitude)

        matches = []

        for tile in self.global_tiles:

            south = float(tile["south_latitude"])
            north = float(tile["north_latitude"])

            west = float(tile["west_longitude"])
            east = float(tile["east_longitude"])

            # Geographic bounds are treated as:
            #
            #   south <= latitude < north
            #   west  <= longitude < east
            #
            # This prevents neighbouring tiles from overlapping.
            lat_match = south <= latitude < north
            lon_match = west <= longitude < east

            # +88° is the upper edge of global coverage.
            if latitude == 88.0 and north == 88.0:
                lat_match = south <= latitude <= north

            if lat_match and lon_match:
                matches.append(tile)

        if len(matches) != 1:
            raise RuntimeError(
                f"Expected exactly one MOLA tile for "
                f"({latitude}, {longitude}), "
                f"found {len(matches)}"
            )

        return matches[0]

    # ------------------------------------------------------------------
    # Coordinate → pixel
    # ------------------------------------------------------------------

    def pixel_for(
        self,
        latitude: float,
        longitude: float,
    ) -> tuple[dict, int, int]:
        """
        Convert geographic coordinates to a zero-based
        MOLA raster row and column.
        """

        latitude = self.validate_latitude(latitude)
        longitude = self.normalize_longitude(longitude)

        tile = self.tile_for(latitude, longitude)

        south = float(tile["south_latitude"])
        north = float(tile["north_latitude"])
        west = float(tile["west_longitude"])

        rows = int(tile["rows"])
        columns = int(tile["columns"])

        resolution = float(
            tile["resolution_px_per_degree"]
        )

        # Longitude increases west → east.
        column = int(
            np.floor(
                (longitude - west) * resolution
            )
        )

        # Raster rows run from the northern edge toward
        # the southern edge.
        row = int(
            np.floor(
                (north - latitude) * resolution
            )
        )

        # Numerical safety at boundaries.
        row = max(0, min(row, rows - 1))
        column = max(0, min(column, columns - 1))

        return tile, row, column

    # ------------------------------------------------------------------
    # Memory-mapped raster
    # ------------------------------------------------------------------

    def _open_tile(
        self,
        tile: dict,
    ) -> np.memmap:

        image_path = PROJECT_ROOT / tile["path"]

        key = str(image_path)

        if key not in self._memmaps:

            rows = int(tile["rows"])
            columns = int(tile["columns"])

            expected_bytes = rows * columns * 2
            actual_bytes = image_path.stat().st_size

            if actual_bytes != expected_bytes:
                raise ValueError(
                    f"Invalid MOLA tile size:\n"
                    f"  {image_path}\n"
                    f"  expected: {expected_bytes}\n"
                    f"  actual:   {actual_bytes}"
                )

            self._memmaps[key] = np.memmap(
                image_path,
                dtype=">i2",
                mode="r",
                shape=(rows, columns),
            )

        return self._memmaps[key]

    # ------------------------------------------------------------------
    # Elevation
    # ------------------------------------------------------------------

    def elevation_at(
        self,
        latitude: float,
        longitude: float,
    ) -> float:
        """Return MOLA elevation in metres."""

        tile, row, column = self.pixel_for(
            latitude,
            longitude,
        )

        image = self._open_tile(tile)

        return float(image[row, column])

    # ------------------------------------------------------------------
    # Full spatial query
    # ------------------------------------------------------------------

    def query(
        self,
        latitude: float,
        longitude: float,
    ) -> dict:

        tile, row, column = self.pixel_for(
            latitude,
            longitude,
        )

        elevation = self.elevation_at(
            latitude,
            longitude,
        )

        return {
            "latitude": float(latitude),
            "longitude": self.normalize_longitude(longitude),
            "tile": tile["id"],
            "row": row,
            "column": column,
            "elevation_m": elevation,
            "dataset": tile["product"],
            "projection": tile["projection"],
        }


# ======================================================================
# Validation / demonstration
# ======================================================================

if __name__ == "__main__":

    core = MolaSpatialCore()

    tests = [
        (0.0, 0.0),
        (24.3745, 88.6042),
        (-20.0, 45.0),
        (60.0, 180.0),
        (-70.0, 270.0),
    ]

    print()
    print("NEURONEXUS MOLA SPATIAL CORE")
    print("=" * 64)

    for latitude, longitude in tests:

        result = core.query(
            latitude,
            longitude,
        )

        print(
            f"Coordinate : "
            f"{latitude:9.4f}, {longitude:9.4f}"
        )

        print(
            f"Tile       : {result['tile']}"
        )

        print(
            f"Pixel      : "
            f"row={result['row']}, "
            f"column={result['column']}"
        )

        print(
            f"Elevation  : "
            f"{result['elevation_m']:.2f} m"
        )

        print()
