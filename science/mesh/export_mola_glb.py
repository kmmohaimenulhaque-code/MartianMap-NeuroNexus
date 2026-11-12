from __future__ import annotations

from pathlib import Path

import numpy as np
import trimesh

from science.mesh.mola_mesh import MolaMeshGenerator
from science.terrain.mola_terrain import MolaTerrainSampler


OUTPUT = Path(
    "data/processed/meshes/mola_test_region.glb"
)


def main() -> None:
    sampler = MolaTerrainSampler()

    window = sampler.sample(
        24.3745,
        88.6042,
        radius=2,
    )

    generator = MolaMeshGenerator()
    mesh = generator.generate(window)

    vertices = np.asarray(
        mesh.vertices_m,
        dtype=np.float64,
    )

    faces = np.asarray(
        mesh.faces,
        dtype=np.int64,
    )

    # trimesh computes face normals from the validated
    # outward-facing triangle winding.
    terrain = trimesh.Trimesh(
        vertices=vertices,
        faces=faces,
        process=False,
    )

    # Explicitly calculate normals.
    terrain.fix_normals()

    OUTPUT.parent.mkdir(
        parents=True,
        exist_ok=True,
    )

    terrain.export(
        OUTPUT,
        file_type="glb",
    )

    print("MOLA GLB EXPORT")
    print("=" * 72)
    print(f"vertices : {len(terrain.vertices)}")
    print(f"faces    : {len(terrain.faces)}")
    print(f"output   : {OUTPUT}")
    print(f"bytes    : {OUTPUT.stat().st_size}")
    print("=" * 72)
    print("GLB EXPORT GREEN 🟢")


if __name__ == "__main__":
    main()
