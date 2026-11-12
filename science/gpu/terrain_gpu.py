"""
NeuroNexus MI300X GPU terrain derivative engine.

CPU reference:
    science.terrain.derivatives

GPU implementation:
    PyTorch + ROCm on AMD Instinct MI300X
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
import torch

from science.ingestion.mola_dataset import load_mola


MOLA_PATH = Path("data/raw/mola/meg016/megt90n000eb.img")

MARS_RADIUS = 3_389_500.0

D_LAT_DEG = 1.0 / 16.0
D_LON_DEG = 1.0 / 16.0


def get_device() -> torch.device:
    """Return the ROCm GPU when available."""

    if torch.cuda.is_available():
        return torch.device("cuda")

    return torch.device("cpu")


def terrain_derivatives_gpu(
    elevation: np.ndarray,
) -> dict[str, np.ndarray]:
    """
    Compute slope and aspect on the GPU.

    Parameters
    ----------
    elevation:
        2D Mars elevation grid ordered [latitude, longitude].

    Returns
    -------
    dict[str, np.ndarray]
        slope_deg and aspect_deg as NumPy arrays.
    """

    device = get_device()

    terrain = torch.from_numpy(
        np.asarray(elevation, dtype=np.float32)
    ).to(device)

    rows, cols = terrain.shape

    # Latitude of each MOLA row.
    latitudes = (
        90.0
        - (torch.arange(rows, device=device, dtype=torch.float32) + 0.5)
        * D_LAT_DEG
    )

    # Physical distance between latitude samples.
    dy = np.deg2rad(D_LAT_DEG) * MARS_RADIUS

    # Physical distance between longitude samples.
    dx = torch.cos(torch.deg2rad(latitudes)) * (
        np.deg2rad(D_LON_DEG) * MARS_RADIUS
    )

    # ------------------------------------------------------------
    # NORTH/SOUTH GRADIENT
    # ------------------------------------------------------------

    dz_dy = torch.empty_like(terrain)

    dz_dy[1:-1, :] = (
        terrain[2:, :] - terrain[:-2, :]
    ) / (2.0 * dy)

    dz_dy[0, :] = (
        terrain[1, :] - terrain[0, :]
    ) / dy

    dz_dy[-1, :] = (
        terrain[-1, :] - terrain[-2, :]
    ) / dy

    # ------------------------------------------------------------
    # EAST/WEST GRADIENT
    # ------------------------------------------------------------

    dz_dx = torch.empty_like(terrain)

    dz_dx[:, 1:-1] = (
        terrain[:, 2:] - terrain[:, :-2]
    ) / (2.0 * dx[:, None])

    dz_dx[:, 0] = (
        terrain[:, 1] - terrain[:, 0]
    ) / dx

    dz_dx[:, -1] = (
        terrain[:, -1] - terrain[:, -2]
    ) / dx

    # ------------------------------------------------------------
    # SLOPE
    # ------------------------------------------------------------

    slope_rad = torch.atan(
        torch.sqrt(
            dz_dx.square() + dz_dy.square()
        )
    )

    slope_deg = torch.rad2deg(slope_rad)

    # ------------------------------------------------------------
    # ASPECT
    #
    # 0°   = North
    # 90°  = East
    # 180° = South
    # 270° = West
    # ------------------------------------------------------------

    aspect_deg = (
        torch.rad2deg(
            torch.atan2(dz_dx, -dz_dy)
        )
        + 360.0
    ) % 360.0

    # Move results back to host memory.
    return {
        "slope_deg": slope_deg.cpu().numpy(),
        "aspect_deg": aspect_deg.cpu().numpy(),
    }


def verify_gpu() -> None:
    """Run the complete MI300X terrain-engine smoke test."""

    print("=" * 60)
    print("       NEURONEXUS MI300X TERRAIN ENGINE")
    print("=" * 60)

    print(f"PyTorch : {torch.__version__}")
    print(f"ROCm/HIP: {torch.version.hip}")

    if not torch.cuda.is_available():
        print("GPU     : NOT AVAILABLE")
        raise RuntimeError("ROCm GPU is not available.")

    print(f"GPU     : {torch.cuda.get_device_name(0)}")
    print("GPU     : READY")

    ds = load_mola(MOLA_PATH)

    elevation = ds["elevation"].values

    print()
    print(f"Terrain : {elevation.shape}")
    print("Running GPU terrain derivatives...")

    result = terrain_derivatives_gpu(elevation)

    for name, array in result.items():
        finite = np.isfinite(array)

        print()
        print(name)
        print(f"  shape  : {array.shape}")
        print(f"  dtype  : {array.dtype}")
        print(f"  min    : {float(array[finite].min()):.4f}")
        print(f"  max    : {float(array[finite].max()):.4f}")
        print(f"  mean   : {float(array[finite].mean()):.4f}")
        print(f"  finite : {float(finite.mean()):.4f}")

    print()
    print("=" * 60)
    print("🟢 MI300X TERRAIN ENGINE READY")
    print("=" * 60)


if __name__ == "__main__":
    verify_gpu()
