"""Solar geometry and dust screening for a site and season (Ls).

Declination from Allison & McEwen (2000), Planet. Space Sci. 48: sin(dec) = sin(25.19 deg) sin(Ls).
Noon elevation, day length and the direct-beam transmittance exp(-tau / mu) at noon are geometry,
not a radiative-transfer model; dust classes reuse the console's DUST_LEVELS bands.
"""
from __future__ import annotations

import math

from science.weather.models.environment_assessment import classify_dust

OBLIQUITY_DEG = 25.19
# Screening map from the console's dust bands to the EVA limit classes (never a safety statement).
DUST_CLASS = {"low": "WITHIN", "moderate": "WITHIN", "high": "REVIEW", "very_high": "EXCEED"}


def declination_deg(ls_deg: float) -> float:
    return math.degrees(math.asin(math.sin(math.radians(OBLIQUITY_DEG)) * math.sin(math.radians(ls_deg))))


def solar(lat_deg: float, ls_deg: float, tau: float | None = None) -> dict:
    dec = declination_deg(ls_deg)
    noon_elev = 90.0 - abs(lat_deg - dec)
    x = -math.tan(math.radians(lat_deg)) * math.tan(math.radians(dec))
    day_h = 24.0 if x <= -1 else 0.0 if x >= 1 else 24.0 * math.degrees(math.acos(x)) / 180.0
    out = {"ls_deg": round(ls_deg, 2), "declination_deg": round(dec, 2), "noon_elevation_deg": round(noon_elev, 2),
           "daylight_h": round(day_h, 2), "evidence": "DERIVED", "ledger_id": "NEURONEXUS_SOLAR_GEOMETRY",
           "basis": "Allison & McEwen (2000) declination; hours are Mars local hours (1/24 sol)"}
    if tau is not None and noon_elev > 0:
        mu = math.sin(math.radians(noon_elev))
        out["noon_direct_beam_fraction"] = round(math.exp(-tau / mu), 3)
    if tau is not None:
        level = classify_dust(tau)
        out["dust_level"] = level
        out["dust_class"] = DUST_CLASS.get(level, "REVIEW")
    return out
