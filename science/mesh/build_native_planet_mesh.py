from __future__ import annotations

import json
import math
from pathlib import Path

import numpy as np
import trimesh


ROOT = Path(__file__).resolve().parents[2]

CATALOG_PATH = ROOT / "data/manifests/mola_tiles.json"
OUTPUT_ROOT = ROOT / "data/processed/planet_mesh"

MARS_RADIUS_M = 3_389_500.0

GLOBAL_ROWS = 5632
GLOBAL_COLUMNS = 11520

POLAR_SIZE = 12288

CHUNK_ROWS = 256


def build_faces(rows: int, columns: int) -> np.ndarray:
    cells = (rows - 1) * (columns - 1)

    faces = np.empty((cells * 2, 3), dtype=np.int32)

    cursor = 0

    for row in range(rows - 1):
        base = row * columns
        next_base = (row + 1) * columns

        for col in range(columns - 1):
            tl = base + col
            tr = tl + 1
            bl = next_base + col
            br = bl + 1

            faces[cursor] = (tl, tr, bl)
            faces[cursor + 1] = (tr, br, bl)

            cursor += 2

    return faces


def global_chunk(
    image_path: Path,
    row_start: int,
    row_end: int,
    west_lon: float,
    north_lat: float,
    resolution: float,
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:

    row_count = row_end - row_start

    elevation = np.memmap(
        image_path,
        dtype=">i2",
        mode="r",
        shape=(GLOBAL_ROWS, GLOBAL_COLUMNS),
    )

    z = np.asarray(
        elevation[row_start:row_end],
        dtype=np.float32,
    )

    rows = np.arange(row_start, row_end, dtype=np.float64)
    cols = np.arange(GLOBAL_COLUMNS, dtype=np.float64)

    lat = north_lat - rows / resolution
    lon = west_lon + cols / resolution

    lat_grid, lon_grid = np.meshgrid(lat, lon, indexing="ij")

    lat_rad = np.deg2rad(lat_grid)
    lon_rad = np.deg2rad(lon_grid)

    radius = MARS_RADIUS_M + z

    x = radius * np.cos(lat_rad) * np.cos(lon_rad)
    y = radius * np.cos(lat_rad) * np.sin(lon_rad)
    zz = radius * np.sin(lat_rad)

    vertices = np.column_stack(
        (
            x.ravel(),
            y.ravel(),
            zz.ravel(),
        )
    ).astype(np.float32)

    return vertices, lat, lon


def process_global_tile(tile: dict) -> None:
    tile_id = tile["id"]

    image_path = ROOT / tile["path"]

    tile_output = OUTPUT_ROOT / "global" / tile_id
    tile_output.mkdir(parents=True, exist_ok=True)

    rows = int(tile["rows"])
    columns = int(tile["columns"])

    resolution = float(tile["resolution_px_per_degree"])
    north_lat = float(tile["north_latitude"])
    west_lon = float(tile["west_longitude"])

    print()
    print("=" * 75)
    print(f"GLOBAL TILE: {tile_id}")
    print("=" * 75)
    print(f"Raster       : {rows:,} × {columns:,}")
    print(f"Samples      : {rows * columns:,}")
    print(f"Resolution   : {resolution} ppd")
    print()

    # For the first production pass, create independently loadable
    # horizontal mesh chunks.
    chunk_index = []

    for chunk_number, row_start in enumerate(
        range(0, rows, CHUNK_ROWS)
    ):
        row_end = min(row_start + CHUNK_ROWS, rows)

        vertices, latitudes, longitudes = global_chunk(
            image_path,
            row_start,
            row_end,
            west_lon,
            north_lat,
            resolution,
        )

        chunk_rows = row_end - row_start

        if chunk_rows < 2:
            continue

        faces = build_faces(chunk_rows, columns)

        mesh = trimesh.Trimesh(
            vertices=vertices,
            faces=faces,
            process=False,
        )

        mesh.fix_normals()

        output = tile_output / f"chunk_{chunk_number:04d}.glb"

        mesh.export(output)

        chunk_index.append(
            {
                "chunk": chunk_number,
                "row_start": row_start,
                "row_end": row_end,
                "vertex_count": int(len(vertices)),
                "triangle_count": int(len(faces)),
                "file": str(output.relative_to(ROOT)),
            }
        )

        print(
            f"  chunk {chunk_number:04d} | "
            f"rows {row_start:5d}–{row_end - 1:5d} | "
            f"vertices {len(vertices):,} | "
            f"triangles {len(faces):,}"
        )

    index_path = tile_output / "index.json"

    index_path.write_text(
        json.dumps(
            {
                "tile_id": tile_id,
                "product": tile["product"],
                "projection": tile["projection"],
                "resolution_px_per_degree": resolution,
                "chunks": chunk_index,
            },
            indent=2,
        ),
        encoding="utf-8",
    )

    print()
    print(f"INDEX: {index_path}")


def main() -> None:
    catalog = json.loads(
        CATALOG_PATH.read_text(encoding="utf-8")
    )

    OUTPUT_ROOT.mkdir(parents=True, exist_ok=True)

    global_tiles = [
        tile
        for tile in catalog["tiles"]
        if tile["product"] == "MOLA MEGDR 128 ppd"
    ]

    print("=" * 75)
    print("NEURONEXUS NATIVE PLANETARY MESH BUILDER")
    print("=" * 75)
    print(f"Global MOLA tiles : {len(global_tiles)}")
    print()
    print(
        "IMPORTANT: native-resolution tiled build; "
        "no global upsampling."
    )

    for tile in global_tiles:
        process_global_tile(tile)

    print()
    print("=" * 75)
    print("GLOBAL NATIVE MESH BUILD COMPLETE")
    print("=" * 75)


if __name__ == "__main__":
    main()
