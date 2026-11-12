"""V7 radiation sanity (P1): is the archived RAD dose rate anticorrelated with surface pressure?

Published (Rafkin et al. 2014; Guo et al. 2018): more atmospheric column means less dose. Daily E dose
rate (24 x per-sol median, uGy/day) is paired with the REMS outreach pressure for the same sol. A
negative Spearman rho with a CI below zero reproduces the published sign; anything else is reported as is.
Solar modulation of the GCR flux over the same period also changes the dose, so this is a sanity check only.
"""
from __future__ import annotations

import numpy as np

from science.conditions import rad, rems
from science.validation import stats


def v7() -> dict:
    snap = rad.load_snapshot()
    rad_rates = {int(k): v["median_e_ugy_h"] * 24.0 for k, v in snap.get("sols", {}).items() if v.get("status") == "OK"}
    weather = {s["sol"]: s["pressure_pa"] for s in rems.load_snapshot("msl").get("sols", []) if s.get("pressure_pa")}
    sols = sorted(set(rad_rates) & set(weather))
    if len(sols) < 10:
        return {"status": "INSUFFICIENT DATA", "n": len(sols), "reason": "fewer than 10 sols with both RAD and REMS"}
    dose = np.array([rad_rates[s] for s in sols])
    pressure = np.array([weather[s] for s in sols])
    rho, ci = stats.bootstrap(stats.spearman, dose, pressure)
    slope = float(np.polyfit(pressure, dose, 1)[0])
    reproduced = ci[1] < 0
    return {"n": len(sols), "sols": [sols[0], sols[-1]], "spearman_rho": rho, "spearman_ci95": ci,
            "linear_slope_ugy_day_per_pa": slope, "reproduces_published_sign": bool(reproduced),
            "verdict": "anticorrelation reproduced" if reproduced else "published anticorrelation NOT reproduced in this sample",
            "sources": ["MSL_RAD_RDR", "MSL_REMS_OUTREACH"],
            "caveats": ["REMS values come from the outreach feed (not the PDS science archive).",
                        "Solar modulation over the sampled period also changes the GCR dose.",
                        "One sol in seven over about a Mars year plus the last 30 archived sols."]}
