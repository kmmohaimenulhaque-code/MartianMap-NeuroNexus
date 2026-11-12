from __future__ import annotations

from pathlib import Path

import numpy as np
import trimesh

from science.spatial.mola_unified import MolaUnified


MARS_RADIUS_M = 3_389_500.0

# 1024 x 1024 = 1,048,576 vertices.
GRID_SIZE = 1024

# ~8 degrees across at MOLA MEG128 resolution.
LAT_MIN = 20.0
LAT_MAX = 28.0
LON_MIN = 84.0
LON_MAX = 92.0

OUTPUT_DIR = Path("data/processed/meshes")


def mars_xyz(
    latitude_deg: np.ndarray,
    longitude_deg: np.ndarray,
    elevation_m: np.ndarray,
) -> np.ndarray:
    lat = np.deg2rad(latitude_deg)
    lon = np.deg2rad(longitude_deg)

    radius = MARS_RADIUS_M + elevation_m

    x = radius * np.cos(lat) * np.cos(lon)
    y = radius * np.cos(lat) * np.sin(lon)
    z = radius * np.sin(lat)

    return np.column_stack(
        (
            x.ravel(),
            y.ravel(),
            z.ravel(),
        )
    )


def build_faces(size: int) -> np.ndarray:
    rows = np.arange(size - 1, dtype=np.int64)
    cols = np.arange(size - 1, dtype=np.int64)

    row_grid, col_grid = np.meshgrid(
        rows,
        cols,
        indexing="ij",
    )

    top_left = row_grid * size + col_grid
    top_right = top_left + 1
    bottom_left = (row_grid + 1) * size + col_grid
    bottom_right = bottom_left + 1

    faces_a = np.stack(
        (
            top_left,
            top_right,
            bottom_left,
        ),
        axis=-1,
    )

    faces_b = np.stack(
        (
            top_right,
            bottom_right,
            bottom_left,
        ),
        axis=-1,
    )

    return np.concatenate(
        (
            faces_a.reshape(-1, 3),
            faces_b.reshape(-1, 3),
        ),
        axis=0,
    )


def main() -> None:
    print("NEURONEXUS REGIONAL MOLA MESH")
    print("=" * 72)

    mola = MolaUnified()

    latitudes = np.linspace(
        LAT_MAX,
        LAT_MIN,
        GRID_SIZE,
        dtype=np.float64,
    )

    longitudes = np.linspace(
        LON_MIN,
        LON_MAX,
        GRID_SIZE,
        dtype=np.float64,
    )

    elevations = np.empty(
        (GRID_SIZE, GRID_SIZE),
        dtype=np.float32,
    )

    print(
        f"sampling {GRID_SIZE} x {GRID_SIZE} "
        f"= {GRID_SIZE * GRID_SIZE:,} MOLA points"
    )

    for row, latitude in enumerate(latitudes):
        for column, longitude in enumerate(longitudes):
            elevations[row, column] = mola.elevation_at(
                float(latitude),
                float(longitude),
            )

        if (row + 1) % 64 == 0:
            print(
                f"  rows: {row + 1}/{GRID_SIZE}"
            )

    print("MOLA sampling complete.")

    lat_grid, lon_grid = np.meshgrid(
        latitudes,
        longitudes,
        indexing="ij",
    )

    vertices = mars_xyz(
        lat_grid,
        lon_grid,
        elevations,
    )

    print(
        f"vertices: {len(vertices):,}"
    )

    faces = build_faces(GRID_SIZE)

    print(
        f"triangles: {len(faces):,}"
    )

    mesh = trimesh.Trimesh(
        vertices=vertices,
        faces=faces,
        process=False,
    )

    # Keep our validated outward winding.
    mesh.fix_normals()

    OUTPUT_DIR.mkdir(
        parents=True,
        exist_ok=True,
    )

    glb_path = (
        OUTPUT_DIR /
        "mars_regional_mola_1024.glb"
    )

    obj_path = (
        OUTPUT_DIR /
        "mars_regional_mola_1024.obj"
    )

    print("exporting GLB...")
    mesh.export(
        glb_path,
        file_type="glb",
    )

    print("exporting OBJ...")
    mesh.export(
        obj_path,
        file_type="obj",
    )

    print()
    print("=" * 72)
    print("REGIONAL MESH COMPLETE 🟢")
    print("=" * 72)
    print(f"vertices : {len(vertices):,}")
    print(f"triangles: {len(faces):,}")
    print(f"GLB      : {glb_path}")
    print(
        f"GLB size : "
        f"{glb_path.stat().st_size / 1024 / 1024:.2f} MB"
    )
    print(f"OBJ      : {obj_path}")
    print(
        f"OBJ size : "
        f"{obj_path.stat().st_size / 1024 / 1024:.2f} MB"
    )


if __name__ == "__main__":
    main()
