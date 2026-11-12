#!/usr/bin/env python3

from __future__ import annotations

import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]

INPUT = ROOT / "data/indexes/themis/metadata/themis_metadata.jsonl"
OUTPUT = ROOT / "data/indexes/themis/metadata/themis_footprints.jsonl"

# Mars geographic grid.
# 2° cells give us a useful first-pass spatial index without exploding
# the number of records.
CELL_SIZE_DEG = 2.0


def normalize_lon(lon: float) -> float:
    """Normalize authoritative 0–360E longitude into 0–360."""
    return lon % 360.0


def cell_index(lat: float, lon: float) -> tuple[int, int]:
    lon = normalize_lon(lon)

    lat_cell = math.floor((lat + 90.0) / CELL_SIZE_DEG)
    lon_cell = math.floor(lon / CELL_SIZE_DEG)

    return lat_cell, lon_cell


def cells_for_footprint(
    min_lat: float,
    max_lat: float,
    min_lon: float,
    max_lon: float,
):
    """
    Return every 2° geographic cell touched by the footprint.

    THEMIS metadata uses east-positive 0–360 longitude.
    Handle ordinary non-wrapping footprints first.
    """

    min_lat = max(-90.0, min_lat)
    max_lat = min(90.0, max_lat)

    min_lon = normalize_lon(min_lon)
    max_lon = normalize_lon(max_lon)

    # Most THEMIS footprints do not cross 0/360.
    if min_lon <= max_lon:
        lon_ranges = [(min_lon, max_lon)]
    else:
        lon_ranges = [
            (min_lon, 360.0),
            (0.0, max_lon),
        ]

    lat_start = math.floor((min_lat + 90.0) / CELL_SIZE_DEG)
    lat_end = math.floor((max_lat + 90.0) / CELL_SIZE_DEG)

    result = set()

    for lon_a, lon_b in lon_ranges:

        lon_start = math.floor(lon_a / CELL_SIZE_DEG)
        lon_end = math.floor(
            max(lon_a, lon_b - 1e-9) / CELL_SIZE_DEG
        )

        for lat_cell in range(lat_start, lat_end + 1):
            for lon_cell in range(lon_start, lon_end + 1):

                result.add(
                    (
                        lat_cell,
                        lon_cell % int(360 / CELL_SIZE_DEG),
                    )
                )

    return result


def main():

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)

    total = 0
    valid = 0
    cells = 0

    with INPUT.open() as src, OUTPUT.open("w") as dst:

        for line in src:

            if not line.strip():
                continue

            row = json.loads(line)
            total += 1

            required = [
                row.get("minimum_latitude"),
                row.get("maximum_latitude"),
                row.get("westernmost_longitude"),
                row.get("easternmost_longitude"),
                row.get("solar_longitude"),
            ]

            if any(v is None for v in required):
                continue

            footprint_cells = cells_for_footprint(
                float(row["minimum_latitude"]),
                float(row["maximum_latitude"]),
                float(row["westernmost_longitude"]),
                float(row["easternmost_longitude"]),
            )

            output = {
                "product_id": row["product_id"],
                "archive_path": row["archive_path"],
                "source_url": row["source_url"],

                "start_time": row.get("start_time"),
                "stop_time": row.get("stop_time"),

                "solar_longitude": float(row["solar_longitude"]),
                "local_time": row.get("local_time"),

                "minimum_latitude": float(row["minimum_latitude"]),
                "maximum_latitude": float(row["maximum_latitude"]),
                "westernmost_longitude": float(
                    row["westernmost_longitude"]
                ),
                "easternmost_longitude": float(
                    row["easternmost_longitude"]
                ),

                "resolution_m": row.get("map_scale"),

                "cells": [
                    {
                        "lat": lat_cell,
                        "lon": lon_cell,
                    }
                    for lat_cell, lon_cell in sorted(footprint_cells)
                ],
            }

            dst.write(
                json.dumps(
                    output,
                    separators=(",", ":"),
                )
                + "\n"
            )

            valid += 1
            cells += len(footprint_cells)

    print("==========================================")
    print("THEMIS FOOTPRINT INDEX COMPLETE")
    print("==========================================")
    print(f"Metadata records: {total:,}")
    print(f"Valid footprints: {valid:,}")
    print(f"Indexed cells:    {cells:,}")
    print(f"Output:           {OUTPUT}")


if __name__ == "__main__":
    main()
