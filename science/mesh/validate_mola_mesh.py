from __future__ import annotations

import numpy as np

from science.mesh.mola_mesh import MARS_RADIUS_M, MolaMeshGenerator
from science.terrain.mola_terrain import MolaTerrainSampler


sampler = MolaTerrainSampler()

window = sampler.sample(
    24.3745,
    88.6042,
    radius=2,
)

generator = MolaMeshGenerator()
mesh = generator.generate(window)

vertices = mesh.vertices_m
faces = mesh.faces

print("MOLA MESH GEOMETRY VALIDATION")
print("=" * 72)

# ------------------------------------------------------------
# 1. Basic array validation
# ------------------------------------------------------------

assert vertices.ndim == 2
assert vertices.shape[1] == 3

assert faces.ndim == 2
assert faces.shape[1] == 3

assert np.isfinite(vertices).all()
assert np.isfinite(faces).all()

print("PASS: vertex/face arrays are valid")

# ------------------------------------------------------------
# 2. Face index validation
# ------------------------------------------------------------

assert (faces >= 0).all()
assert (faces < len(vertices)).all()

print("PASS: all face indices reference valid vertices")

# ------------------------------------------------------------
# 3. Triangle area validation
# ------------------------------------------------------------

a = vertices[faces[:, 0]]
b = vertices[faces[:, 1]]
c = vertices[faces[:, 2]]

cross = np.cross(
    b - a,
    c - a,
)

double_area = np.linalg.norm(
    cross,
    axis=1,
)

triangle_areas = double_area * 0.5

assert np.isfinite(triangle_areas).all()
assert (triangle_areas > 0).all()

print(
    f"PASS: all {len(triangle_areas)} triangles "
    "have non-zero area"
)

print(
    f"       min area = {triangle_areas.min():.6f} m²"
)

# ------------------------------------------------------------
# 4. Surface normals
# ------------------------------------------------------------

normals = cross / double_area[:, None]

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

print("PASS: all triangle normals are finite and unit length")

# ------------------------------------------------------------
# 5. Outward-facing normal validation
# ------------------------------------------------------------

face_centers = (
    a + b + c
) / 3.0

outward_direction = face_centers / np.linalg.norm(
    face_centers,
    axis=1,
)[:, None]

normal_alignment = np.sum(
    normals * outward_direction,
    axis=1,
)

outward_fraction = np.mean(
    normal_alignment > 0
)

print(
    f"       outward-facing triangles = "
    f"{outward_fraction * 100:.2f}%"
)

assert outward_fraction > 0.99

print("PASS: triangle winding produces outward normals")

# ------------------------------------------------------------
# 6. Radial distance validation
# ------------------------------------------------------------

radial_distance = np.linalg.norm(
    vertices,
    axis=1,
)

elevation = np.asarray(
    window.elevations_m,
    dtype=np.float64,
).ravel()

expected_radius = MARS_RADIUS_M + elevation

radial_error = np.abs(
    radial_distance - expected_radius
)

print(
    f"       max radial error = "
    f"{radial_error.max():.9f} m"
)

assert radial_error.max() < 1e-6

print("PASS: radial distances match MOLA elevation")

# ------------------------------------------------------------
# 7. Vertex geographic coverage
# ------------------------------------------------------------

assert len(mesh.latitudes_deg) == window.elevations_m.shape[0]
assert len(mesh.longitudes_deg) == window.elevations_m.shape[1]

assert np.isfinite(mesh.latitudes_deg).all()
assert np.isfinite(mesh.longitudes_deg).all()

print("PASS: geographic axes match mesh dimensions")

# ------------------------------------------------------------

print("=" * 72)
print("MOLA MESH GEOMETRY GREEN 🟢")
