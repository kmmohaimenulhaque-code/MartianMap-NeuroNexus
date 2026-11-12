from __future__ import annotations

from pathlib import Path

import numpy as np
import trimesh

from science.spatial.mola_polar import MolaPolar


MARS_RADIUS_M = 3_389_500.0

# Native MOLA polar resolution.
RESOLUTION = 512

# 4 degrees across at 512 pixels/degree.
PATCH_DEGREES = 4.0

GRID_SIZE = int(
    RESOLUTION * PATCH_DEGREES
)

# A scientifically convenient test location that is
# safely inside the MOLA polar raster.
CENTER_LATITUDE = 80.0
CENTER_LONGITUDE = 45.0

HEMISPHERE = "north"

OUTPUT_DIR = Path(
    "data/processed/meshes"
)


def build_faces(size: int) -> np.ndarray:
    rows = np.arange(
        size - 1,
        dtype=np.int64,
    )

    cols = np.arange(
        size - 1,
        dtype=np.int64,
    )

    row_grid, col_grid = np.meshgrid(
        rows,
        cols,
        indexing="ij",
    )

    top_left = (
        row_grid * size + col_grid
    )

    top_right = top_left + 1

    bottom_left = (
        (row_grid + 1) * size + col_grid
    )

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
    print("NEURONEXUS — MAXIMUM NATIVE MOLA MESH")
    print("=" * 72)

    print(
        f"Native resolution : {RESOLUTION} ppd"
    )
    print(
        f"Patch              : "
        f"{PATCH_DEGREES}° × {PATCH_DEGREES}°"
    )
    print(
        f"Grid               : "
        f"{GRID_SIZE:,} × {GRID_SIZE:,}"
    )
    print(
        f"Vertices           : "
        f"{GRID_SIZE * GRID_SIZE:,}"
    )

    polar = MolaPolar()

    # Centre pixel of the requested geographic location.
    center_row, center_col = (
        polar.pixel_from_latlon(
            CENTER_LATITUDE,
            CENTER_LONGITUDE,
            HEMISPHERE,
        )
    )

    half = GRID_SIZE // 2

    row_start = center_row - half
    row_end = row_start + GRID_SIZE

    col_start = center_col - half
    col_end = col_start + GRID_SIZE

    if row_start < 0 or row_end > polar.SIZE:
        raise ValueError(
            "Requested patch extends outside polar raster rows"
        )

    if col_start < 0 or col_end > polar.SIZE:
        raise ValueError(
            "Requested patch extends outside polar raster columns"
        )

    print()
    print(
        f"Polar raster window:"
    )
    print(
        f"  rows    {row_start}:{row_end}"
    )
    print(
        f"  columns {col_start}:{col_end}"
    )

    # Direct native raster access.
    raster = polar._open(HEMISPHERE)

    print()
    print("Reading native MOLA samples...")

    stored = np.asarray(
        raster[
            row_start:row_end,
            col_start:col_end,
        ],
        dtype=np.float32,
    )

    # MOLA polar encoding:
    #
    # elevation = stored * 0.25 - 8000
    elevation = (
        stored * 0.25 - 8000.0
    )

    print(
        f"Elevation range: "
        f"{float(elevation.min()):.2f} m "
        f"to "
        f"{float(elevation.max()):.2f} m"
    )

    # Build native polar pixel coordinates.
    rows = (
        np.arange(
            row_start,
            row_end,
            dtype=np.float64,
        )
    )

    cols = (
        np.arange(
            col_start,
            col_end,
            dtype=np.float64,
        )
    )

    row_grid, col_grid = np.meshgrid(
        rows,
        cols,
        indexing="ij",
    )

    # Inverse projection from the validated
    # MOLA polar stereographic equations.
    x = (
        (col_grid + 1.0 - polar.SIZE / 2.0 - 0.5)
        / RESOLUTION
    )

    y = (
        (row_grid + 1.0 - polar.SIZE / 2.0 - 0.5)
        / RESOLUTION
    )

    r = np.sqrt(
        x * x + y * y
    )

    longitude = (
        np.degrees(
            np.arctan2(x, y)
        )
        % 360.0
    )

    latitude = (
        90.0
        - np.degrees(
            2.0 * np.arctan(
                r * np.pi / 360.0
            )
        )
    )

    lat_rad = np.deg2rad(latitude)
    lon_rad = np.deg2rad(longitude)

    radius = (
        MARS_RADIUS_M
        + elevation
    )

    print("Converting to Mars-centered XYZ...")

    X = (
        radius
        * np.cos(lat_rad)
        * np.cos(lon_rad)
    )

    Y = (
        radius
        * np.cos(lat_rad)
        * np.sin(lon_rad)
    )

    Z = (
        radius
        * np.sin(lat_rad)
    )

    vertices = np.column_stack(
        (
            X.ravel(),
            Y.ravel(),
            Z.ravel(),
        )
    )

    print(
        f"Vertices ready: "
        f"{len(vertices):,}"
    )

    print("Building triangle indices...")

    faces = build_faces(
        GRID_SIZE
    )

    print(
        f"Triangles ready: "
        f"{len(faces):,}"
    )

    print("Creating mesh...")

    mesh = trimesh.Trimesh(
        vertices=vertices,
        faces=faces,
        process=False,
    )

    print("Computing normals...")

    mesh.fix_normals()

    OUTPUT_DIR.mkdir(
        parents=True,
        exist_ok=True,
    )

    glb_path = (
        OUTPUT_DIR
        / "mars_mola_512ppd_4deg.glb"
    )

    obj_path = (
        OUTPUT_DIR
        / "mars_mola_512ppd_4deg.obj"
    )

    print()
    print("Exporting GLB...")

    mesh.export(
        glb_path,
        file_type="glb",
    )

    print(
        f"GLB written: {glb_path}"
    )

    print()
    print("Exporting OBJ...")

    mesh.export(
        obj_path,
        file_type="obj",
    )

    print()
    print("=" * 72)
    print("MAXIMUM NATIVE MOLA MESH COMPLETE 🟢")
    print("=" * 72)
    print(
        f"Resolution : {RESOLUTION} ppd"
    )
    print(
        f"Vertices   : {len(vertices):,}"
    )
    print(
        f"Triangles  : {len(faces):,}"
    )
    print(
        f"GLB size   : "
        f"{glb_path.stat().st_size / 1024**2:.2f} MB"
    )
    print(
        f"OBJ size   : "
        f"{obj_path.stat().st_size / 1024**2:.2f} MB"
    )
    print("=" * 72)


if __name__ == "__main__":
    main()
