import { useEffect, useMemo, useRef, useState } from "react";

import "./mars3d.css";
import { requireModules } from "./arcgisLoader";
import { fetchMars3dContext, fetchMars3dTerrainGrid, fetchMars3dTraverses } from "../../services/marsEnvironmentApi";

/*
 * INTERACTIVE 3D MARS (ArcGIS Maps SDK SceneView, Mars 2000 sphere, wkid 104971)
 *
 * Shares App.jsx mission state with the 2D map and the USGS map:
 *   3D click  -> onSelectCoordinate / onSelectFeature / onRoutePointAdd (route mode)
 *   selection -> camera flies to the shared selected location
 * The camera never writes state, and the 3D view remembers the selection it
 * produced itself, so there is no update loop.
 *
 * Every layer shows its evidence status: OBSERVED / MODELED / DERIVED / UNAVAILABLE.
 */

const MARS_SR = { wkid: 104971 };
const SERVICES = {
  imagery: "https://astro.arcgis.com/arcgis/rest/services/OnMars/MDIM/MapServer",
  colorDem: "https://astro.arcgis.com/arcgis/rest/services/OnMars/MColorDEM/MapServer",
  elevation: "https://astro.arcgis.com/arcgis/rest/services/OnMars/MDEM200M/ImageServer",
  geology: "https://services.arcgis.com/v01gqwM5QqNysAAi/arcgis/rest/services/Tanaka_et_al_2014_Mars_Global_Map_Features/FeatureServer",
};

const LAYERS = [
  { key: "terrain", group: "TERRAIN", label: "3D terrain — MOLA/HRSC blended DEM (200 m)", status: "OBSERVED", on: true },
  { key: "imagery", group: "TERRAIN", label: "Viking MDIM 2.1 imagery", status: "OBSERVED", on: true },
  { key: "colorDem", group: "TERRAIN", label: "Colourised MOLA elevation", status: "OBSERVED", on: false },
  { key: "slope", group: "TERRAIN", label: "Slope — local MOLA 128 ppd grid", status: "DERIVED", on: false },
  { key: "roughness", group: "TERRAIN", label: "Roughness — local MOLA 128 ppd grid", status: "DERIVED", on: false },
  { key: "features", group: "USGS", label: "USGS/IAU named features (2,052)", status: "OBSERVED", on: true },
  { key: "units", group: "USGS", label: "Geologic units (SIM 3292)", status: "DERIVED", on: false },
  { key: "contacts", group: "USGS", label: "Geologic contacts", status: "DERIVED", on: false },
  { key: "structures", group: "USGS", label: "Geologic structures", status: "DERIVED", on: false },
  { key: "landing", group: "USGS", label: "Landing sites", status: "OBSERVED", on: true },
  { key: "traverses", group: "ROVERS", label: "Rover traverses — Curiosity, Perseverance (NASA MMGIS)", status: "OBSERVED", on: true },
  { key: "route", group: "MISSION", label: "Current route", status: "DERIVED", on: true },
  { key: "candidates", group: "MISSION", label: "AI candidate routes", status: "DERIVED", on: true },
  { key: "places", group: "MISSION", label: "Safe Havens and custom places (user-defined)", status: "DERIVED", on: true },
  { key: "themis", group: "SCIENCE", label: "THEMIS thermal observations near the site", status: "OBSERVED", on: false },
  { key: "swim", group: "EXPLORATION", label: "NASA SWIM water-ice consensus map", status: "UNAVAILABLE", on: false, disabled: true },
  { key: "iceRegions", group: "EXPLORATION", label: "Human exploration context — documented ice study regions", status: "DERIVED", on: false },
  { key: "ancient", group: "EXPLORATION", label: "Ancient habitability evidence (not present-day)", status: "OBSERVED", on: false },
  { key: "walkability", group: "EXPLORATION", label: "Walkability — NeuroNexus-derived terrain score", status: "DERIVED", on: false },
];

const MARS_RADIUS_KM = 3396.0;
const lon180 = (lon) => ((((Number(lon) + 180) % 360) + 360) % 360) - 180;
const lon360 = (lon) => ((Number(lon) % 360) + 360) % 360;
const fmt = (v, d = 2, unit = "") => (v === null || v === undefined || Number.isNaN(Number(v)) ? "UNAVAILABLE" : `${Number(v).toFixed(d)}${unit}`);

function haversineKm(a, b) {
  const r = (x) => (Number(x) * Math.PI) / 180;
  const dLat = r(b.latitude_deg) - r(a.latitude_deg);
  const dLon = r(lon180(b.longitude_deg - a.longitude_deg));
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(r(a.latitude_deg)) * Math.cos(r(b.latitude_deg)) * Math.sin(dLon / 2) ** 2;
  return 2 * MARS_RADIUS_KM * Math.asin(Math.sqrt(Math.min(1, h)));
}

function ramp(value, lo, hi) {
  const t = Math.max(0, Math.min(1, (Number(value) - lo) / (hi - lo || 1)));
  // green -> amber -> red
  const r = Math.round(t < 0.5 ? 98 + t * 2 * (255 - 98) : 255);
  const g = Math.round(t < 0.5 ? 245 - t * 2 * (245 - 179) : 179 - (t - 0.5) * 2 * (179 - 100));
  const b = Math.round(t < 0.5 ? 154 - t * 2 * (154 - 71) : 71 + (t - 0.5) * 2 * (124 - 71));
  return [r, g, b];
}

function Tag({ status }) {
  return <em className={`m3d-tag m3d-${String(status).toLowerCase()}`}>{status}</em>;
}

export default function Mars3DView({
  open,
  onClose,
  selectedLocation,
  displayName,
  environment,
  features = [],
  routePoints = [],
  routeMode = false,
  candidateRoutes = [],
  selectedCandidateId = null,
  safeHavens = [],
  customPlaces = [],
  onSelectCoordinate,
  onSelectFeature,
  onRoutePointAdd,
  onSelectCandidate,
  onApplyCandidate,
  onOpenDesigner,
  onOpenSnapshot,
  snapshotAvailable = false,
}) {
  const containerRef = useRef(null);
  const viewRef = useRef(null);
  const layersRef = useRef({});
  const modulesRef = useRef(null);
  const widgetRef = useRef(null);
  const ownSelectionRef = useRef(null);
  const propsRef = useRef({});
  const dragRef = useRef(null);

  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [fullscreen, setFullscreen] = useState(false);
  const [height, setHeight] = useState(() => Math.round(Math.min(560, window.innerHeight * 0.58)));
  const [panelOpen, setPanelOpen] = useState(false);
  const [showScience, setShowScience] = useState(true);
  const [visible, setVisible] = useState(() => Object.fromEntries(LAYERS.map((l) => [l.key, l.on])));
  const [readout, setReadout] = useState(null);
  const [tool, setTool] = useState(null);
  const [toolError, setToolError] = useState("");
  const [info, setInfo] = useState(null);
  const [traverses, setTraverses] = useState(null);
  const [context, setContext] = useState(null);
  const [grid, setGrid] = useState({ key: null, data: null, error: "" });

  // Latest callbacks/data for the long-lived SceneView event handlers.
  useEffect(() => {
    propsRef.current = { features, routeMode, onSelectCoordinate, onSelectFeature, onRoutePointAdd, onSelectCandidate };
  });

  /* ------------------------------------------------------------ create the SceneView */
  useEffect(() => {
    if (!open || !containerRef.current) {
      return undefined;
    }
    let destroyed = false;
    requireModules([
      "esri/Map",
      "esri/views/SceneView",
      "esri/layers/TileLayer",
      "esri/layers/ElevationLayer",
      "esri/layers/FeatureLayer",
      "esri/layers/GraphicsLayer",
      "esri/Graphic",
      "esri/widgets/DirectLineMeasurement3D",
      "esri/widgets/AreaMeasurement3D",
      "esri/widgets/ElevationProfile",
    ])
      .then((mods) => {
        if (destroyed) {
          return;
        }
        const [EsriMap, SceneView, TileLayer, ElevationLayer, FeatureLayer, GraphicsLayer, Graphic, DirectLine, AreaMeasure, ElevationProfile] = mods;
        modulesRef.current = { Graphic, DirectLine, AreaMeasure, ElevationProfile };
        const draped = () => new GraphicsLayer({ elevationInfo: { mode: "on-the-ground" } });
        const elevation = new ElevationLayer({ url: SERVICES.elevation });
        const L = {
          elevation,
          imagery: new TileLayer({ url: SERVICES.imagery, title: "Viking MDIM 2.1" }),
          colorDem: new TileLayer({ url: SERVICES.colorDem, title: "Colourised elevation", opacity: 0.65 }),
          units: new FeatureLayer({ url: `${SERVICES.geology}/3`, opacity: 0.4, outFields: ["*"], popupEnabled: false }),
          contacts: new FeatureLayer({ url: `${SERVICES.geology}/1`, outFields: ["*"], popupEnabled: false }),
          structures: new FeatureLayer({ url: `${SERVICES.geology}/2`, outFields: ["*"], popupEnabled: false }),
          // Landing sites are multipoint features, which the 3D FeatureLayer cannot draw:
          // they are queried from the same USGS FeatureServer and drawn as points.
          landing: draped(),
          slope: draped(),
          roughness: draped(),
          walkability: draped(),
          traverses: draped(),
          features: draped(),
          themis: draped(),
          iceRegions: draped(),
          ancient: draped(),
          places: draped(),
          route: draped(),
          candidates: draped(),
          selection: draped(),
        };
        layersRef.current = L;
        const map = new EsriMap({
          ground: { layers: [elevation] },
          layers: [
            L.imagery,
            L.colorDem,
            L.units,
            L.contacts,
            L.structures,
            L.slope,
            L.roughness,
            L.walkability,
            L.traverses,
            L.landing,
            L.features,
            L.themis,
            L.iceRegions,
            L.ancient,
            L.places,
            L.route,
            L.candidates,
            L.selection,
          ],
        });
        const start = selectedLocation ?? { latitude_deg: -4.6, longitude_deg: 137.4 };
        const view = new SceneView({
          container: containerRef.current,
          map,
          spatialReference: MARS_SR,
          qualityProfile: "medium",
          popupEnabled: false,
          environment: { lighting: { type: "virtual" }, atmosphereEnabled: false, starsEnabled: true },
          camera: {
            position: { x: lon180(start.longitude_deg), y: Number(start.latitude_deg) - 6, z: 900000, spatialReference: MARS_SR },
            heading: 0,
            tilt: 45,
          },
        });
        viewRef.current = view;

        view.on("click", async (event) => {
          const p = propsRef.current;
          let hits;
          try {
            hits = (await view.hitTest(event)).results ?? [];
          } catch {
            hits = [];
          }
          const candidate = hits.find((h) => h.graphic?.attributes?.candidateId);
          if (candidate) {
            p.onSelectCandidate?.(candidate.graphic.attributes.candidateId);
            return;
          }
          const geologic = hits.find((h) => h.graphic && [L.units, L.landing, L.structures].includes(h.graphic.layer));
          if (geologic) {
            setInfo({ title: geologic.graphic.layer === L.landing ? "USGS landing site" : "USGS geology", attributes: geologic.graphic.attributes });
          }
          const feature = hits.find((h) => Number.isInteger(h.graphic?.attributes?.featureIndex));
          const mp = event.mapPoint;
          if (feature && !p.routeMode) {
            const chosen = p.features[feature.graphic.attributes.featureIndex];
            if (chosen) {
              ownSelectionRef.current = `${Number(chosen.latitude_deg).toFixed(4)},${lon360(chosen.longitude_deg).toFixed(4)}`;
              p.onSelectFeature?.(chosen);
              return;
            }
          }
          if (!mp) {
            return;
          }
          const point = { latitude_deg: Number(mp.y.toFixed(6)), longitude_deg: Number(lon360(mp.x).toFixed(6)) };
          if (p.routeMode) {
            p.onRoutePointAdd?.(point);
            return;
          }
          ownSelectionRef.current = `${point.latitude_deg.toFixed(4)},${point.longitude_deg.toFixed(4)}`;
          p.onSelectCoordinate?.(point);
        });

        let lastMove = 0;
        view.on("pointer-move", (event) => {
          const now = performance.now();
          if (now - lastMove < 120) {
            return;
          }
          lastMove = now;
          const mp = view.toMap({ x: event.x, y: event.y });
          setReadout(mp ? { lat: mp.y, lon: lon360(mp.x), z: mp.z } : null);
        });

        fetch(`${SERVICES.geology}/0/query?where=1%3D1&outFields=*&outSR=104971&f=json`)
          .then((response) => response.json())
          .then((data) => {
            if (destroyed) return;
            const graphics = [];
            (data.features ?? []).forEach((f) =>
              (f.geometry?.points ?? (f.geometry?.x != null ? [[f.geometry.x, f.geometry.y]] : [])).forEach(([x, y]) =>
                graphics.push(
                  new Graphic({
                    geometry: { type: "point", x, y, spatialReference: MARS_SR },
                    symbol: { type: "simple-marker", style: "square", color: [255, 209, 102], size: 9, outline: { color: [4, 8, 11], width: 1 } },
                    attributes: f.attributes,
                  }),
                ),
              ),
            );
            L.landing.addMany(graphics);
          })
          .catch(() => {});

        view.when(
          () => !destroyed && setReady(true),
          (error) => !destroyed && setLoadError(error?.message ?? "The 3D view could not start (WebGL2 is required)."),
        );
      })
      .catch((error) => !destroyed && setLoadError(error.message));

    return () => {
      destroyed = true;
      widgetRef.current?.destroy?.();
      widgetRef.current = null;
      viewRef.current?.destroy();
      viewRef.current = null;
      layersRef.current = {};
      setReady(false);
    };
    // The view is created once per opening; later state flows in through the effects below.
  }, [open]);

  /* ------------------------------------------------------------ data fetched for layers */
  useEffect(() => {
    if (!open || traverses || !visible.traverses) {
      return;
    }
    fetchMars3dTraverses()
      .then(setTraverses)
      .catch((error) => setTraverses({ status: "unavailable", error: error.message, rovers: [] }));
  }, [open, traverses, visible.traverses]);

  useEffect(() => {
    if (!open || context || !(visible.iceRegions || visible.ancient || showScience)) {
      return;
    }
    fetchMars3dContext()
      .then(setContext)
      .catch((error) => setContext({ status: "unavailable", error: error.message, ancient_habitability: [], ice_study_regions: [], layers: {} }));
  }, [open, context, visible.iceRegions, visible.ancient, showScience]);

  const gridKey = selectedLocation
    ? `${Number(selectedLocation.latitude_deg).toFixed(3)},${lon360(selectedLocation.longitude_deg).toFixed(3)}`
    : null;
  const gridWanted = open && gridKey && (visible.slope || visible.roughness || visible.walkability);
  useEffect(() => {
    if (!gridWanted || grid.key === gridKey) {
      return;
    }
    let cancelled = false;
    fetchMars3dTerrainGrid(selectedLocation.latitude_deg, selectedLocation.longitude_deg, 20)
      .then((data) => !cancelled && setGrid({ key: gridKey, data, error: "" }))
      .catch((error) => !cancelled && setGrid({ key: gridKey, data: null, error: error.message }));
    return () => {
      cancelled = true;
    };
  }, [gridWanted, gridKey, grid.key, selectedLocation]);

  /* ------------------------------------------------------------ layer visibility */
  useEffect(() => {
    const L = layersRef.current;
    const view = viewRef.current;
    if (!ready || !view) {
      return;
    }
    Object.entries(visible).forEach(([key, on]) => {
      if (L[key] && key !== "terrain") {
        L[key].visible = Boolean(on);
      }
    });
    const ground = view.map.ground.layers;
    if (visible.terrain && !ground.includes(L.elevation)) {
      ground.add(L.elevation);
    } else if (!visible.terrain && ground.includes(L.elevation)) {
      ground.remove(L.elevation);
    }
  }, [ready, visible]);

  /* ------------------------------------------------------------ graphics builders */
  function rebuild(layerKey, graphics) {
    const layer = layersRef.current[layerKey];
    const Graphic = modulesRef.current?.Graphic;
    if (!layer || !Graphic) {
      return;
    }
    layer.removeAll();
    layer.addMany(graphics.map((g) => new Graphic(g)));
  }
  const pt = (lat, lon) => ({ type: "point", x: lon180(lon), y: Number(lat), spatialReference: MARS_SR });
  const line = (coords) => ({
    type: "polyline",
    paths: [coords.map((c) => [lon180(c.longitude_deg), Number(c.latitude_deg)])],
    spatialReference: MARS_SR,
  });
  const marker = (color, size = 7, outline = [4, 8, 11]) => ({ type: "simple-marker", color, size, outline: { color: outline, width: 1 } });

  useEffect(() => {
    if (!ready) return;
    rebuild(
      "features",
      features.map((f, index) => ({
        geometry: pt(f.latitude_deg, f.longitude_deg),
        symbol: marker([117, 230, 255, 0.85], 5),
        attributes: { featureIndex: index, name: f.feature_name },
      })),
    );
  }, [ready, features]);

  useEffect(() => {
    if (!ready) return;
    const graphics = (traverses?.rovers ?? [])
      .filter((r) => r.path?.length > 1)
      .map((r) => ({
        geometry: { type: "polyline", paths: [r.path], spatialReference: MARS_SR },
        symbol: { type: "simple-line", color: r.colour, width: 2.5 },
        attributes: { rover: r.rover },
      }));
    rebuild("traverses", graphics);
  }, [ready, traverses]);

  useEffect(() => {
    if (!ready) return;
    const graphics = [];
    if (routePoints.length >= 2) {
      graphics.push({ geometry: line(routePoints), symbol: { type: "simple-line", color: [117, 230, 255], width: 4 } });
    }
    routePoints.forEach((p, i) =>
      graphics.push({
        geometry: pt(p.latitude_deg, p.longitude_deg),
        symbol: marker(
          i === 0 ? [98, 245, 154] : i === routePoints.length - 1 ? [255, 100, 124] : [117, 230, 255],
          i === 0 || i === routePoints.length - 1 ? 9 : 6,
        ),
      }),
    );
    rebuild("route", graphics);
  }, [ready, routePoints]);

  useEffect(() => {
    if (!ready) return;
    const ordered = [...candidateRoutes].sort((a, b) => Number(a.id === selectedCandidateId) - Number(b.id === selectedCandidateId));
    rebuild(
      "candidates",
      ordered
        .filter((c) => (c.path_coordinates ?? c.coordinates)?.length > 1)
        .map((c) => ({
          geometry: line(c.path_coordinates ?? c.coordinates),
          symbol: {
            type: "simple-line",
            color: c.colour ?? "#75e6ff",
            width: c.id === selectedCandidateId ? 6 : 3,
            style: c.id === selectedCandidateId ? "solid" : "dash",
          },
          attributes: { candidateId: c.id },
        })),
    );
  }, [ready, candidateRoutes, selectedCandidateId]);

  useEffect(() => {
    if (!ready) return;
    rebuild("places", [
      ...safeHavens.map((h) => ({
        geometry: pt(h.latitude_deg, h.longitude_deg),
        symbol: marker([140, 240, 177], 10),
        attributes: { name: h.name },
      })),
      ...customPlaces.map((c) => ({
        geometry: pt(c.latitude_deg, c.longitude_deg),
        symbol: marker([255, 209, 102], 8),
        attributes: { name: c.name },
      })),
    ]);
  }, [ready, safeHavens, customPlaces]);

  useEffect(() => {
    if (!ready) return;
    const observations = environment?.thermal?.observations ?? [];
    rebuild(
      "themis",
      observations
        .filter((o) => o.latitude_deg != null && o.longitude_deg != null)
        .map((o) => ({
          geometry: pt(o.latitude_deg, o.longitude_deg),
          symbol: marker(ramp(o.brightness_temperature_k, 170, 290), 9),
          attributes: { name: o.product_id },
        })),
    );
  }, [ready, environment]);

  useEffect(() => {
    if (!ready) return;
    rebuild(
      "ancient",
      (context?.ancient_habitability ?? []).map((s) => ({
        geometry: pt(s.latitude_deg, s.longitude_deg),
        symbol: marker([201, 155, 255], 12),
        attributes: { name: s.name },
      })),
    );
    rebuild(
      "iceRegions",
      (context?.ice_study_regions ?? []).map((s) => ({
        geometry: pt(s.latitude_deg, s.longitude_deg),
        symbol: marker([170, 220, 255], 14, [255, 255, 255]),
        attributes: { name: s.name },
      })),
    );
  }, [ready, context]);

  useEffect(() => {
    if (!ready) return;
    const cells = grid.data?.cells ?? [];
    const cell = (c) => ({
      type: "polygon",
      rings: [
        [
          [lon180(c.lon_min), c.lat_min],
          [lon180(c.lon_min), c.lat_max],
          [lon180(c.lon_max), c.lat_max],
          [lon180(c.lon_max), c.lat_min],
          [lon180(c.lon_min), c.lat_min],
        ],
      ],
      spatialReference: MARS_SR,
    });
    const fill = (rgb) => ({ type: "simple-fill", color: [...rgb, 0.5], outline: { width: 0 } });
    rebuild(
      "slope",
      cells.map((c) => ({ geometry: cell(c), symbol: fill(ramp(c.slope_deg, 0, 20)) })),
    );
    rebuild(
      "roughness",
      cells.map((c) => ({ geometry: cell(c), symbol: fill(ramp(c.roughness_m, 0, 60)) })),
    );
    rebuild(
      "walkability",
      cells.map((c) => ({ geometry: cell(c), symbol: fill(ramp(100 - c.walkability, 0, 100)) })),
    );
  }, [ready, grid]);

  /* ------------------------------------------------------------ selection -> camera */
  useEffect(() => {
    const view = viewRef.current;
    if (!ready || !view || !selectedLocation) return;
    const lat = Number(selectedLocation.latitude_deg);
    const lon = lon360(selectedLocation.longitude_deg);
    rebuild("selection", [{ geometry: pt(lat, lon), symbol: marker([255, 255, 255], 12, [117, 230, 255]) }]);
    const key = `${lat.toFixed(4)},${lon.toFixed(4)}`;
    if (ownSelectionRef.current === key) {
      ownSelectionRef.current = null; // selection came from this view: do not move the camera
      return;
    }
    view
      .goTo({ target: { type: "point", x: lon180(lon), y: lat, spatialReference: MARS_SR }, scale: 4000000, tilt: 45 }, { duration: 1400 })
      .catch(() => {});
  }, [ready, selectedLocation?.latitude_deg, selectedLocation?.longitude_deg]);

  /* ------------------------------------------------------------ resize: SceneView follows its container */
  function onDragStart(event) {
    event.preventDefault();
    dragRef.current = { startY: event.clientY, startHeight: height };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }
  function onDragMove(event) {
    if (!dragRef.current) return;
    const next = dragRef.current.startHeight + (dragRef.current.startY - event.clientY);
    setHeight(Math.max(240, Math.min(window.innerHeight - 70, next)));
  }
  function onDragEnd() {
    dragRef.current = null;
  }

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event) => event.key === "Escape" && setFullscreen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  /* ------------------------------------------------------------ measurement tools */
  function startTool(kind) {
    const view = viewRef.current;
    const M = modulesRef.current;
    widgetRef.current?.destroy?.();
    widgetRef.current = null;
    setToolError("");
    if (!view || !M || !kind || tool === kind) {
      setTool(null);
      return;
    }
    try {
      const Widget = kind === "distance" ? M.DirectLine : kind === "area" ? M.AreaMeasure : M.ElevationProfile;
      const widget =
        kind === "profile"
          ? new Widget({ view, profiles: [{ type: "ground" }], visibleElements: { legend: true, selectButton: true } })
          : new Widget({ view });
      view.ui.add(widget, "top-right");
      widgetRef.current = widget;
      setTool(kind);
    } catch (error) {
      setToolError(`${kind} tool unavailable on this planetary view: ${error.message}`);
      setTool(null);
    }
  }

  /* ------------------------------------------------------------ derived site context */
  const exploration = useMemo(() => {
    if (!selectedLocation) return null;
    const regions = context?.ice_study_regions ?? [];
    const nearest = regions.map((r) => ({ ...r, distance_km: haversineKm(selectedLocation, r) })).sort((a, b) => a.distance_km - b.distance_km)[0];
    const lat = Math.abs(Number(selectedLocation.latitude_deg));
    return {
      band: lat < 30 ? "Equatorial / low latitude (0–30°)" : lat < 60 ? "Mid-latitude (30–60°)" : "High latitude (>60°)",
      nearest,
      elevation: environment?.terrain?.elevation_m,
    };
  }, [selectedLocation, context, environment]);

  const selectedCandidate = candidateRoutes.find((c) => c.id === selectedCandidateId) ?? null;

  if (!open) {
    return null;
  }

  const groups = [...new Set(LAYERS.map((l) => l.group))];
  const terrain = environment?.terrain;
  const thermal = environment?.thermal?.observations?.[0];
  const science = environment?.site_science;

  return (
    <section
      className={`m3d-shell ${fullscreen ? "m3d-fullscreen" : "m3d-docked"}`}
      style={fullscreen ? undefined : { height }}
      aria-label="Interactive 3D Mars map"
    >
      {!fullscreen && (
        <div
          className="m3d-drag"
          role="separator"
          aria-orientation="horizontal"
          aria-label="Drag to resize the 3D map"
          onPointerDown={onDragStart}
          onPointerMove={onDragMove}
          onPointerUp={onDragEnd}
          onPointerCancel={onDragEnd}
        >
          <span />
        </div>
      )}

      <header className="m3d-bar">
        <div className="m3d-title">
          <span>3D MARS · ARCGIS SCENEVIEW · MARS 2000 SPHERE</span>
          <strong>{displayName ?? "NO SITE SELECTED"}</strong>
        </div>
        <div className="m3d-actions">
          <button type="button" className="m3d-btn m3d-primary" onClick={onOpenDesigner}>
            AI ROUTE DESIGN
          </button>
          <button
            type="button"
            className={`m3d-btn${panelOpen ? " active" : ""}`}
            onClick={() => setPanelOpen((v) => !v)}
            aria-label="Filter and layers"
          >
            ☰ LAYERS
          </button>
          <button type="button" className={`m3d-btn${tool === "distance" ? " active" : ""}`} onClick={() => startTool("distance")} disabled={!ready}>
            DISTANCE
          </button>
          <button type="button" className={`m3d-btn${tool === "area" ? " active" : ""}`} onClick={() => startTool("area")} disabled={!ready}>
            AREA
          </button>
          <button type="button" className={`m3d-btn${tool === "profile" ? " active" : ""}`} onClick={() => startTool("profile")} disabled={!ready}>
            PROFILE
          </button>
          <button type="button" className="m3d-btn" onClick={onOpenSnapshot} disabled={!snapshotAvailable}>
            USGS SNAPSHOT
          </button>
          <button type="button" className="m3d-btn" onClick={() => setFullscreen((v) => !v)}>
            {fullscreen ? "EXIT FULL SCREEN" : "FULL SCREEN"}
          </button>
          <button type="button" className="m3d-btn m3d-close" onClick={onClose} aria-label="Close 3D map">
            ×
          </button>
        </div>
      </header>

      <div className="m3d-body">
        <div className="m3d-view" ref={containerRef} />

        {!ready && !loadError && <div className="m3d-status">LOADING ARCGIS MARS SCENE…</div>}
        {loadError && <div className="m3d-status m3d-error">3D VIEW UNAVAILABLE — {loadError}</div>}
        {toolError && <div className="m3d-toast">{toolError}</div>}
        {routeMode && <div className="m3d-toast">ROUTE MODE — clicks on the 3D surface add waypoints to the route editor.</div>}

        {candidateRoutes.length > 0 && (
          <div className="m3d-candidates">
            <span>AI CANDIDATES</span>
            {candidateRoutes.map((c) => (
              <button
                key={c.id}
                type="button"
                className={c.id === selectedCandidateId ? "active" : ""}
                style={{ borderColor: c.colour }}
                onClick={() => onSelectCandidate?.(c.id)}
                title={`${fmt(c.metrics?.distance_km, 2, " km")} · ${fmt(c.metrics?.estimated_eva_hours, 2, " h EVA")}`}
              >
                <i style={{ background: c.colour }} />
                {c.name}
              </button>
            ))}
            {selectedCandidate && (
              <div className="m3d-candidate-detail">
                <strong>{selectedCandidate.name}</strong> · {fmt(selectedCandidate.metrics?.distance_km, 2, " km")} ·{" "}
                {fmt(selectedCandidate.metrics?.estimated_eva_hours, 2, " h EVA")} · risk {fmt(selectedCandidate.metrics?.terrain_risk_proxy, 1)}
                <button type="button" className="m3d-btn m3d-primary" onClick={() => onApplyCandidate?.(selectedCandidate)}>
                  APPLY ROUTE
                </button>
              </div>
            )}
          </div>
        )}

        {info && (
          <div className="m3d-info">
            <header>
              <span>{info.title}</span>
              <button type="button" onClick={() => setInfo(null)} aria-label="Close info">
                ×
              </button>
            </header>
            {Object.entries(info.attributes ?? {})
              .filter(([k, v]) => v !== null && v !== "" && !/^(OBJECTID|FID|Shape|GlobalID)/i.test(k))
              .slice(0, 10)
              .map(([k, v]) => (
                <div key={k}>
                  <b>{k}</b> {String(v)}
                </div>
              ))}
          </div>
        )}

        <footer className="m3d-readout">
          {readout ? (
            <>
              <span>LAT {fmt(readout.lat, 4, "°")}</span>
              <span>LON {fmt(readout.lon, 4, "°E")}</span>
              <span>ELEV {readout.z == null ? "UNAVAILABLE" : `${Math.round(readout.z)} m`}</span>
            </>
          ) : (
            <span>MOVE OVER THE SURFACE FOR COORDINATES</span>
          )}
          <span className="m3d-hint">DRAG ROTATE · RIGHT-DRAG TILT · WHEEL ZOOM · CLICK SELECT</span>
        </footer>

        {panelOpen && (
          <aside className="m3d-panel" aria-label="3D map layers and site science">
            <header>
              <span>FILTER / LAYERS</span>
              <button type="button" onClick={() => setPanelOpen(false)} aria-label="Close layers">
                ×
              </button>
            </header>
            {groups.map((group) => (
              <div key={group} className="m3d-group">
                <h4>{group}</h4>
                {LAYERS.filter((l) => l.group === group).map((l) => (
                  <label key={l.key} className={l.disabled ? "disabled" : ""}>
                    <input
                      type="checkbox"
                      checked={Boolean(visible[l.key])}
                      disabled={l.disabled}
                      onChange={(event) => setVisible((v) => ({ ...v, [l.key]: event.target.checked }))}
                    />
                    <span>{l.label}</span>
                    <Tag status={l.status} />
                  </label>
                ))}
                {group === "TERRAIN" && (visible.slope || visible.roughness) && (
                  <small>
                    {grid.error
                      ? `Local grid unavailable — ${grid.error}`
                      : `Bounded ±20 km MOLA window around the selected site (${grid.data?.cells?.length ?? 0} cells).`}
                  </small>
                )}
                {group === "ROVERS" && traverses && (
                  <small>
                    {(traverses.rovers ?? []).map((r) => `${r.rover}: ${r.status}${r.latest_sol ? ` (to sol ${r.latest_sol})` : ""}`).join(" · ")} —{" "}
                    {traverses.source}
                  </small>
                )}
                {group === "EXPLORATION" && (
                  <small>
                    SWIM ice map: {context?.layers?.swim_water_ice?.reason ?? "not integrated."}{" "}
                    <a href="https://swim.psi.edu/SWIM4MIMProducts.php" target="_blank" rel="noreferrer">
                      SWIM ↗
                    </a>{" "}
                    <a href="https://ammos.nasa.gov/marswatermaps/?mission=MWR" target="_blank" rel="noreferrer">
                      NASA Mars Water Maps ↗
                    </a>
                    {visible.walkability && grid.data?.layers?.walkability?.method ? ` ${grid.data.layers.walkability.method}` : ""}
                  </small>
                )}
              </div>
            ))}

            <div className="m3d-group">
              <h4>
                <label>
                  <input type="checkbox" checked={showScience} onChange={(event) => setShowScience(event.target.checked)} /> SITE SCIENCE
                </label>
              </h4>
              {showScience && (
                <div className="m3d-science">
                  {!environment && <p>Select a site to load its science context.</p>}
                  {environment && (
                    <>
                      <p>
                        <b>Elevation</b> {fmt(terrain?.elevation_m, 0, " m")} · <b>Slope</b> {fmt(terrain?.slope_deg, 2, "°")} · <b>Roughness</b>{" "}
                        {fmt(terrain?.roughness_m, 1, " m")} <Tag status="OBSERVED" />
                        <small>{terrain?.source}</small>
                      </p>
                      <p>
                        <b>Thermal</b>{" "}
                        {thermal ? `${fmt(thermal.brightness_temperature_k, 1, " K")} nearest historical (${thermal.product_id})` : "UNAVAILABLE"}{" "}
                        <Tag status={thermal ? "OBSERVED" : "UNAVAILABLE"} />
                        <small>{environment.thermal?.source}</small>
                      </p>
                      <p>
                        <b>Dust</b> opacity {fmt(environment.dust?.opacity, 3)} · height {fmt(environment.dust?.height_km, 1, " km")}{" "}
                        <Tag status="MODELED" />
                        <small>{environment.dust?.source}</small>
                      </p>
                      <p>
                        <b>Geology</b> nearest named feature: {environment.gazetteer?.nearest_feature?.feature_name ?? "UNAVAILABLE"} (
                        {environment.gazetteer?.nearest_feature?.feature_type ?? "—"})
                        {info?.attributes?.Unit ? ` · unit ${info.attributes.Unit}` : ""} <Tag status="OBSERVED" />
                      </p>
                      {["soil", "minerals", "bioavailability", "vegetation"].map((key) => (
                        <p key={key}>
                          <b>{key === "bioavailability" ? "Habitability proxy" : key[0].toUpperCase() + key.slice(1)}</b>{" "}
                          {science?.[key]?.value ?? "UNAVAILABLE"}{" "}
                          <Tag status={/not_ingested|unavailable/i.test(science?.[key]?.status ?? "unavailable") ? "UNAVAILABLE" : "DERIVED"} />
                          {science?.[key]?.url && (
                            <a href={science[key].url} target="_blank" rel="noreferrer">
                              source ↗
                            </a>
                          )}
                        </p>
                      ))}
                      {exploration && (
                        <p>
                          <b>Human exploration context</b> {exploration.band}; elevation {fmt(exploration.elevation, 0, " m")}
                          {exploration.nearest
                            ? `; nearest documented ice study region: ${exploration.nearest.name} (${fmt(exploration.nearest.distance_km, 0, " km")})`
                            : ""}{" "}
                          <Tag status="DERIVED" />
                          <small>Context only — not a landing-site certification. Ancient habitability ≠ present-day habitability.</small>
                        </p>
                      )}
                      <p>
                        <small>{science?.provenance?.note}</small>
                      </p>
                    </>
                  )}
                </div>
              )}
            </div>
          </aside>
        )}
      </div>
    </section>
  );
}
