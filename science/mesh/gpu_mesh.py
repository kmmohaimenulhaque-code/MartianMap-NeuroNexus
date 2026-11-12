from __future__ import annotations

import numpy as np
import torch

from science.ingestion.mola import load_elevation_array


MOLA_PATH = "data/raw/mola/meg016/megt90n000eb.img"
MARS_RADIUS = 3_389_500.0


def get_device() -> torch.device:
    if torch.cuda.is_available():
        return torch.device("cuda")
    return torch.device("cpu")


def build_mars_mesh_gpu(
    elevation: np.ndarray,
    row_step: int = 8,
    col_step: int = 8,
) -> tuple[np.ndarray, np.ndarray]:

    device = get_device()

    terrain = torch.as_tensor(
        elevation,
        dtype=torch.float32,
        device=device,
    )

    terrain = terrain[::row_step, ::col_step]

    rows, cols = terrain.shape

    lat = torch.linspace(
        90.0,
        -90.0,
        rows,
        device=device,
        dtype=torch.float32,
    )

    lon = torch.linspace(
        0.0,
        360.0,
        cols,
        device=device,
        dtype=torch.float32,
    )

    lat_grid, lon_grid = torch.meshgrid(
        lat,
        lon,
        indexing="ij",
    )

    lat_rad = torch.deg2rad(lat_grid)
    lon_rad = torch.deg2rad(lon_grid)

    radius = MARS_RADIUS + terrain

    x = radius * torch.cos(lat_rad) * torch.cos(lon_rad)
    y = radius * torch.cos(lat_rad) * torch.sin(lon_rad)
    z = radius * torch.sin(lat_rad)

    vertices = torch.stack(
        (x, y, z),
        dim=-1,
    ).reshape(-1, 3)

    row = torch.arange(
        rows - 1,
        device=device,
    )

    col = torch.arange(
        cols - 1,
        device=device,
    )

    r, c = torch.meshgrid(
        row,
        col,
        indexing="ij",
    )

    top_left = r * cols + c
    top_right = top_left + 1
    bottom_left = (r + 1) * cols + c
    bottom_right = bottom_left + 1

    faces_a = torch.stack(
        (top_left, bottom_left, top_right),
        dim=-1,
    )

    faces_b = torch.stack(
        (top_right, bottom_left, bottom_right),
        dim=-1,
    )

    faces = torch.cat(
        (
            faces_a.reshape(-1, 3),
            faces_b.reshape(-1, 3),
        ),
        dim=0,
    )

    return (
        vertices.cpu().numpy().astype(np.float32),
        faces.cpu().numpy().astype(np.int32),
    )


def verify_mesh() -> None:

    print("=" * 60)
    print("       NEURONEXUS MI300X MARS MESH GENERATOR")
    print("=" * 60)

    device = get_device()

    print(f"PyTorch : {torch.__version__}")
    print(
        f"GPU     : "
        f"{torch.cuda.get_device_name(0) if torch.cuda.is_available() else 'CPU'}"
    )
    print(f"Device  : {device}")

    print("\nLoading real NASA MOLA terrain...")

    elevation = load_elevation_array(MOLA_PATH)

    print(f"Terrain : {elevation.shape}")

    print("\nGenerating mesh on MI300X...")

    vertices, faces = build_mars_mesh_gpu(
        elevation,
        row_step=8,
        col_step=8,
    )

    print("\nMESH RESULTS")
    print("-" * 60)

    print(f"Vertices : {len(vertices):,}")
    print(f"Faces    : {len(faces):,}")

    print(f"Vertex shape : {vertices.shape}")
    print(f"Face shape   : {faces.shape}")

    print(f"\nVertex min : {vertices.min(axis=0)}")
    print(f"Vertex max : {vertices.max(axis=0)}")

    print("\nValidation")
    print("-" * 60)

    print(f"Vertices finite : {np.isfinite(vertices).all()}")
    print(
        f"Faces valid     : "
        f"{faces.min() >= 0 and faces.max() < len(vertices)}"
    )
    print(f"Mesh non-empty  : {len(vertices) > 0 and len(faces) > 0}")

    print("=" * 60)
    print("🟢 MI300X MARS MESH GENERATOR READY")
    print("=" * 60)


if __name__ == "__main__":
    verify_mesh()
