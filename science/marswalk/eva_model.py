"""Pace, metabolic and consumables screening, time budget and turnaround (Appendix A6, A6b, A7).

MODELED screening proxy: an Earth load-carriage equation scaled to 0.38 g. Suited reduced-gravity
cost is not a simple scaling (Norcross et al., NASA/TP-2010-216125); every metabolic number carries
a +/- metabolic_uncertainty_fraction band. Not flight-rule certified. The Santee et al. downhill
correction is not adopted: downhill grades contribute G = 0.
"""
from __future__ import annotations

import math

import numpy as np

METABOLIC_LABEL = ("MODELED screening proxy: Earth load-carriage equation scaled to 0.38 g; suited "
                   "reduced-gravity cost is not a simple scaling; not flight-rule certified")
TOBLER_K, TOBLER_OFFSET = 3.5, 0.05


def tobler_speed_kmh(theta_deg, pace_kmh: float) -> np.ndarray:
    """A6: v(theta) = pace * exp(-3.5 |tan(theta) + 0.05|) / exp(-0.175); v(0) = pace."""
    t = np.tan(np.radians(np.asarray(theta_deg, dtype="float64")))
    return pace_kmh * np.exp(-TOBLER_K * np.abs(t + TOBLER_OFFSET)) / math.exp(-TOBLER_K * TOBLER_OFFSET)


def step_times_s(ds_m, dz_m, v: dict) -> np.ndarray:
    """Time (s) for each horizontal step ds with height change dz, by the configured pace model."""
    ds = np.asarray(ds_m, dtype="float64")
    dz = np.asarray(dz_m, dtype="float64")
    if v["pace_model"] == "naismith":
        flat = ds / (v["eva_pace_kmh"] / 3.6)
        return flat + np.maximum(dz, 0.0) / (v["ascent_allowance_m_per_h"] / 3600.0)
    theta = np.degrees(np.arctan2(dz, ds))
    speed_ms = tobler_speed_kmh(theta, v["eva_pace_kmh"]) / 3.6
    return ds / speed_ms


def terrain_factor(roughness_m, v: dict) -> np.ndarray:
    """eta from roughness (planning-choice mapping between Pandolf coefficients); base where unknown."""
    r = np.asarray(roughness_m, dtype="float64")
    frac = np.where(np.isfinite(r), np.minimum(r / v["walk_ref_roughness_m"], 1.0), 0.0)
    return v["terrain_factor_base"] + (v["terrain_factor_rough"] - v["terrain_factor_base"]) * frac


def metabolic_rate_w(speed_ms, theta_deg, eta, v: dict) -> np.ndarray:
    """A6b: M = 1.5 W + gamma [2.0 (W+L)(L/W)^2 + eta (W+L)(1.5 V^2 + 0.35 V G)], G = 100 max(tan theta, 0)."""
    W, L = v["body_mass_kg"], v["suit_and_payload_mass_kg"]
    gamma = v["g_mars"] / v["g_earth"]
    V = np.asarray(speed_ms, dtype="float64")
    G = 100.0 * np.maximum(np.tan(np.radians(np.asarray(theta_deg, dtype="float64"))), 0.0)
    return 1.5 * W + gamma * (2.0 * (W + L) * (L / W) ** 2 + np.asarray(eta) * (W + L) * (1.5 * V ** 2 + 0.35 * V * G))


def consumables(energy_j: float, v: dict) -> dict:
    """kcal, O2 (kg) and cooling water (L) for a metabolic energy, with the sensitivity band."""
    kcal = energy_j / 4184.0
    o2_kg = (energy_j / 1000.0 / v["o2_energy_equivalent_kj_per_l"]) * v["o2_density_kg_per_l"]
    water_l = v["heat_rejected_by_water_fraction"] * energy_j / (v["water_latent_heat_mj_per_kg"] * 1e6)
    u = v["metabolic_uncertainty_fraction"]

    def band(x):
        return {"value": x, "low": x * (1 - u), "high": x * (1 + u)}
    return {"metabolic_kcal_est": band(kcal), "o2_kg_est": band(o2_kg), "water_l_est": band(water_l)}


def along_track(ds_m: np.ndarray, dz_m: np.ndarray, roughness_m: np.ndarray, v: dict) -> dict:
    """Outbound and return-leg times and energies per step (return walks the same steps reversed)."""
    t_out = step_times_s(ds_m, dz_m, v)
    t_back = step_times_s(ds_m, -dz_m, v)
    eta = terrain_factor(roughness_m, v)
    theta_out = np.degrees(np.arctan2(dz_m, ds_m))
    m_out = metabolic_rate_w(ds_m / t_out, theta_out, eta, v)
    m_back = metabolic_rate_w(ds_m / t_back, -theta_out, eta, v)
    return {"t_out": t_out, "t_back": t_back, "e_out": m_out * t_out, "e_back": m_back * t_back,
            "m_out": m_out, "eta": eta}


def turnaround(cum_s_m: np.ndarray, t_out: np.ndarray, t_back: np.ndarray, eva_h: float, reserve: float) -> dict:
    """A7: PNR = first s* where t_out(s) + t_back(s) >= (1 - reserve) * T_EVA (walking back the same way).

    cum_s_m has n+1 entries (distance at each sample); t_out/t_back have n step times.
    """
    usable_s = (1.0 - reserve) * eva_h * 3600.0
    out_cum = np.concatenate([[0.0], np.cumsum(t_out)])
    back_cum = np.concatenate([[0.0], np.cumsum(t_back)])  # time to walk from s back to the start
    total = out_cum + back_cum
    over = np.nonzero(total >= usable_s)[0]
    idx = len(total) - 1 if over.size == 0 else int(over[0])
    return {"index": idx, "distance_m": float(cum_s_m[idx]), "reached_target": bool(over.size == 0),
            "usable_s": usable_s, "round_trip_s": float(total[-1]), "outbound_s": float(out_cum[-1]),
            "return_s": float(back_cum[-1])}
