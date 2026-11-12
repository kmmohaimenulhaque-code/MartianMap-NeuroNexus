"""GET /thermal/samples: individual historical THEMIS IR-PBT samples near a site, binned for a heatmap.

OBSERVED, historical: brightness temperature is not physical surface temperature and not current weather.
"""
from __future__ import annotations

import math
from functools import lru_cache

import numpy as np
import pandas as pd
from fastapi import APIRouter, Query

from science import settings
from science.constants import MARS_RADIUS_KM

router = APIRouter(prefix="/thermal", tags=["thermal"])
PARQUET = settings.PROJECT_ROOT / "data/indexes/themis/final/parquet/neuronexus_thermal_observations.parquet"
LST_BIN_H, LS_BIN_DEG = 2.0, 30.0


@lru_cache(maxsize=1)
def _table() -> pd.DataFrame:
    cols = ["latitude_deg", "longitude_deg", "brightness_temperature_k", "product_id", "observation_start",
            "solar_longitude_deg", "local_solar_time_hours", "resolution_m"]
    return pd.read_parquet(PARQUET, columns=cols)


@router.get("/samples")
def samples(lat: float = Query(..., ge=-90, le=90), lon: float = Query(..., ge=-180, le=360),
            radius_km: float = Query(50.0, gt=0, le=500), limit: int = Query(300, ge=1, le=2000)):
    t = _table()
    p1, p2 = math.radians(lat), np.radians(t["latitude_deg"].to_numpy())
    dl = np.radians(((t["longitude_deg"].to_numpy() - lon + 180.0) % 360.0) - 180.0)
    h = np.sin((p2 - p1) / 2) ** 2 + math.cos(p1) * np.cos(p2) * np.sin(dl / 2) ** 2
    dist = 2 * MARS_RADIUS_KM * np.arcsin(np.sqrt(np.clip(h, 0, 1)))
    sel = t[dist <= radius_km].assign(distance_km=dist[dist <= radius_km]).sort_values(["distance_km", "product_id"])
    tb = sel["brightness_temperature_k"].to_numpy(dtype=float)
    rows, cols = int(24 / LST_BIN_H), int(360 / LS_BIN_DEG)
    grid_sum, grid_n = np.zeros((rows, cols)), np.zeros((rows, cols), dtype=int)
    if len(sel):
        r = np.clip((sel["local_solar_time_hours"].to_numpy() // LST_BIN_H).astype(int), 0, rows - 1)
        c = np.clip((sel["solar_longitude_deg"].to_numpy() // LS_BIN_DEG).astype(int), 0, cols - 1)
        np.add.at(grid_sum, (r, c), tb)
        np.add.at(grid_n, (r, c), 1)
    grid = [[None if grid_n[i, j] == 0 else round(float(grid_sum[i, j] / grid_n[i, j]), 2) for j in range(cols)]
            for i in range(rows)]
    stats = ({"min_k": float(tb.min()), "mean_k": float(tb.mean()), "max_k": float(tb.max())} if len(tb) else None)
    return {
        "center": {"lat": lat, "lon": lon}, "radius_km": radius_km, "count": int(len(sel)), "evidence": "OBSERVED",
        "status": "HISTORICAL", "unit": "K", "measurement": "THEMIS IR predicted brightness temperature (IR-PBT)",
        "stats": stats,
        "heatmap": {"rows": "local solar time", "row_bin_h": LST_BIN_H, "cols": "solar longitude Ls", "col_bin_deg": LS_BIN_DEG,
                    "mean_k": grid, "counts": grid_n.tolist()},
        "samples": [{"lat": round(float(a), 5), "lon": round(float(b), 5), "tb_k": round(float(c), 2), "product_id": d,
                     "observed": str(e), "ls_deg": round(float(f), 2), "lst_h": round(float(g), 3),
                     "distance_km": round(float(k), 2)}
                    for a, b, c, d, e, f, g, k in sel[["latitude_deg", "longitude_deg", "brightness_temperature_k", "product_id",
                                                        "observation_start", "solar_longitude_deg", "local_solar_time_hours",
                                                        "distance_km"]].head(limit).itertuples(index=False)],
        "caveats": ["Brightness temperature, not physical surface temperature.", "Historical archive, not current weather.",
                    "Samples within the radius are not the exact site pixel."],
        "source": {"ledger_id": "THEMIS"},
    }
