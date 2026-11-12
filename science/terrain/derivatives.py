"""
Mars terrain derivatives.

Computes slope, aspect, and local roughness from MOLA elevation data.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np

from science.ingestion.mola_dataset import load_mola


MOLA_PATH = Path("data/raw/mola/meg016/megt90n000eb.img")

# Mars mean radius in metres.
MARS_RADIUS = 3_389_500.0


def compute_terrain_derivatives(elevation: np.ndarray) -> dict[str, np.ndarray]:
    """
    Compute basic terrain derivatives from a global MOLA elevation grid.

    Parameters
    ----------
    elevation:
        2D elevation array ordered [latitude, longitude].

    Returns
    -------
    dict
        slope_deg, aspect_deg, roughness_m
    """

    elevation = np.asarray(elevation, dtype=np.float32)

    if elevation.ndim != 2:
        raise ValueError("Elevation must be a 2D array.")

    rows, cols = elevation.shape

    # MOLA MEG016: 16 samples per degree.
    dlat_deg = 1.0 / 16.0
    dlon_deg = 1.0 / 16.0

    # Approximate grid spacing at each latitude.
    latitudes = 90.0 - (np.arange(rows) + 0.5) * dlat_deg

    dy = np.deg2rad(dlat_deg) * MARS_RADIUS
    dx = np.cos(np.deg2rad(latitudes))[:, None] * (
        np.deg2rad(dlon_deg) * MARS_RADIUS
    )

    # Elevation gradients.
    dz_dy, dz_dx_index = np.gradient(elevation)

    dz_dy = dz_dy / dy
    dz_dx = dz_dx_index / dx

    # Gradient magnitude -> slope.
    slope_rad = np.arctan(np.sqrt(dz_dx**2 + dz_dy**2))
    slope_deg = np.degrees(slope_rad).astype(np.float32)

    # Aspect convention:
    # 0° = north, 90° = east, 180° = south, 270° = west.
    aspect_deg = (
        np.degrees(np.arctan2(dz_dx, -dz_dy)) + 360.0
    ) % 360.0

    aspect_deg = aspect_deg.astype(np.float32)

    # Simple 3x3 local elevation range as a first roughness metric.
    padded = np.pad(elevation, 1, mode="edge")

    neighbours = []

    for row_offset in range(3):
        for col_offset in range(3):
            neighbours.append(
                padded[
                    row_offset : row_offset + rows,
                    col_offset : col_offset + cols,
                ]
            )

    local_max = np.maximum.reduce(neighbours)
    local_min = np.minimum.reduce(neighbours)

    roughness_m = (local_max - local_min).astype(np.float32)

    return {
        "slope_deg": slope_deg,
        "aspect_deg": aspect_deg,
        "roughness_m": roughness_m,
    }


if __name__ == "__main__":
    print("=" * 60)
    print("       NEURONEXUS TERRAIN DERIVATIVES")
    print("=" * 60)

    ds = load_mola(MOLA_PATH)

    elevation = ds["elevation"].values

    print(f"Elevation shape : {elevation.shape}")

    derivatives = compute_terrain_derivatives(elevation)

    for name, array in derivatives.items():
        finite = np.isfinite(array)

        print()
        print(f"{name}")
        print(f"  shape    : {array.shape}")
        print(f"  dtype    : {array.dtype}")
        print(f"  min      : {float(array[finite].min()):.4f}")
        print(f"  max      : {float(array[finite].max()):.4f}")
        print(f"  mean     : {float(array[finite].mean()):.4f}")
        print(f"  finite   : {float(finite.mean()):.4f}")

    print()
    print("=" * 60)
    print("🟢 TERRAIN DERIVATIVES READY")
    print("=" * 60)
