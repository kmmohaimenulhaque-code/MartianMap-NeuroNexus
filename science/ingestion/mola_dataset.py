"""
Convert the real MOLA MEG016 product into a coordinate-aware xarray Dataset.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
import xarray as xr


WIDTH = 5760
HEIGHT = 2880
RESOLUTION = 1.0 / 16.0


def load_mola(path: str | Path) -> xr.Dataset:
    path = Path(path)

    raw = np.fromfile(path, dtype=">i2")

    expected = WIDTH * HEIGHT
    if raw.size != expected:
        raise ValueError(
            f"Expected {expected:,} samples, got {raw.size:,}"
        )

    elevation = raw.reshape(HEIGHT, WIDTH).astype(np.float32)

    # 16 pixels/degree.
    lat = 90.0 - (np.arange(HEIGHT) + 0.5) * RESOLUTION
    lon = (np.arange(WIDTH) + 0.5) * RESOLUTION

    ds = xr.Dataset(
        data_vars={
            "elevation": (
                ("latitude", "longitude"),
                elevation,
                {
                    "units": "meter",
                    "source": "MGS MOLA MEGDR",
                    "resolution": "16 pixels/degree",
                },
            )
        },
        coords={
            "latitude": (
                "latitude",
                lat,
                {"units": "degree_north"},
            ),
            "longitude": (
                "longitude",
                lon,
                {"units": "degree_east"},
            ),
        },
        attrs={
            "mission": "Mars Global Surveyor",
            "instrument": "Mars Orbiter Laser Altimeter",
            "product": "MEG016",
            "reference_system": "IAU2000",
        },
    )

    return ds


if __name__ == "__main__":
    path = "data/raw/mola/meg016/megt90n000eb.img"

    ds = load_mola(path)

    print("=" * 60)
    print("       NEURONEXUS MOLA XARRAY DATASET")
    print("=" * 60)
    print(ds)
    print()
    print(f"Elevation min : {float(ds.elevation.min()):.2f} m")
    print(f"Elevation max : {float(ds.elevation.max()):.2f} m")
    print(f"Latitude      : {float(ds.latitude.min()):.4f} → {float(ds.latitude.max()):.4f}")
    print(f"Longitude     : {float(ds.longitude.min()):.4f} → {float(ds.longitude.max()):.4f}")
    print("=" * 60)
    print("🟢 MOLA DATASET READY")
