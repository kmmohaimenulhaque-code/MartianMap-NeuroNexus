from __future__ import annotations

from pathlib import Path

import numpy as np
import trimesh


GLB = Path(
    "data/processed/meshes/mola_test_region.glb"
)


print("MOLA GLB ROUND-TRIP VALIDATION")
print("=" * 72)

assert GLB.exists()
assert GLB.stat().st_size > 0

loaded = trimesh.load(
    GLB,
    force="mesh",
)

assert isinstance(
    loaded,
    trimesh.Trimesh,
)

vertices = np.asarray(
    loaded.vertices,
    dtype=np.float64,
)

faces = np.asarray(
    loaded.faces,
    dtype=np.int64,
)

print(f"vertices : {len(vertices)}")
print(f"faces    : {len(faces)}")
print(f"bytes    : {GLB.stat().st_size}")

# Geometry
assert vertices.shape == (25, 3)
assert faces.shape == (32, 3)

assert np.isfinite(vertices).all()
assert (faces >= 0).all()
assert (faces < len(vertices)).all()

print("PASS: GLB geometry loaded correctly")

# Triangle areas
a = vertices[faces[:, 0]]
b = vertices[faces[:, 1]]
c = vertices[faces[:, 2]]

cross = np.cross(
    b - a,
    c - a,
)

areas = 0.5 * np.linalg.norm(
    cross,
    axis=1,
)

assert np.isfinite(areas).all()
assert (areas > 0).all()

print("PASS: all GLB triangles have non-zero area")

# Normals
normals = np.asarray(
    loaded.face_normals,
    dtype=np.float64,
)

assert normals.shape == (32, 3)
assert np.isfinite(normals).all()

normal_lengths = np.linalg.norm(
    normals,
    axis=1,
)

assert np.allclose(
    normal_lengths,
    1.0,
    atol=1e-6,
)

print("PASS: GLB normals are finite and unit length")

# Outward normal check
centres = (
    a + b + c
) / 3.0

radial = centres / np.linalg.norm(
    centres,
    axis=1,
)[:, None]

alignment = np.sum(
    normals * radial,
    axis=1,
)

outward_fraction = np.mean(
    alignment > 0
)

print(
    f"outward-facing triangles = "
    f"{outward_fraction * 100:.2f}%"
)

assert outward_fraction > 0.99

print("PASS: GLB normals point outward")

print("=" * 72)
print("MOLA GLB ROUND-TRIP GREEN 🟢")
