import { useEffect, useState } from "react";

import { fetchTerrainWindow } from "../services/marsEnvironmentApi";
import { ProvenanceTag, StatTable } from "../ui/StatTriplet";
import { fmt } from "../ui/format";

/*
 * SITE MORPHOLOGY · AT SITE (3×3 MOLA sample, from /environment) kept apart
 * from MIN / MEAN / MAX over a selectable MOLA window (/terrain/window).
 * Amber flags use the routing engine's own reference limits.
 */

const WINDOWS_KM = [2, 4, 10, 20];
const STORAGE_KEY = "neuronexus.morphologyWindowKm.v1";
const MAX_WINDOW_LAT = 88;
// Same values as science/routing/metrics.py REFERENCES (risk_max_slope_deg, risk_max_roughness_m).
const RISK_SLOPE_DEG = 30;
const RISK_ROUGHNESS_M = 100;

function readWindow() {
  try {
    const value = Number(localStorage.getItem(STORAGE_KEY));
    return WINDOWS_KM.includes(value) ? value : 4;
  } catch {
    return 4;
  }
}

export default function SiteMorphologyPanel({ location, terrain }) {
  const [windowKm, setWindowKm] = useState(readWindow);
  const [result, setResult] = useState({ key: null, stats: null, error: "" });

  const lat = location?.latitude_deg;
  const lon = location?.longitude_deg;
  const polar = Number.isFinite(lat) && Math.abs(lat) > MAX_WINDOW_LAT;
  const requestKey = lat === undefined || lon === undefined || polar ? null : `${lat},${lon},${windowKm}`;
  const current = result.key === requestKey ? result : null;
  const stats = current?.stats ?? null;
  const error = current?.error ?? "";
  const status = !requestKey ? "idle" : !current ? "loading" : error ? "error" : "ok";

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, String(windowKm));
    } catch {
      // Remembering the window is optional.
    }
  }, [windowKm]);

  useEffect(() => {
    if (!requestKey) return undefined;
    const controller = new AbortController();
    fetchTerrainWindow(lat, lon, windowKm, { signal: controller.signal })
      .then((response) => setResult({ key: requestKey, stats: response.summary, error: "" }))
      .catch((err) => {
        if (err.name !== "AbortError") setResult({ key: requestKey, stats: null, error: err.message });
      });
    return () => controller.abort();
  }, [requestKey, lat, lon, windowKm]);

  const elevation = stats?.elevation_m ?? {};
  const slope = stats?.slope_deg ?? {};
  const roughness = stats?.roughness_m ?? {};

  const rows = [
    {
      label: "ELEVATION",
      unit: "m",
      digits: 0,
      values: [terrain?.elevation_m, elevation.min ?? terrain?.local_elevation_min_m, elevation.mean, elevation.max ?? terrain?.local_elevation_max_m],
    },
    {
      label: "SLOPE",
      unit: "°",
      digits: 1,
      values: [terrain?.slope_deg, slope.min, slope.mean, slope.max],
      flags: [terrain?.slope_deg > RISK_SLOPE_DEG && "amber", null, null, slope.max > RISK_SLOPE_DEG && "amber"],
    },
    {
      label: "ROUGHNESS",
      unit: "m",
      digits: 1,
      values: [terrain?.roughness_m, roughness.min, roughness.mean, roughness.max],
      flags: [terrain?.roughness_m > RISK_ROUGHNESS_M && "amber", null, null, roughness.max > RISK_ROUGHNESS_M && "amber"],
    },
  ];

  let basis;
  if (polar) basis = "POLAR: window statistics need |lat| ≤ 88°, so MIN/MAX elevation are from the 3×3 site sample.";
  else if (status === "loading") basis = `Computing ${windowKm}×${windowKm} km MOLA window…`;
  else if (status === "error") basis = `WINDOW STATISTICS UNAVAILABLE · ${error}`;
  else if (stats) basis = `${windowKm}×${windowKm} km window · ${stats.valid_pixels?.toLocaleString()}/${stats.total_pixels?.toLocaleString()} valid px · slope p90 ${fmt(slope.p90, 1, "°") ?? "n/a"}`;

  return (
    <div className="morph-panel">
      <div className="morph-head">
        <div className="morph-windows" role="group" aria-label="Statistics window">
          {WINDOWS_KM.map((km) => (
            <button key={km} type="button" className={km === windowKm ? "active" : ""} aria-pressed={km === windowKm} onClick={() => setWindowKm(km)} disabled={polar}>
              {km} km
            </button>
          ))}
        </div>
        <ProvenanceTag dataClass="DERIVED" ledgerId="MOLA_MEGDR" source="NASA MOLA MEGDR 128 px/deg" />
      </div>

      <StatTable rows={rows} basis={basis} missingReason={status === "error" ? error : "not available"} />

      <div className="morph-aspect">
        <span>ASPECT</span>
        <strong>{fmt(terrain?.aspect_deg, 1, "°") ?? "n/a"}</strong>
        <small>at site only (circular quantity, no mean)</small>
      </div>

      <div className="source-note">
        <span>DATA LINK</span>
        <strong>{terrain?.source ?? "NASA MOLA MEGDR"} · 128 PX / DEG</strong>
      </div>
      {(slope.max > RISK_SLOPE_DEG || roughness.max > RISK_ROUGHNESS_M) && (
        <div className="nn-footnote nn-flag-amber-text">
          Amber marks values above the route engine's risk references ({RISK_SLOPE_DEG}° slope, {RISK_ROUGHNESS_M} m roughness). These are planning aids, not safety limits.
        </div>
      )}
    </div>
  );
}
