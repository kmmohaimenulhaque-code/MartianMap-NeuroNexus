/*
 * MARSWALK mode: meter-scale EVA planning on the terrain ladder.
 *   LEFT  EVA setup (site, base, targets, duration, parameter sliders with their kind, terrain mode)
 *   CENTER SiteMap (local metric frame) · BOTTOM ProfileStrip · RIGHT decision, conditions, validation, stops
 * The deterministic backend is authoritative; while a request runs the browser shows its own estimate.
 */

import { SheetHead } from "../components/mobile/MobileDock";
import { encodePlanLink } from "./planLink";
import SeasonRibbon from "./SeasonRibbon";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import SourceTag from "../sources/SourceTag";
import ConditionsStrip from "./ConditionsStrip";
import DecisionCard from "./DecisionCard";
import { openPrintableBrief } from "./evaBrief";
import { exportEvaBrief, exportGeoJson, exportProfileCsv } from "../exports/actions";
import { planStore } from "./planStore";
import { marswalkApi } from "./marswalkApi";
import { perfStore } from "../perf/perfStore";
import { useSol } from "../state/solStore";
import { runMath, setGrids } from "../perf/workerClient";
import { displayGrid, toLocal } from "./marswalkMath";
import ProfileStrip from "./ProfileStrip";
import SiteMap from "./SiteMap";
import TerrainLadder from "./TerrainLadder";
import ValidationPanel from "./ValidationPanel";
import "./marswalk.css";

const SITES = {
  gale: { label: "Gale Crater", rover: "msl", roverName: "Curiosity" },
  jezero: { label: "Jezero Crater (out-of-sample)", rover: "m2020", roverName: "Perseverance" },
};
const FRAME_HALF_WIDTH_M = 1500;
const FRAME_RES_M = 2;
const SLIDERS = [
  ["eva_pace_kmh", "Flat pace", 0.1],
  ["slope_review_deg", "Review slope @3 m", 1],
  ["slope_limit_deg", "Slope limit @3 m", 1],
  ["reserve_fraction", "Reserve fraction", 0.05],
  ["body_mass_kg", "Body mass", 1],
  ["suit_and_payload_mass_kg", "Suit + payload", 1],
  ["terrain_factor_rough", "Terrain factor (rough)", 0.1],
];
const round6 = (v) => Math.round(v * 1e6) / 1e6;

function readPref(key, fallback) {
  try {
    return window.localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

function writePref(key, value) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Private mode or blocked storage: the preference is simply not remembered.
  }
}

/* Map limitation note. On phones it is one line with [i] to expand and × to dismiss; on wider screens it shows in full. */
function MwNote({ text }) {
  const [open, setOpen] = useState(false);
  const [hidden, setHidden] = useState(false);
  if (hidden) return null;
  return (
    <div className={`mw-note${open ? " is-open" : ""}`} data-testid="mw-note">
      <button type="button" className="mw-note-i" aria-expanded={open} aria-label="Show the full map limitation" onClick={() => setOpen((v) => !v)}>
        i
      </button>
      <span className="mw-note-text">{text}</span>
      <button type="button" className="mw-note-x" aria-label="Dismiss the map limitation note" onClick={() => setHidden(true)}>
        ×
      </button>
    </div>
  );
}

export default function MarswalkView({ demo, onNotice }) {
  const [site, setSite] = useState(() => (demo?.site ?? readPref("nn.marswalk.site", "gale")));
  const [config, setConfig] = useState(null);
  const [overrides, setOverrides] = useState(() => demo?.overrides ?? {});
  const [evaHours, setEvaHours] = useState(demo?.evaHours ?? 4);
  const [mode, setMode] = useState(demo?.mode ?? "ladder");
  const [base, setBase] = useState(null);
  const [targets, setTargets] = useState(demo?.targets ?? []);
  const [plan, setPlan] = useState(null);
  const [planState, setPlanState] = useState({ loading: false, error: "" });
  const [estimate, setEstimate] = useState(null);
  const [windowResult, setWindowResult] = useState({ key: "", data: null, error: "" });
  const [overlays, setOverlays] = useState({ hillshade: true, ortho: false, walkability: true, slope: false, source: false });
  const [groundTruth, setGroundTruth] = useState(Boolean(demo?.groundTruth));
  const [rover, setRover] = useState(null);
  const [conditions, setConditions] = useState(null);
  const solCtx = useSol();
  const { missionSol } = solCtx;
  const [hoverIndex, setHoverIndex] = useState(null);
  const [linkCheck, setLinkCheck] = useState(null); // shared link: { shared, now } once the replanned id is known
  const planAbort = useRef(null);
  const autoPlanned = useRef(false);
  const estimateSeq = useRef(0);
  const dragTimer = useRef(null);

  useEffect(() => writePref("nn.marswalk.site", site), [site]);

  useEffect(() => {
    if (demo?.sol) solCtx.setSol(demo.sol);
    // Only when a shared link (or demo) mounts this view.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [demo]);

  const copyPlanLink = () => {
    const hash = encodePlanLink({ site, targets, evaHours, mode, overrides, sol: solCtx.sol, planId: plan?.plan_id });
    const url = `${window.location.origin}${window.location.pathname}${window.location.search}${hash}`;
    try {
      window.history.replaceState(null, "", hash);
    } catch {
      // History API blocked (sandboxed frame): the URL is still shown below.
    }
    const done = () => onNotice?.(`Plan link copied. Opening it replans this request and checks plan_id ${plan?.plan_id ?? ""}.`);
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(url).then(done, () => onNotice?.(`Plan link: ${url}`));
    else onNotice?.(`Plan link: ${url}`);
  };

  useEffect(() => {
    marswalkApi.config().then(setConfig).catch((error) => onNotice?.(`Marswalk config unavailable: ${error.message}`));
  }, [onNotice]);

  const changeSite = (next) => {
    setSite(next);
    setBase(null);
    setPlan(null);
    setEstimate(null);
    setTargets([]);
  };

  useEffect(() => {
    const controller = new AbortController();
    marswalkApi
      .roverLatest(SITES[site].rover, { signal: controller.signal })
      .then((data) => setBase({ lat: data.latest.lat, lon: data.latest.lon, label: `${data.name} sol ${data.latest.sol} (stand-in habitat)`, origin: data.source?.origin, retrieved: data.source?.retrieved_at }))
      .catch((error) => error.name !== "AbortError" && setPlanState({ loading: false, error: `rover position unavailable: ${error.message}` }));
    return () => controller.abort();
  }, [site]);

  const frame = useMemo(() => (base ? { lat: round6(base.lat), lon: round6(base.lon), halfWidth: FRAME_HALF_WIDTH_M, res: FRAME_RES_M } : null), [base]);

  const windowKey = frame ? `${frame.lat},${frame.lon},${mode}` : "";
  useEffect(() => {
    if (!frame) return undefined;
    const controller = new AbortController();
    const key = `${frame.lat},${frame.lon},${mode}`;
    marswalkApi
      .window(frame, mode, "elevation,slope_3m,walk_class,source", 300, { signal: controller.signal })
      .then((data) => setWindowResult({ key, data, error: "" }))
      .catch((error) => error.name !== "AbortError" && setWindowResult({ key, data: null, error: error.message }));
    return () => controller.abort();
  }, [frame, mode]);
  const windowJson = windowResult.key === windowKey ? windowResult.data : null;
  const windowState = { loading: Boolean(frame) && windowResult.key !== windowKey, error: windowResult.key === windowKey ? windowResult.error : "" };

  useEffect(() => {
    if (!groundTruth) return undefined;
    const controller = new AbortController();
    const id = SITES[site].rover;
    Promise.all([marswalkApi.roverTraverse(id, 4000, { signal: controller.signal }), marswalkApi.roverWaypoints(id, { signal: controller.signal })])
      .then(([trav, wps]) => setRover({ id, name: SITES[site].roverName, traverse: trav.geometry.coordinates, waypoints: wps.waypoints, source: trav.source }))
      .catch((error) => error.name !== "AbortError" && onNotice?.(`Rover ground truth unavailable: ${error.message}`));
    return () => controller.abort();
  }, [groundTruth, site, onNotice]);

  const grids = useMemo(() => {
    if (!windowJson) return null;
    return {
      elevation: displayGrid(windowJson, "elevation"),
      slope_3m: displayGrid(windowJson, "slope_3m"),
      walk_class: displayGrid(windowJson, "walk_class"),
      source: displayGrid(windowJson, "source"),
    };
  }, [windowJson]);

  const values = useMemo(() => {
    if (!config) return null;
    const v = Object.fromEntries(Object.entries(config.parameters).map(([k, p]) => [k, p.value]));
    return { ...v, ...overrides, eva_duration_h: evaHours };
  }, [config, overrides, evaHours]);

  useEffect(() => {
    if (grids?.elevation) setGrids(windowKey, grids);
  }, [grids, windowKey]);

  /* Browser estimate (worker when enabled, identical math on the main thread otherwise). */
  const requestEstimate = useCallback(
    (pts) => {
      const seq = ++estimateSeq.current;
      if (!grids?.elevation || !values || !frame || pts.length < 2) {
        setEstimate(null);
        return;
      }
      const local = pts.map((p) => toLocal(p.lat, p.lon, frame));
      runMath("track", { gridsKey: windowKey, grids, localPts: local, step: windowJson.display_grid.step_m, v: values })
        .then((result) => seq === estimateSeq.current && setEstimate(result))
        .catch(() => seq === estimateSeq.current && setEstimate(null));
    },
    [grids, values, frame, windowJson, windowKey],
  );

  const runPlan = useCallback(
    (nextTargets = targets, kind = "plan") => {
      if (!base || nextTargets.length === 0) return Promise.resolve(null);
      autoPlanned.current = true; // later EVA-length or terrain-mode changes replan this route
      planAbort.current?.abort();
      const controller = new AbortController();
      planAbort.current = controller;
      const pts = [base, ...nextTargets];
      requestEstimate(pts);
      setPlanState({ loading: true, error: "" });
      const shared = { eva_hours: evaHours, terrain_mode: mode, overrides };
      const call =
        kind === "straight"
          ? marswalkApi.evaluate({ ...shared, polyline: pts.map((p) => [round6(p.lat), round6(p.lon)]) }, { signal: controller.signal })
          : marswalkApi.plan({ ...shared, site, base: { rover: SITES[site].rover }, targets: nextTargets.map((t) => ({ lat: round6(t.lat), lon: round6(t.lon) })) }, { signal: controller.signal });
      return call
        .then((result) => {
          setPlan(result);
          setEstimate(null);
          setPlanState({ loading: false, error: "" });
          return result;
        })
        .catch((error) => {
          if (error.name === "AbortError") return null;
          setPlan(null);
          setPlanState({ loading: false, error: error.hint ? `${error.message} (${error.hint})` : error.message });
          return null;
        });
    },
    [base, targets, evaHours, mode, overrides, site, requestEstimate],
  );

  useEffect(() => {
    if (demo && base && config && !autoPlanned.current && targets.length) {
      autoPlanned.current = true;
      runPlan(targets).then((result) => result && demo.sharedPlanId && setLinkCheck({ shared: demo.sharedPlanId, now: result.plan_id }));
    }
  }, [demo, base, config, targets, runPlan]);

  const onMapClick = useCallback(
    (point) => {
      const next = [{ lat: point.lat, lon: point.lon }];
      setTargets(next);
      setPlan(null);
      requestEstimate(base ? [base, ...next] : []);
    },
    [base, requestEstimate],
  );

  const onDragPoint = useCallback(
    (index, point) => {
      const next = targets.map((t, i) => (i === index - 1 ? point : t));
      setTargets(next);
      if (base) requestEstimate([base, ...next]);
      // Debounced replan; a newer drag cancels the stale request (AbortController in runPlan).
      clearTimeout(dragTimer.current);
      dragTimer.current = setTimeout(() => runPlan(next), perfStore.enabled("debounceDrags") ? 250 : 0);
    },
    [targets, runPlan, base, requestEstimate],
  );

  const changeMode = (next) => {
    setMode(next);
    setPlan(null);
  };
  useEffect(() => {
    if (targets.length && base && autoPlanned.current) runPlan(targets);
    // Replan when the terrain mode or EVA length changes after a first plan (the old plan is cleared, never shown as current).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, evaHours]);

  useEffect(() => planStore.set({ plan, conditions, site }), [plan, conditions, site]);

  /* Requests from the Radial Feature Wheel / Command Index (ladder mode, overlay, site, scroll, verify). */
  useEffect(() => {
    const apply = () => {
      const req = planStore.get().pending;
      if (!req) return;
      planStore.set({ pending: null });
      if (req.type === "mode") changeMode(req.value);
      if (req.type === "overlay") setOverlays((o) => ({ ...o, [req.value]: true }));
      if (req.type === "site" && req.value !== site) changeSite(req.value);
      if (req.type === "verify") {
        if (!targets.length || !base) onNotice?.("Plan a Marswalk first, then VERIFY PLAN re-runs it.");
        else {
          const before = plan?.plan_id ?? null;
          onNotice?.(`VERIFY: re-running plan ${before ?? "(none yet)"} with the same request…`);
          runPlan(targets).then((result) => {
            if (!result) return;
            if (!before) onNotice?.(`VERIFY: first plan_id is ${result.plan_id}; run VERIFY again to compare.`);
            else if (result.plan_id === before) onNotice?.(`VERIFY PASSED: plan_id ${result.plan_id} reproduced exactly (same request and data versions, V5).`);
            else onNotice?.(`VERIFY MISMATCH: plan_id was ${before}, now ${result.plan_id}. The request or a data version changed; compare the two briefs.`);
          });
        }
      }
      if (req.scroll) setTimeout(() => document.getElementById(req.scroll)?.scrollIntoView({ behavior: "smooth", block: "start" }), 400);
    };
    apply();
    return planStore.subscribe(apply);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [site, targets, base, plan]);

  const runExport = async (fn) => {
    try {
      onNotice?.(await fn(solCtx));
    } catch (error) {
      onNotice?.(error.message);
    }
  };

  const products = windowJson?.products;
  const params = config?.parameters ?? {};
  return (
    <div className="mw-shell">
      <aside className="mw-left" aria-label="EVA setup">
        <SheetHead title="EVA SETUP" />
        <section className="mw-card">
          <h3>EVA SETUP</h3>
          <label className="mw-field">
            <span>Site</span>
            <select value={site} onChange={(e) => changeSite(e.target.value)}>
              {Object.entries(SITES).map(([key, s]) => (
                <option key={key} value={key}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
          <div className="mw-field">
            <span>Base</span>
            <strong>{base ? base.label : "locating rover…"}</strong>
            <SourceTag ledgerId={site === "gale" ? "MMGIS_MSL_WAYPOINTS" : "MMGIS_M2020_WAYPOINTS"} detail={base?.origin === "snapshot" ? "offline snapshot" : base?.retrieved} compact />
          </div>
          <div className="mw-field">
            <span>Target</span>
            {targets.length ? (
              targets.map((t, i) => (
                <strong key={i}>
                  {t.lat.toFixed(5)}°, {t.lon.toFixed(5)}°E{" "}
                  <button type="button" className="mw-link" onClick={() => { setTargets([]); setPlan(null); setEstimate(null); }}>
                    clear
                  </button>
                </strong>
              ))
            ) : (
              <em className="mw-dim">click the map</em>
            )}
          </div>
          <div className="mw-field" role="radiogroup" aria-label="EVA duration">
            <span>EVA duration</span>
            <div className="mw-mode">
              {[4, 8].map((h) => (
                <button key={h} type="button" role="radio" aria-checked={evaHours === h} className={evaHours === h ? "active" : undefined} onClick={() => {
                  if (h === evaHours) return;
                  setPlan(null);
                  setEvaHours(h);
                }}>
                  {h} h
                </button>
              ))}
            </div>
          </div>
          <TerrainLadder mode={mode} onMode={changeMode} products={products} fractions={windowJson?.source_fractions} />
          <div className="mw-actions">
            <button type="button" className="mw-primary" disabled={!base || !targets.length || planState.loading} onClick={() => runPlan(targets)}>
              {planState.loading ? "PLANNING…" : "PLAN"}
            </button>
            <button type="button" disabled={!base || !targets.length} onClick={() => runPlan(targets, "straight")} title="Evaluate the straight line instead of searching">
              CHECK STRAIGHT LINE
            </button>
            <button type="button" disabled={!plan?.plan_id} onClick={() => runExport(exportEvaBrief)}>
              EXPORT BRIEF (JSON)
            </button>
            <button type="button" disabled={!plan?.plan_id} onClick={() => runExport(exportGeoJson)}>
              EXPORT GEOJSON
            </button>
            <button type="button" disabled={!plan?.plan_id} onClick={() => runExport(exportProfileCsv)}>
              EXPORT CSV PROFILE
            </button>
            <button type="button" disabled={!plan?.plan_id} onClick={copyPlanLink} title="Copy a link that replans this exact request and checks the plan_id">
              COPY PLAN LINK
            </button>
            <button type="button" disabled={!plan?.plan_id} onClick={() => openPrintableBrief(plan.plan_id)}>
              PRINT BRIEF
            </button>
          </div>
        </section>
        <section className="mw-card">
          <h3>
            PARAMETERS <SourceTag ledgerId="NEURONEXUS_MARSWALK_PARAMETERS" compact />
          </h3>
          {SLIDERS.map(([key, label, step]) => {
            const p = params[key];
            if (!p) return null;
            const [lo, hi] = config.bounds[key] ?? [0, 100];
            const value = overrides[key] ?? p.value;
            return (
              <label className="mw-slider" key={key}>
                <span>
                  {label} <b>{Number(value).toFixed(step < 1 ? 2 : 0)} {p.unit}</b>
                  <em className={`mw-kind mw-kind--${p.kind === "published" ? "pub" : "plan"}`} title={p.citation ?? p.note}>
                    {p.kind}
                  </em>
                </span>
                <input type="range" min={lo} max={hi} step={step} value={value} onChange={(e) => setOverrides({ ...overrides, [key]: Number(e.target.value) })} aria-label={label} />
              </label>
            );
          })}
          <label className="mw-field">
            <span>Pace model</span>
            <select value={overrides.pace_model ?? params.pace_model?.value ?? "tobler"} onChange={(e) => setOverrides({ ...overrides, pace_model: e.target.value })}>
              <option value="tobler">Tobler (normalized)</option>
              <option value="naismith">Naismith</option>
            </select>
          </label>
          <button type="button" className="mw-link" onClick={() => setOverrides({})}>
            reset to defaults
          </button>
          <p className="mw-dim">Changing a parameter changes the plan id; press PLAN to apply. Planning limits are not safety limits.</p>
        </section>
        <section className="mw-card">
          <h3>MAP LAYERS</h3>
          {[
            ["hillshade", "Hillshade (ladder DTM)", "NEURONEXUS_TERRAIN_LADDER"],
            ["ortho", "HiRISE orthoimage", "HIRISE_STAC_ORTHO"],
            ["walkability", "Walkability + EXCEED hatching", "NEURONEXUS_WALKABILITY"],
            ["slope", "Slope @3 m", "NEURONEXUS_SLOPE_MULTI_BASELINE"],
            ["source", "Terrain source raster", "NEURONEXUS_TERRAIN_LADDER"],
          ].map(([key, label, ledgerId]) => (
            <label className="mw-check" key={key}>
              <input type="checkbox" checked={overlays[key]} onChange={(e) => setOverlays({ ...overlays, [key]: e.target.checked })} />
              {label} <SourceTag ledgerId={ledgerId} compact />
            </label>
          ))}
          <label className="mw-check">
            <input type="checkbox" checked={groundTruth} onChange={(e) => setGroundTruth(e.target.checked)} />
            GROUND TRUTH · {SITES[site].roverName} drives <SourceTag ledgerId={site === "gale" ? "MMGIS_MSL_TRAVERSE" : "MMGIS_M2020_TRAVERSE"} compact />
          </label>
        </section>
      </aside>
      <section className="mw-center" aria-label="Site map">
        {windowState.loading && <div className="mw-banner">Reading the terrain ladder for this 3 × 3 km frame…</div>}
        {windowState.error && <div className="mw-banner mw-banner--error">Terrain window UNAVAILABLE · {windowState.error}</div>}
        {frame ? (
          <SiteMap
            frame={frame}
            mode={mode}
            overlays={overlays}
            plan={plan}
            estimate={estimate}
            editPts={base ? [base, ...targets] : []}
            onMapClick={onMapClick}
            onDragPoint={onDragPoint}
            hoverIndex={hoverIndex}
            rovers={groundTruth && rover ? [rover] : []}
            grids={grids}
            groundTruth={groundTruth}
            roverSolLimit={rover ? missionSol[rover.id] : null}
          />
        ) : (
          <div className="mw-banner">{planState.error ? `UNAVAILABLE · ${planState.error}` : "Locating the rover's latest position (stand-in habitat)…"}</div>
        )}
        {windowJson?.limitation && <MwNote text={windowJson.limitation} />}
      </section>
      <section className="mw-bottom">
        <SheetHead title="ELEVATION AND SLOPE PROFILE" />
        <ProfileStrip profile={plan?.profile} hoverIndex={hoverIndex} onHover={setHoverIndex} />
      </section>
      <aside className="mw-right" aria-label="Decision">
        <SheetHead title="DECISION AND VALIDATION" />
        {linkCheck && (
          <div className={`mw-linkcheck ${linkCheck.shared === linkCheck.now ? "is-match" : "is-diff"}`} role="status" data-testid="plan-link-check">
            <strong>{linkCheck.shared === linkCheck.now ? "SHARED PLAN REPRODUCED" : "SHARED PLAN DIFFERS"}</strong>
            <span>link plan_id {linkCheck.shared}</span>
            <span>replanned {linkCheck.now}</span>
            {linkCheck.shared !== linkCheck.now && <small>The rover stand-in habitat or a data version changed since the link was made.</small>}
          </div>
        )}
        <DecisionCard plan={plan} estimate={estimate} loading={planState.loading} error={planState.error} conditions={conditions} />
        {plan?.status?.value && (
          <SeasonRibbon routeStatus={plan.status.value} lat={conditions?.dust?.cell?.latitude_deg ?? base?.lat} lon={conditions?.dust?.cell?.longitude_deg ?? base?.lon} />
        )}
        <ConditionsStrip site={site} evaHours={evaHours} onConditions={setConditions} />
        <ValidationPanel site={site} />
        <section className="mw-card">
          <h3>SCIENCE STOPS</h3>
          {plan?.science_stops?.length ? (
            plan.science_stops.map((s, i) => (
              <div className="mw-row" key={`${s.name}-${i}`}>
                <span className="mw-row-label">{s.kind}</span>
                <strong>{s.name}</strong>
                <SourceTag ledgerId={s.source?.ledger_id ?? "NEURONEXUS_MARSWALK_PLANNER"} compact />
                {s.rover_tilt_deg != null && <small>rover tilt {s.rover_tilt_deg.toFixed(1)}° (IMU), {s.distance_from_route_m} m from route</small>}
              </div>
            ))
          ) : (
            <p className="mw-dim">Plan a route to list the target and nearby rover ground-truth stations.</p>
          )}
        </section>
      </aside>
    </div>
  );
}
