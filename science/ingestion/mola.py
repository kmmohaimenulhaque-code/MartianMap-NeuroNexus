from __future__ import annotations

from pathlib import Path

import numpy as np


MOLA_ROWS = 2880
MOLA_COLS = 5760
MOLA_DTYPE = np.dtype(">i2")


def load_elevation_array(path: str | Path) -> np.ndarray:
    """
    Load an elevation array from either:

    1. NumPy .npy files used by synthetic fixtures.
    2. Raw NASA MOLA PDS4 SignedMSB2 .img products.

    The MOLA MEG016 product is a 2880 x 5760 grid of
    big-endian signed 16-bit elevation values in meters.
    """

    path = Path(path)

    if not path.exists():
        raise FileNotFoundError(
            f"Elevation file not found: {path}"
        )

    if path.suffix.lower() == ".npy":
        elevation = np.load(path)

        return np.asarray(
            elevation,
            dtype=np.float32,
        )

    if path.suffix.lower() == ".img":
        raw = np.fromfile(
            path,
            dtype=MOLA_DTYPE,
        )

        expected = MOLA_ROWS * MOLA_COLS

        if raw.size != expected:
            raise ValueError(
                "Unexpected MOLA product size: "
                f"expected {expected:,} samples, "
                f"found {raw.size:,}"
            )

        elevation = raw.reshape(
            MOLA_ROWS,
            MOLA_COLS,
        )

        return elevation.astype(
            np.float32,
            copy=False,
        )

    raise ValueError(
        f"Unsupported elevation format: {path.suffix}"
    )


def validate_elevation(elevation: np.ndarray) -> dict:
    """
    Return basic validation statistics for an elevation grid.
    """

    elevation = np.asarray(elevation)

    finite = np.isfinite(elevation)

    return {
        "shape": elevation.shape,
        "dtype": str(elevation.dtype),
        "finite_fraction": float(finite.mean()),
        "min": float(np.nanmin(elevation)),
        "max": float(np.nanmax(elevation)),
        "mean": float(np.nanmean(elevation)),
        "nan_count": int(np.isnan(elevation).sum()),
        "inf_count": int(np.isinf(elevation).sum()),
    }


if __name__ == "__main__":
    print("=" * 60)
    print("       NEURONEXUS MOLA INGESTION")
    print("=" * 60)

    path = Path(
        "data/raw/mola/meg016/megt90n000eb.img"
    )

    elevation = load_elevation_array(path)
    stats = validate_elevation(elevation)

    for key, value in stats.items():
        print(f"{key:18}: {value}")

    print("=" * 60)
    print("🟢 MOLA INGESTION READY")
    print("=" * 60)
