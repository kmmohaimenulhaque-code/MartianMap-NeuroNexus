import { useEffect, useMemo, useRef, useState } from "react";

import { fetchDustMap, fetchDustSeries } from "../services/marsEnvironmentApi";
import NeonHeatmap from "../ui/NeonHeatmap";
import NeonLineChart from "../ui/NeonLineChart";
import { ProvenanceTag } from "../ui/StatTriplet";
import { fmt } from "../ui/format";
import Icon from "../ui/Icon";

/*
 * DUST SCENARIO · NASA Ames MGCM MY34 (MODELED).
 * KPI strip, τ over all 668 sols with backend threshold bands, dust-top
 * sparkline, global τ map for the sol, and a sol scrubber with playback.
 * The scrubber changes the console sol; the chart, map and KPI update
 * instantly from cached data.
 */

const BAND_COLOURS = { low: null, moderate: "#75e6ff", high: "#ffc46b", very_high: "#ff647c" };
const LEVEL_LABEL = { low: "LOW", moderate: "MODERATE", high: "HIGH", very_high: "VERY HIGH" };
const MAX_SOL = 668;

function levelFor(tau, levels) {
  if (!Number.isFinite(tau) || !levels?.length) return null;
  return levels.find((band) => band.max === null || tau < band.max)?.level ?? null;
}

export default function DustScenarioPanel({ location, sol, onSolChange, onSelectCoordinate, fallbackDust, playing, onPlayingChange }) {
  const [series, setSeries] = useState(null);
  const [seriesError, setSeriesError] = useState("");
  const [maps, setMaps] = useState({});
  const [mapError, setMapError] = useState("");
  const [mapExpanded, setMapExpanded] = useState(false);
  const pending = useRef(new Set());

  const lat = location?.latitude_deg;
  const lon = location?.longitude_deg;

  useEffect(() => {
    if (lat === undefined || lon === undefined) return undefined;
    const controller = new AbortController();
    fetchDustSeries(lat, lon, { signal: controller.signal })
      .then((data) => {
        setSeries(data);
        setSeriesError("");
      })
      .catch((error) => {
        if (error.name !== "AbortError") setSeriesError(error.message);
      });
    return () => controller.abort();
  }, [lat, lon]);

  // Global maps are cached per sol; while playing, only every 4th sol is fetched.
  const mapSol = playing ? Math.max(1, sol - ((sol - 1) % 4)) : sol;
  useEffect(() => {
    if (maps[mapSol] || pending.current.has(mapSol)) return;
    pending.current.add(mapSol);
    fetchDustMap(mapSol)
      .then((data) => {
        setMapError("");
        setMaps((current) => {
          const keys = Object.keys(current);
          const next = keys.length > 80 ? {} : { ...current };
          next[mapSol] = data;
          return next;
        });
      })
      .catch((error) => setMapError(error.message))
      .finally(() => pending.current.delete(mapSol));
  }, [mapSol, maps]);

  /* Playback runs in SolProvider so the sol keeps moving in every mode. */

  const levels = series?.levels;
  const tau = series?.tau?.[sol - 1] ?? (Number.isFinite(Number(fallbackDust?.opacity)) ? Number(fallbackDust.opacity) : null);
  const zmax = series?.zmax_km?.[sol - 1] ?? (Number.isFinite(Number(fallbackDust?.height_km)) ? Number(fallbackDust.height_km) : null);
  const ls = series?.ls_deg?.[sol - 1];
  const level = levelFor(tau, levels);
  const filled = series?.filled?.[sol - 1];

  const tauSeries = useMemo(
    () => (series ? [{ id: "tau", label: "τ", colour: "#75e6ff", points: series.sol.map((s, i) => [s, series.tau[i]]) }] : []),
    [series],
  );
  const zSeries = useMemo(
    () => (series ? [{ id: "z", label: "Dust top", colour: "#8cf0b1", width: 1.1, points: series.sol.map((s, i) => [s, series.zmax_km[i]]) }] : []),
    [series],
  );
  const bands = useMemo(
    () => (levels ?? []).filter((b) => BAND_COLOURS[b.level]).map((b) => ({ from: b.min, to: b.max, colour: BAND_COLOURS[b.level], label: b.level })),
    [levels],
  );

  const lsFor = (s) => {
    const value = series?.ls_deg?.[Math.round(s) - 1];
    return Number.isFinite(value) ? `Ls ${value.toFixed(0)}°` : `sol ${Math.round(s)}`;
  };
  const currentMap = maps[mapSol];

  return (
    <div className="dust-panel">
      <div className="dust-head">
        <span>
          {series ? `CELL ${fmt(series.cell.latitude_deg, 1)}° ${fmt(series.cell.longitude_deg, 1)}°E · 3° GRID` : "SELECTED SITE"}
        </span>
        <ProvenanceTag dataClass="MODELED" ledgerId="NASA_AMES_MGCM" source="NASA Ames Mars GCM V3.2 · Montabone et al. (2015) MY34" />
      </div>

      <div className="dust-kpis">
        <div>
          <span>τ SOL {sol}</span>
          <strong className={level ? `dust-level-${level}` : ""}>{fmt(tau, 3) ?? "n/a"}</strong>
          <small>{level ? LEVEL_LABEL[level] : series ? "NO VALUE" : "LOADING"}</small>
        </div>
        <div>
          <span>DUST TOP</span>
          <strong>{fmt(zmax, 1, " km") ?? "n/a"}</strong>
          <small>zmax</small>
        </div>
        <div>
          <span>SEASON</span>
          <strong>{Number.isFinite(ls) ? `${ls.toFixed(1)}°` : "n/a"}</strong>
          <small>Ls{ls >= 180 ? " · DUST SEASON" : ""}</small>
        </div>
      </div>

      {seriesError ? (
        <div className="nn-degraded">DUST TIME SERIES UNAVAILABLE · {seriesError}. Values above come from the site environment.</div>
      ) : (
        <>
          <div className="dust-chart-title">
            <span>OPACITY τ · ALL 668 SOLS OF MY34</span>
            {series && (
              <small>
                MIN {fmt(series.stats.tau.min, 2)} · MEAN {fmt(series.stats.tau.mean, 2)} · MAX {fmt(series.stats.tau.max, 2)}
              </small>
            )}
          </div>
          <NeonLineChart
            series={tauSeries}
            bands={bands}
            cursorX={sol}
            onPick={(x) => onSolChange(Math.round(x))}
            height={118}
            yMin={0}
            formatX={lsFor}
            formatY={(y) => y.toFixed(3)}
            ariaLabel="Modeled dust opacity over Mars Year 34"
          />
          <div className="dust-chart-title">
            <span>DUST-TOP HEIGHT zmax (km)</span>
            {series && (
              <small>
                {fmt(series.stats.zmax_km.min, 0)}–{fmt(series.stats.zmax_km.max, 0)} km
              </small>
            )}
          </div>
          <NeonLineChart series={zSeries} cursorX={sol} onPick={(x) => onSolChange(Math.round(x))} height={56} area={false} formatX={lsFor} formatY={(y) => `${y.toFixed(1)} km`} ariaLabel="Modeled dust-top height" />
        </>
      )}

      <div className="dust-chart-title">
        <span>GLOBAL τ · SOL {mapSol}</span>
        <button type="button" className="nn-link-button" onClick={() => setMapExpanded((v) => !v)}>
          {mapExpanded ? "COMPACT" : "EXPAND"}
        </button>
      </div>
      {mapError && !currentMap ? (
        <div className="nn-degraded">GLOBAL DUST MAP UNAVAILABLE · {mapError}</div>
      ) : (
        <NeonHeatmap
          grid={currentMap?.tau}
          lat={currentMap?.lat}
          lon={currentMap?.lon}
          scaleMax={Math.max(2, currentMap?.range?.max ?? 2)}
          marker={location}
          onPick={onSelectCoordinate}
          height={mapExpanded ? 210 : 116}
          ariaLabel={`Modeled global dust opacity for sol ${mapSol}`}
        />
      )}
      {currentMap && (
        <div className="dust-legend">
          <span className="dust-ramp" />
          <small>
            τ 0 → {fmt(Math.max(2, currentMap.range.max), 1)} (log) · global mean {fmt(currentMap.range.mean, 2)} · click map to select a site
          </small>
        </div>
      )}

      <div className="dust-scrubber">
        <button type="button" onClick={() => onSolChange((s) => Math.max(1, s - 1))} aria-label="Previous sol">
          <Icon name="play" size={14} className="nn-flip" />
        </button>
        <button type="button" onClick={() => onPlayingChange(!playing)} aria-pressed={playing}>
          <Icon name={playing ? "pause" : "play"} size={14} />
        </button>
        <button type="button" onClick={() => onSolChange((s) => Math.min(MAX_SOL, s + 1))} aria-label="Next sol">
          <Icon name="fly" size={14} />
        </button>
        <input
          type="range"
          min={1}
          max={MAX_SOL}
          value={sol}
          onChange={(event) => onSolChange(Number(event.target.value))}
          aria-label="Console sol"
        />
        <strong>
          {sol}/{MAX_SOL}
        </strong>
      </div>

      <div className="nn-footnote">
        {filled ? "This sol's value is gap-filled in the source climatology. " : ""}
        Normalized column dust optical depth reconstructed for Mars Year 34 (2017–2019, including the 2018 global storm). It is MODELED, not a forecast.
      </div>
    </div>
  );
}
