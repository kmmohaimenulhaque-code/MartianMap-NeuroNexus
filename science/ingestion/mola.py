"""
MOLA terrain-data ingestion utilities.

NeuroNexus — Martian Map
NASA Space Apps Challenge 2026
"""

from __future__ import annotations

from pathlib import Path

import numpy as np


def load_elevation_array(path: str | Path) -> np.ndarray:
    """
    Load a raster-like elevation array from a NumPy .npy file.

    The ingestion layer deliberately keeps the raw numerical array
    separate from downstream terrain analysis and mesh generation.
    """
    path = Path(path)

    if not path.exists():
        raise FileNotFoundError(f"Elevation file not found: {path}")

    elevation = np.load(path)

    if elevation.ndim != 2:
        raise ValueError(
            f"Expected a 2D elevation grid, got shape {elevation.shape}"
        )

    if not np.issubdtype(elevation.dtype, np.number):
        raise TypeError("Elevation grid must contain numeric values")

    return elevation


def validate_elevation(elevation: np.ndarray) -> dict:
    """Return basic scientific/data-quality statistics."""
    finite = np.isfinite(elevation)

    if not finite.any():
        raise ValueError("Elevation grid contains no finite values")

    valid = elevation[finite]

    return {
        "shape": tuple(elevation.shape),
        "dtype": str(elevation.dtype),
        "finite_fraction": float(finite.mean()),
        "min": float(valid.min()),
        "max": float(valid.max()),
        "mean": float(valid.mean()),
        "nan_count": int(np.isnan(elevation).sum()),
        "inf_count": int(np.isinf(elevation).sum()),
    }
