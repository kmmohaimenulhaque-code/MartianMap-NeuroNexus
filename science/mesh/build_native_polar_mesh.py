from __future__ import annotations

import json
import math
from pathlib import Path

import numpy as np
import trimesh


ROOT = Path(".")
POLAR_ROOT = ROOT / "data/raw/mola/polar512"
OUTPUT_ROOT = ROOT / "data/processed/planet_mesh/polar"

RESOLUTION = 512.0
SIZE = 12288
MARS_RADIUS_M = 3_389_500.0

# Process the huge 12288×12288 raster in horizontal bands.
CHUNK_ROWS = 256


def decode_elevation(stored: np.ndarray) -> np.ndarray:
    """Decode MOLA polar unsigned-16-bit samples into metres."""
    return stored.astype(np.float64) * 0.25 - 8000.0


def latlon_from_pixels(
    rows: np.ndarray,
    columns: np.ndarray,
    hemisphere: str,
) -> tuple[np.ndarray, np.ndarray]:
    """
    Convert MOLA polar-stereographic raster coordinates to Mars lat/lon.

    Implements the validated MOLA DSMAP_POLAR geometry.
    """
    center = SIZE / 2.0

    i = columns.astype(np.float64) + 1.0
    j = rows.astype(np.float64) + 1.0

    x = (i - center - 0.5) / RESOLUTION
    y = (j - center - 0.5) / RESOLUTION

    r = np.sqrt(x * x + y * y)

    longitude = np.degrees(np.arctan2(x, y)) % 360.0
    angle = 2.0 * np.arctan(r * math.pi / 360.0)

    if hemisphere == "north":
        latitude = 90.0 - np.degrees(angle)
    elif hemisphere == "south":
        latitude = -90.0 + np.degrees(angle)
    else:
        raise ValueError(f"Unknown hemisphere: {hemisphere}")

    return latitude, longitude


def latlon_to_xyz(
    latitude_deg: np.ndarray,
    longitude_deg: np.ndarray,
    elevation_m: np.ndarray,
) -> np.ndarray:
    """Convert Mars latitude/longitude/elevation to planet-centred XYZ."""
    lat = np.radians(latitude_deg)
    lon = np.radians(longitude_deg)

    radius = MARS_RADIUS_M + elevation_m

    x = radius * np.cos(lat) * np.cos(lon)
    y = radius * np.cos(lat) * np.sin(lon)
    z = radius * np.sin(lat)

    return np.column_stack((x.ravel(), y.ravel(), z.ravel()))


def build_faces(rows: int, columns: int) -> np.ndarray:
    """Build outward-facing triangles for a regular raster band."""
    grid = np.arange(rows * columns, dtype=np.int64).reshape(rows, columns)

    tl = grid[:-1, :-1]
    tr = grid[:-1, 1:]
    bl = grid[1:, :-1]
    br = grid[1:, 1:]

    faces = np.empty(((rows - 1) * (columns - 1) * 2, 3), dtype=np.int64)

    faces[0::2] = np.column_stack(
        (tl.ravel(), tr.ravel(), bl.ravel())
    )

    faces[1::2] = np.column_stack(
        (tr.ravel(), br.ravel(), bl.ravel())
    )

    return faces


def build_hemisphere(hemisphere: str) -> None:
    input_path = (
        POLAR_ROOT / "north" / "megt_n_512_1.img"
        if hemisphere == "north"
        else POLAR_ROOT / "south" / "megt_s_512_1.img"
    )

    output_dir = OUTPUT_ROOT / hemisphere
    output_dir.mkdir(parents=True, exist_ok=True)

    expected_bytes = SIZE * SIZE * 2

    if input_path.stat().st_size != expected_bytes:
        raise RuntimeError(
            f"{input_path} has {input_path.stat().st_size} bytes; "
            f"expected {expected_bytes}"
        )

    raster = np.memmap(
        input_path,
        dtype=">u2",
        mode="r",
        shape=(SIZE, SIZE),
    )

    chunks = []

    print()
    print("=" * 72)
    print(f"NATIVE POLAR MESH — {hemisphere.upper()}")
    print("=" * 72)
    print(f"Input       : {input_path}")
    print(f"Raster      : {SIZE} × {SIZE}")
    print(f"Resolution  : {RESOLUTION} ppd")
    print(f"Chunk rows  : {CHUNK_ROWS}")
    print()

    chunk_index = 0

    for row_start in range(0, SIZE, CHUNK_ROWS):
        row_end = min(row_start + CHUNK_ROWS, SIZE)

        # Keep one overlapping raster row so adjacent chunks share
        # their boundary exactly.
        if row_end < SIZE:
            raster_end = row_end + 1
        else:
            raster_end = row_end

        stored = np.asarray(
            raster[row_start:raster_end, :],
            dtype=np.uint16,
        )

        elevation = decode_elevation(stored)

        rows = np.arange(
            row_start,
            raster_end,
            dtype=np.float64,
        )[:, None]

        columns = np.arange(
            0,
            SIZE,
            dtype=np.float64,
        )[None, :]

        row_grid = np.broadcast_to(rows, elevation.shape)
        column_grid = np.broadcast_to(columns, elevation.shape)

        latitude, longitude = latlon_from_pixels(
            row_grid,
            column_grid,
            hemisphere,
        )

        vertices = latlon_to_xyz(
            latitude,
            longitude,
            elevation,
        )

        faces = build_faces(
            elevation.shape[0],
            elevation.shape[1],
        )

        mesh = trimesh.Trimesh(
            vertices=vertices,
            faces=faces,
            process=False,
        )

        mesh.fix_normals()

        filename = f"chunk_{chunk_index:04d}.glb"
        output_path = output_dir / filename

        mesh.export(output_path)

        record = {
            "chunk": chunk_index,
            "file": filename,
            "row_start": row_start,
            "row_end_exclusive": row_end,
            "raster_rows": int(elevation.shape[0]),
            "columns": SIZE,
            "vertices": int(len(vertices)),
            "faces": int(len(faces)),
            "hemisphere": hemisphere,
            "resolution_ppd": RESOLUTION,
            "projection": "POLAR STEREOGRAPHIC",
            "source": str(input_path),
        }

        chunks.append(record)

        print(
            f"[{chunk_index + 1:02d}] "
            f"rows {row_start:5d}:{row_end:5d} "
            f"| vertices {len(vertices):,} "
            f"| faces {len(faces):,} "
            f"| {filename}"
        )

        chunk_index += 1

    manifest = {
        "project": "NeuroNexus",
        "product": f"MOLA MEG512 Polar {hemisphere}",
        "hemisphere": hemisphere,
        "resolution_ppd": RESOLUTION,
        "raster_size": [SIZE, SIZE],
        "projection": "POLAR STEREOGRAPHIC",
        "mars_radius_m": MARS_RADIUS_M,
        "source": str(input_path),
        "chunk_rows": CHUNK_ROWS,
        "chunks": chunks,
        "total_chunks": len(chunks),
        "total_vertices": sum(c["vertices"] for c in chunks),
        "total_faces": sum(c["faces"] for c in chunks),
    }

    manifest_path = output_dir / "index.json"
    manifest_path.write_text(
        json.dumps(manifest, indent=2),
        encoding="utf-8",
    )

    del raster

    print()
    print(f"✅ {hemisphere.upper()} POLAR MESH COMPLETE")
    print(f"Chunks      : {len(chunks)}")
    print(f"Vertices    : {manifest['total_vertices']:,}")
    print(f"Faces       : {manifest['total_faces']:,}")
    print(f"Manifest    : {manifest_path}")


def main() -> None:
    OUTPUT_ROOT.mkdir(parents=True, exist_ok=True)

    build_hemisphere("north")
    build_hemisphere("south")

    print()
    print("=" * 72)
    print("🪐 NATIVE POLAR MOLA MESH BUILD COMPLETE")
    print("=" * 72)


if __name__ == "__main__":
    main()
