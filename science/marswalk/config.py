"""Every Marswalk limit, weight, pace and metabolic parameter, in one place.

Each entry: {value, unit, kind, citation, ledger_id, note}. ``kind`` is "published" only when
the value itself comes from the cited source; otherwise it is a "planning choice" (Appendix E4).
Planning limits are NOT safety limits. The frontend never invents thresholds; it reads these.
"""
from __future__ import annotations

import copy
import hashlib
import json

from science.constants import G_EARTH_M_S2, G_MARS_M_S2

PLANNING = "planning choice"
PUBLISHED = "published"
METHOD = "NEURONEXUS_MARSWALK_PARAMETERS"

PARAMETERS: dict[str, dict] = {
    "eva_pace_kmh": {"value": 2.5, "unit": "km/h", "kind": PLANNING, "citation": None,
                     "ledger_id": METHOD, "note": "Flat-ground pace; kept from Mission Console v2 for continuity."},
    "ascent_allowance_m_per_h": {"value": 600.0, "unit": "m/h", "kind": PLANNING, "citation": None,
                                 "ledger_id": METHOD, "note": "Naismith option only; kept for continuity."},
    "pace_model": {"value": "tobler", "unit": "", "kind": PLANNING, "citation": "Tobler (1993); Naismith (1892)",
                   "ledger_id": "NEURONEXUS_PACE_MODEL", "note": "tobler | naismith"},
    "slope_review_deg": {"value": 15.0, "unit": "deg", "kind": PLANNING, "citation": None, "ledger_id": METHOD,
                         "note": "At a 3 m baseline. Above this a segment needs crew review."},
    "slope_limit_deg": {"value": 25.0, "unit": "deg", "kind": PLANNING, "citation": None, "ledger_id": METHOD,
                        "note": "At a 3 m baseline. Above this a cell is impassable for the planner."},
    "roughness_review_m": {"value": 0.3, "unit": "m", "kind": PLANNING, "citation": None, "ledger_id": METHOD,
                           "note": "Detrended RMS height over a 5 m window (HiRISE rung only)."},
    "walk_weight_slope": {"value": 0.7, "unit": "", "kind": PLANNING, "citation": None, "ledger_id": METHOD,
                          "note": "Weight of slope_3m / slope_limit in the walkability cost (A5)."},
    "walk_weight_roughness": {"value": 0.3, "unit": "", "kind": PLANNING, "citation": None, "ledger_id": METHOD,
                              "note": "Weight of roughness_5m / walk_ref_roughness_m in the cost (A5)."},
    "walk_ref_roughness_m": {"value": 0.5, "unit": "m", "kind": PLANNING, "citation": None, "ledger_id": METHOD,
                             "note": "Roughness that saturates its walkability term."},
    "eva_duration_h": {"value": 4.0, "unit": "h", "kind": PLANNING, "citation": None, "ledger_id": METHOD,
                       "note": "4 or 8 hours in the UI."},
    "reserve_fraction": {"value": 0.3, "unit": "", "kind": PLANNING, "citation": None, "ledger_id": METHOD,
                         "note": "Share of the EVA kept in reserve; drives the turnaround point (A7)."},
    "body_mass_kg": {"value": 80.0, "unit": "kg", "kind": PLANNING, "citation": None, "ledger_id": METHOD,
                     "note": "Crew member body mass W."},
    "suit_and_payload_mass_kg": {"value": 65.0, "unit": "kg", "kind": PLANNING, "citation": None,
                                 "ledger_id": METHOD, "note": "Suit + carried load L."},
    "terrain_factor_base": {"value": 1.0, "unit": "", "kind": PUBLISHED,
                            "citation": "Pandolf, Givoni & Goldman (1977), J. Appl. Physiol. 43:577; eta = 1.0 "
                                        "for blacktop or treadmill", "ledger_id": "NEURONEXUS_METABOLIC_PROXY",
                            "note": "eta for smooth, firm ground."},
    "terrain_factor_rough": {"value": 1.2, "unit": "", "kind": PUBLISHED,
                             "citation": "Terrain factors used with Pandolf et al. (1977), compiled from Soule & "
                                         "Goldman (1972), J. Appl. Physiol. 32:706: 1.0 blacktop, 1.1 dirt road, "
                                         "1.2 light brush, 1.5 heavy brush, 1.8 swampy bog, 2.1 loose sand", "ledger_id": "NEURONEXUS_METABOLIC_PROXY",
                             "note": "eta reached at roughness >= walk_ref_roughness_m. The roughness-to-eta mapping "
                                     "is a planning choice."},
    "heat_rejected_by_water_fraction": {"value": 0.5, "unit": "", "kind": PLANNING, "citation": None,
                                        "ledger_id": "NEURONEXUS_METABOLIC_PROXY",
                                        "note": "f_rej: share of metabolic heat removed by evaporating water."},
    "metabolic_uncertainty_fraction": {"value": 0.3, "unit": "", "kind": PLANNING,
                                       "citation": "Norcross et al., NASA/TP-2010-216125 (NTRS 20110003409): suited "
                                                   "reduced-gravity cost does not follow simple gravity scaling",
                                       "ledger_id": "NEURONEXUS_METABOLIC_PROXY",
                                       "note": "Half-width of the sensitivity band shown on kcal, O2 and water."},
    "g_mars": {"value": G_MARS_M_S2, "unit": "m/s2", "kind": PUBLISHED, "citation": "NASA Mars Fact Sheet",
               "ledger_id": "NEURONEXUS_METABOLIC_PROXY", "note": "Surface gravity."},
    "g_earth": {"value": G_EARTH_M_S2, "unit": "m/s2", "kind": PUBLISHED, "citation": "standard gravity (rounded)",
                "ledger_id": "NEURONEXUS_METABOLIC_PROXY", "note": ""},
    "o2_energy_equivalent_kj_per_l": {"value": 20.1, "unit": "kJ/L", "kind": PUBLISHED,
                                      "citation": "Indirect-calorimetry energy equivalent of O2 (about 20.1 kJ/L at "
                                                  "RQ 0.85)", "ledger_id": "NEURONEXUS_METABOLIC_PROXY", "note": ""},
    "o2_density_kg_per_l": {"value": 1.429e-3, "unit": "kg/L", "kind": PUBLISHED, "citation": "O2 at STP",
                            "ledger_id": "NEURONEXUS_METABOLIC_PROXY", "note": ""},
    "water_latent_heat_mj_per_kg": {"value": 2.45, "unit": "MJ/kg", "kind": PUBLISHED,
                                    "citation": "latent heat of vaporization of water near 20 C",
                                    "ledger_id": "NEURONEXUS_METABOLIC_PROXY", "note": ""},
}

LIMITS_FOR_UI = ("slope_review_deg", "slope_limit_deg", "roughness_review_m", "reserve_fraction")
OVERRIDABLE = {k for k, v in PARAMETERS.items() if isinstance(v["value"], (int, float))} | {"pace_model"}
BOUNDS = {
    "eva_pace_kmh": (0.5, 6.0), "ascent_allowance_m_per_h": (100.0, 2000.0), "slope_review_deg": (1.0, 45.0),
    "slope_limit_deg": (2.0, 60.0), "roughness_review_m": (0.01, 5.0), "eva_duration_h": (0.5, 12.0),
    "reserve_fraction": (0.0, 0.8), "body_mass_kg": (40.0, 150.0), "suit_and_payload_mass_kg": (0.0, 200.0),
    "walk_weight_slope": (0.0, 1.0), "walk_weight_roughness": (0.0, 1.0), "walk_ref_roughness_m": (0.05, 5.0),
    "terrain_factor_base": (1.0, 3.0), "terrain_factor_rough": (1.0, 3.0),
    "heat_rejected_by_water_fraction": (0.0, 1.0), "metabolic_uncertainty_fraction": (0.0, 1.0),
}


def resolve(overrides: dict | None = None) -> dict[str, dict]:
    """Parameters with validated overrides applied (overridden entries become planning choices)."""
    params = copy.deepcopy(PARAMETERS)
    for key, value in (overrides or {}).items():
        if key not in OVERRIDABLE:
            raise ValueError(f"unknown or fixed parameter: {key}")
        if key == "pace_model":
            if value not in ("tobler", "naismith"):
                raise ValueError("pace_model must be 'tobler' or 'naismith'")
        else:
            value = float(value)
            lo, hi = BOUNDS.get(key, (float("-inf"), float("inf")))
            if not lo <= value <= hi:
                raise ValueError(f"{key}={value} outside [{lo}, {hi}]")
        params[key]["value"] = value
        params[key]["kind"] = PLANNING if params[key]["value"] != PARAMETERS[key]["value"] else params[key]["kind"]
    if params["slope_review_deg"]["value"] > params["slope_limit_deg"]["value"]:
        raise ValueError("slope_review_deg must not exceed slope_limit_deg")
    return params


def values(params: dict[str, dict]) -> dict[str, float | str]:
    return {k: v["value"] for k, v in params.items()}


def config_hash(params: dict[str, dict]) -> str:
    return hashlib.sha256(json.dumps(values(params), sort_keys=True).encode()).hexdigest()[:16]


def status_rule_text(v: dict) -> str:
    return (f"EXCEEDS PLANNING LIMIT if any cell has slope at a 3 m baseline > {v['slope_limit_deg']:g} deg, or the "
            f"target lies beyond the turnaround point. REVIEW REQUIRED if any segment has slope > "
            f"{v['slope_review_deg']:g} deg or roughness (5 m) > {v['roughness_review_m']:g} m, or any part of the "
            "route relies on CTX/MOLA (coarser than 1 m) or has unavailable terrain. Otherwise WITHIN PLANNING "
            "LIMITS. Planning limits are not safety limits.")
