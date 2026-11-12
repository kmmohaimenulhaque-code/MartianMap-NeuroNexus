from __future__ import annotations

import struct
from pathlib import Path

from science.spatial.mola_polar import MolaPolar


SIZE = 12288
BYTES_PER_SAMPLE = 2
EXPECTED_BYTES = SIZE * SIZE * BYTES_PER_SAMPLE

ROOT = Path("data/raw/mola/polar512")


def raw_uint16(path: Path, row: int, column: int) -> int:
    """
    Independently read one big-endian uint16 directly from the
    NASA binary file.

    This intentionally does NOT use NumPy or MolaPolar so that
    the validation path is independent from the production reader.
    """
    offset = (row * SIZE + column) * BYTES_PER_SAMPLE

    with path.open("rb") as f:
        f.seek(offset)
        data = f.read(BYTES_PER_SAMPLE)

    if len(data) != BYTES_PER_SAMPLE:
        raise ValueError(
            f"Could not read 2 bytes at row={row}, column={column}"
        )

    return struct.unpack(">H", data)[0]


def validate_point(
    engine: MolaPolar,
    latitude: float,
    longitude: float,
) -> None:
    hemisphere = "north" if latitude > 0 else "south"

    path = (
        ROOT / hemisphere / f"megt_{'n' if hemisphere == 'north' else 's'}_512_1.img"
    )

    row, column = engine.pixel_from_latlon(
        latitude,
        longitude,
        hemisphere,
    )

    stored_raw = raw_uint16(path, row, column)

    expected_elevation = stored_raw * 0.25 - 8000.0
    engine_elevation = engine.elevation_at(
        latitude,
        longitude,
    )

    difference = abs(engine_elevation - expected_elevation)

    print(
        f"{hemisphere.upper():5s} "
        f"lat={latitude:8.3f} "
        f"lon={longitude:8.3f} "
        f"pixel=({row:5d},{column:5d}) "
        f"stored={stored_raw:5d} "
        f"raw_elev={expected_elevation:9.2f} m "
        f"engine_elev={engine_elevation:9.2f} m "
        f"diff={difference:.6f} m"
    )

    assert difference == 0.0


def main() -> None:
    engine = MolaPolar()

    print("MOLA POLAR RAW-BYTE VALIDATION")
    print("=" * 110)

    # Include different orientations, latitudes and both hemispheres.
    points = [
        (89.9, 0.0),
        (89.9, 90.0),
        (89.9, 180.0),
        (89.9, 270.0),
        (85.0, 0.0),
        (80.0, 45.0),
        (75.0, 45.0),

        (-89.9, 0.0),
        (-89.9, 90.0),
        (-89.9, 180.0),
        (-89.9, 270.0),
        (-85.0, 0.0),
        (-80.0, 45.0),
        (-75.0, 45.0),
    ]

    for latitude, longitude in points:
        hemisphere = "north" if latitude > 0 else "south"

        path = (
            ROOT
            / hemisphere
            / f"megt_{'n' if hemisphere == 'north' else 's'}_512_1.img"
        )

        if path.stat().st_size != EXPECTED_BYTES:
            raise AssertionError(
                f"{path} has {path.stat().st_size} bytes; "
                f"expected {EXPECTED_BYTES}"
            )

        validate_point(engine, latitude, longitude)

    print("=" * 110)
    print("ALL MOLA POLAR RAW-BYTE VALIDATION TESTS PASSED")


if __name__ == "__main__":
    main()
