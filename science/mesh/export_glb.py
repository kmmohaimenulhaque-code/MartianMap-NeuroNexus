from __future__ import annotations

from pathlib import Path

import numpy as np
import trimesh

from science.ingestion.mola import load_elevation_array
from science.mesh.gpu_mesh import build_mars_mesh_gpu


MOLA_PATH = "data/raw/mola/meg016/megt90n000eb.img"
OUTPUT = Path("assets/meshes/mars_terrain.glb")


def export_mars_glb() -> None:

    print("=" * 60)
    print("       NEURONEXUS MARS GLB EXPORTER")
    print("=" * 60)

    print("\nLoading NASA MOLA terrain...")

    elevation = load_elevation_array(MOLA_PATH)

    print(f"Terrain : {elevation.shape}")

    print("\nGenerating MI300X terrain mesh...")

    vertices, faces = build_mars_mesh_gpu(
        elevation,
        row_step=8,
        col_step=8,
    )

    print(f"Vertices : {len(vertices):,}")
    print(f"Faces    : {len(faces):,}")

    print("\nBuilding Trimesh object...")

    mesh = trimesh.Trimesh(
        vertices=vertices,
        faces=faces,
        process=False,
    )

    print(f"Watertight : {mesh.is_watertight}")
    print(f"Bounds     :\n{mesh.bounds}")

    OUTPUT.parent.mkdir(
        parents=True,
        exist_ok=True,
    )

    print("\nExporting GLB...")

    mesh.export(
        OUTPUT,
        file_type="glb",
    )

    size_mb = OUTPUT.stat().st_size / (1024 * 1024)

    print(f"\nOutput : {OUTPUT}")
    print(f"Size   : {size_mb:.2f} MB")

    print("\nValidation")
    print("-" * 60)

    print(f"File exists : {OUTPUT.exists()}")
    print(f"Vertices    : {len(mesh.vertices):,}")
    print(f"Faces       : {len(mesh.faces):,}")
    print(f"Finite      : {np.isfinite(mesh.vertices).all()}")

    print("=" * 60)
    print("🟢 MARS GLB EXPORT COMPLETE")
    print("=" * 60)


if __name__ == "__main__":
    export_mars_glb()
