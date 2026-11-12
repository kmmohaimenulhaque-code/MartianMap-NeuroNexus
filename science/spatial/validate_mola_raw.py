from __future__ import annotations

import json
from pathlib import Path

import numpy as np

from science.spatial.mola_core import MolaSpatialCore


ROOT = Path(__file__).resolve().parents[2]
CATALOG = ROOT / "data" / "manifests" / "mola_tiles.json"


def independent_read(tile: dict, row: int, column: int) -> int:
    """
    Independently decode one big-endian signed 16-bit
    MOLA sample directly from the raw .img file.
    """

    path = ROOT / tile["path"]
    columns = int(tile["columns"])

    # Each sample is exactly 2 bytes.
    sample_index = row * columns + column
    byte_offset = sample_index * 2

    with path.open("rb") as f:
        f.seek(byte_offset)
        raw = f.read(2)

    if len(raw) != 2:
        raise RuntimeError(
            f"Could not read 2 bytes at offset {byte_offset}"
        )

    # Explicit big-endian signed 16-bit decoding.
    return int.from_bytes(
        raw,
        byteorder="big",
        signed=True,
    )


def main():

    core = MolaSpatialCore()

    tests = [
        (0.0, 0.0),
        (24.3745, 88.6042),
        (-20.0, 45.0),
        (60.0, 180.0),
        (-70.0, 270.0),
        (43.999999, 359.999999),
        (-43.999999, 0.000001),
    ]

    print()
    print("MOLA RAW-BYTE VALIDATION")
    print("=" * 76)

    passed = 0
    failed = 0

    for latitude, longitude in tests:

        tile, row, column = core.pixel_for(
            latitude,
            longitude,
        )

        engine_value = core.elevation_at(
            latitude,
            longitude,
        )

        raw_value = independent_read(
            tile,
            row,
            column,
        )

        difference = engine_value - raw_value

        if difference != 0:
            failed += 1

            print(
                f"FAIL  "
                f"({latitude:10.6f}, {longitude:10.6f})"
            )
            print(f"      Tile      : {tile['id']}")
            print(f"      Pixel     : ({row}, {column})")
            print(f"      Engine    : {engine_value}")
            print(f"      Raw bytes : {raw_value}")
            print(f"      Difference: {difference}")
            print()

            continue

        passed += 1

        print(
            f"PASS  "
            f"({latitude:10.6f}, {longitude:10.6f})  "
            f"{tile['id']:15s}  "
            f"pixel=({row:4d},{column:5d})  "
            f"elevation={raw_value:7d} m"
        )

    print()
    print("=" * 76)
    print(f"Passed : {passed}")
    print(f"Failed : {failed}")

    if failed:
        raise SystemExit(1)

    print("✅ RAW MOLA BYTE DECODING VALIDATED")


if __name__ == "__main__":
    main()
