import { useEffect, useMemo, useRef, useState } from "react";

import "./mars3d.css";
import { requireModules } from "./arcgisLoader";
import { createLabelOverlay } from "./labelOverlay";
import Mars3DLegend from "./Mars3DLegend";
import SourceTag from "../../sources/SourceTag";
import { cssVar, hexToRgb as tokenRgb, rampColor } from "../../marswalk/walkabilityRamp";
import {
  ENTITY_STYLES,
  LABEL_TIERS,
  LINE_STYLES,
  USGS_CLASS_COLOURS,
  USGS_OTHER_COLOUR,
  featureClass,
  hexToRgb,
  labelTier,
  pointSymbol,
} from "./mapStyle";
import { fetchMars3dContext, fetchMars3dExplorationZones, fetchMars3dTerrainGrid, fetchMars3dTraverses } from "../../services/marsEnvironmentApi";
import Icon from "../../ui/Icon";

/*
 * INTERACTIVE 3D MARS (ArcGIS Maps SDK SceneView, Mars 2000 sphere, wkid 104971)
 *
 * Shares App.jsx mission state with the 2D map and the USGS map:
 *   3D click  -> onSelectCoordinate / onSelectFeature / onRoutePointAdd (route mode)
 *   selection -> camera flies to the shared selected location
 * The camera never writes state and the view remembers selections it made
 * itself, so there is no update loop.
 *
 * Point entities live in client-side FeatureLayers so they carry persistent,
 * decluttered, zoom-tiered labels. Every layer shows OBSERVED / MODELED /
 * DERIVED / UNAVAILABLE.
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
  { key: "dtmFootprints", group: "TERRAIN", label: "HiRISE 1 m and CTX 20 m DTM footprints near the site (bounding boxes)", status: "OBSERVED", on: false },
  { key: "slope", group: "TERRAIN", label: "Slope — local MOLA 128 ppd grid", status: "DERIVED", on: false },
  { key: "roughness", group: "TERRAIN", label: "Roughness — local MOLA 128 ppd grid", status: "DERIVED", on: false },
  { key: "features", group: "USGS", label: "USGS/IAU named features (2,052, coloured-map classes)", status: "OBSERVED", on: true },
  { key: "labels", group: "USGS", label: "Persistent labels (all named entities)", status: "OBSERVED", on: true },
  { key: "units", group: "USGS", label: "Geologic units (SIM 3292)", status: "DERIVED", on: false },
  { key: "contacts", group: "USGS", label: "Geologic contacts", status: "DERIVED", on: false },
  { key: "structures", group: "USGS", label: "Geologic structures", status: "DERIVED", on: false },
  { key: "landing", group: "USGS", label: "Landing sites", status: "OBSERVED", on: true },
  { key: "rovers", group: "ROVERS", label: "Rover locations — latest traverse position", status: "OBSERVED", on: true },
  { key: "traverses", group: "ROVERS", label: "Rover traverses — Curiosity, Perseverance (NASA MMGIS)", status: "OBSERVED", on: true },
  { key: "route", group: "MISSION", label: "Active route and waypoints", status: "DERIVED", on: true },
  { key: "candidates", group: "MISSION", label: "AI candidate routes", status: "DERIVED", on: true },
  { key: "places", group: "MISSION", label: "Safe Havens and custom places (user-defined)", status: "DERIVED", on: true },
  { key: "dust", group: "ATMOSPHERE", label: "MY34 dust optical depth τ tint (modeled, follows the sol)", status: "MODELED", on: false },
  { key: "themis", group: "SCIENCE", label: "THEMIS thermal observations near the site", status: "OBSERVED", on: false },
  { key: "zones", group: "EXPLORATION", label: "Potential Exploration Zones — DERIVED — NEURONEXUS", status: "DERIVED", on: false },
  { key: "swim", group: "EXPLORATION", label: "NASA SWIM water-ice consensus map", status: "UNAVAILABLE", on: false, disabled: true },
  { key: "iceRegions", group: "EXPLORATION", label: "Human exploration context — documented ice study regions", status: "DERIVED", on: false },
  { key: "ancient", group: "EXPLORATION", label: "Ancient habitability evidence (not present-day)", status: "OBSERVED", on: false },
  { key: "walkability", group: "EXPLORATION", label: "Walkability — NeuroNexus-derived terrain score", status: "DERIVED", on: false },
];

/* Canonical ledger id behind each 3D layer (rendered as a tag in the layer list). */
const LAYER_LEDGER = {
  terrain: "MOLA_MEGDR", imagery: "NASA_PDS", colorDem: "MOLA_MEGDR", dtmFootprints: "HIRISE_STAC_DTM", slope: "MOLA_MEGDR",
  roughness: "MOLA_MEGDR", features: "USGS_IAU_GAZETTEER", labels: "USGS_IAU_GAZETTEER", units: "USGS_SIM_3292_ARCGIS",
  contacts: "USGS_SIM_3292_ARCGIS", structures: "USGS_SIM_3292_ARCGIS", landing: "NASA_MARS", rovers: "NASA_MMGIS",
  traverses: "NASA_MMGIS", route: "NN_ROUTE_ENGINE", candidates: "NN_ROUTE_ENGINE", places: "NN_MISSION_SIM", dust: "NASA_AMES_MGCM",
  themis: "THEMIS", zones: "NN_EXPLORATION_ZONES", swim: "NASA_SWIM", iceRegions: "NASA_MARS_WATER_MAPS", ancient: "NASA_CURIOSITY",
  walkability: "NN_WALKABILITY",
};
const FLY_TARGETS = { gale: { lat: -4.82, lon: 137.39, km: 60, label: "GALE" }, jezero: { lat: 18.44, lon: 77.45, km: 60, label: "JEZERO" } };
/* Camera kept across WebGL suspensions (Browser Optimization): restored when the globe reopens on the same site. */
const savedView = { camera: null, siteKey: null };

const prefersReducedMotion = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

const MARS_RADIUS_KM = 3396.19;
const lon180 = (lon) => ((((Number(lon) + 180) % 360) + 360) % 360) - 180;
const lon360 = (lon) => ((Number(lon) % 360) + 360) % 360;
const fmt = (v, d = 2, unit = "") => (v === null || v === undefined || Number.isNaN(Number(v)) ? "UNAVAILABLE" : `${Number(v).toFixed(d)}${unit}`);
const pt = (lat, lon) => ({ type: "point", x: lon180(lon), y: Number(lat), spatialReference: MARS_SR });

function haversineKm(a, b) {
  const r = (x) => (Number(x) * Math.PI) / 180;
  const dLat = r(b.latitude_deg) - r(a.latitude_deg);
  const dLon = r(lon180(b.longitude_deg - a.longitude_deg));
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(r(a.latitude_deg)) * Math.cos(r(b.latitude_deg)) * Math.sin(dLon / 2) ** 2;
  return 2 * MARS_RADIUS_KM * Math.asin(Math.sqrt(Math.min(1, h)));
}

/* Camera looking north at a target from `distanceKm`, tilted 45°, above the local terrain. */
function cameraFor(view, lat, lon, distanceKm, tilt = 45) {
  let ground = 0;
  try {
    const sampled = view.groundView?.elevationSampler?.queryElevation(pt(lat, lon));
    if (Number.isFinite(sampled?.z)) ground = sampled.z;
  } catch {
    ground = 0;
  }
  const t = (tilt * Math.PI) / 180;
  const horizontalKm = distanceKm * Math.sin(t);
  const altitudeM = distanceKm * Math.cos(t) * 1000;
  return {
    position: {
      x: lon180(lon),
      y: Number(lat) - (horizontalKm / MARS_RADIUS_KM) * (180 / Math.PI),
      z: ground + altitudeM,
      spatialReference: MARS_SR,
    },
    heading: 0,
    tilt,
  };
}

function ramp(value, lo, hi) {
  const t = Math.max(0, Math.min(1, (Number(value) - lo) / (hi - lo || 1)));
  const r = Math.round(t < 0.5 ? 98 + t * 2 * (255 - 98) : 255);
  const g = Math.round(t < 0.5 ? 245 - t * 2 * (245 - 179) : 179 - (t - 0.5) * 2 * (179 - 100));
  const b = Math.round(t < 0.5 ? 154 - t * 2 * (154 - 71) : 71 + (t - 0.5) * 2 * (124 - 71));
  return [r, g, b];
}

function Tag({ status }) {
  return <em className={`m3d-tag m3d-${String(status).split(" ")[0].toLowerCase()}`}>{status}</em>;
}

/* ------------------------------------------------------------ labelled point layers */

const POINT_FIELDS = [
  { name: "oid", type: "oid" },
  { name: "name", type: "string" },
  { name: "kind", type: "string" },
  { name: "idx", type: "integer" },
  { name: "tier", type: "integer" },
];

function entityLayer(FeatureLayer, kinds) {
  return new FeatureLayer({
    source: [],
    objectIdField: "oid",
    geometryType: "point",
    spatialReference: MARS_SR,
    fields: POINT_FIELDS,
    outFields: ["*"],
    popupEnabled: false,
    elevationInfo: { mode: "relative-to-ground" },
    screenSizePerspectiveEnabled: true,
    renderer: {
      type: "unique-value",
      field: "kind",
      uniqueValueInfos: Object.entries(kinds).map(([kind, style]) => ({
        value: kind,
        symbol: pointSymbol(style.colour, style.shape ?? "circle", style.size ?? 9),
      })),
    },
  });
}

/* Label priority / zoom tier for each labelled layer (lower priority = placed first). */
const LABEL_RULES = {
  rovers: { priority: 0, size: 11 },
  zones: { priority: 0, size: 10.5 },
  landing: { priority: 1, size: 10 },
  ancient: { priority: 1, size: 10 },
  iceRegions: { priority: 1, size: 10 },
  places: { priority: 1, size: 10 },
  waypoints: { priority: 2, size: 9.5, minScale: 3000000 },
};

/* Replace a client-side FeatureLayer's features; edits are queued per layer. */
function setEntities(layer, Graphic, records) {
  if (!layer || !Graphic) return;
  layer.__queue = (layer.__queue ?? Promise.resolve())
    .then(async () => {
      const existing = await layer.queryFeatures({ where: "1=1", returnGeometry: false, outFields: ["oid"] });
      await layer.applyEdits({
        deleteFeatures: existing.features,
        addFeatures: records.map(
          (r) => new Graphic({ geometry: pt(r.lat, r.lon), attributes: { name: r.name, kind: r.kind, idx: r.idx ?? -1, tier: r.tier ?? 0 } }),
        ),
      });
    })
    .catch(() => {});
}

const FEATURE_KINDS = Object.fromEntries([
  ...Object.entries(USGS_CLASS_COLOURS).map(([cls, colour]) => [cls, { colour, shape: "circle", size: 7 }]),
  ["Other", { colour: USGS_OTHER_COLOUR, shape: "circle", size: 6 }],
]);
const pick = (...keys) => Object.fromEntries(keys.map((k) => [k, ENTITY_STYLES[k]]));
const classColourOf = (cls) => USGS_CLASS_COLOURS[cls] ?? USGS_OTHER_COLOUR;

export default function Mars3DView({
  open,
  onClose,
  sol = 1,
  selectedLocation,
  selectedFeature,
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
  onOpenCompare,
  compareAvailable = false,
  savedRoutes = [],
  compareRouteIds = [],
  onToggleCompareRoute,
  onSnapshotRoute,
  onRenameRoute,
  routeStatsFor = () => null,
  requestedPanel = null,
}) {
  const containerRef = useRef(null);
  const viewRef = useRef(null);
  const layersRef = useRef({});
  const modulesRef = useRef(null);
  const widgetRef = useRef(null);
  const ownSelectionRef = useRef(null);
  const propsRef = useRef({});
  const dragRef = useRef(null);
  const highlightRef = useRef({ hover: null, selected: null });
  const zonesRef = useRef([]);
  const labelContainerRef = useRef(null);
  const overlayRef = useRef(null);
  const labelSetsRef = useRef({});
  const visibleRef = useRef({});
  const refreshLabelsRef = useRef(() => {});

  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [fullscreen, setFullscreen] = useState(false);
  const [height, setHeight] = useState(() => Math.round(Math.min(560, window.innerHeight * 0.58)));
  const [sidePanel, setSidePanel] = useState(null); // "layers" | "legend" | "pez" | "routes" | null
  const [hiddenRoutes, setHiddenRoutes] = useState(() => new Set());
  // ROUTE PROJECTION: the ticked routes are lifted above the terrain, drawn bold with
  // name labels, and the camera reframes to all of them whenever the selection changes.
  const [projection, setProjection] = useState(false);
  const [projectedIds, setProjectedIds] = useState(() => new Set());
  // Another part of the console can ask for a side panel (e.g. "routes").
  const [seenPanelRequest, setSeenPanelRequest] = useState(null);
  if (requestedPanel && requestedPanel !== seenPanelRequest) {
    setSeenPanelRequest(requestedPanel);
    if (requestedPanel.name === "projection") {
      setProjection(true);
      setProjectedIds(new Set(compareRouteIds.length ? compareRouteIds : savedRoutes.map((r) => r.id)));
      setSidePanel("routes");
    } else {
      setSidePanel(requestedPanel.name);
    }
  }
  const [showScience, setShowScience] = useState(true);
  const [mapMode, setMapMode] = useState(false);
  const [visible, setVisible] = useState(() => Object.fromEntries(LAYERS.map((l) => [l.key, l.on])));
  const [readout, setReadout] = useState(null);
  const [tool, setTool] = useState("");
  const [toast, setToast] = useState("");
  const [info, setInfo] = useState(null);
  const [traverses, setTraverses] = useState(null);
  const [context, setContext] = useState(null);
  const [grid, setGrid] = useState({ key: null, data: null, error: "" });
  const [zones, setZones] = useState({ key: null, data: null, error: "", loading: false });

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
        if (destroyed) return;
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
          slope: draped(),
          roughness: draped(),
          walkability: draped(),
          zoneAreas: draped(),
          traverses: draped(),
          dtmFootprints: draped(),
          dust: new GraphicsLayer({ elevationInfo: { mode: "on-the-ground" }, opacity: 0.5 }),
          themis: draped(),
          savedRoutes: draped(),
          // Lifted slightly above the surface so projected routes are never hidden by relief.
          projection: new GraphicsLayer({ elevationInfo: { mode: "relative-to-ground", offset: 80 } }),
          route: draped(),
          candidates: draped(),
          selection: draped(),
          // Labelled point entities (client-side FeatureLayers; labels are decluttered by the SceneView)
          features: entityLayer(FeatureLayer, FEATURE_KINDS, { tiered: true, labelSize: 8.5 }),
          landing: entityLayer(FeatureLayer, pick("landing")),
          rovers: entityLayer(FeatureLayer, pick("curiosity", "perseverance"), { labelSize: 10 }),
          places: entityLayer(FeatureLayer, pick("safeHaven", "customPlace")),
          waypoints: entityLayer(FeatureLayer, {
            ...pick("routeStart", "routeEnd"),
            routeWaypoint: { ...ENTITY_STYLES.routeWaypoint, minScale: 3000000 },
          }),
          zones: entityLayer(FeatureLayer, pick("zone"), { labelSize: 9.5 }),
          ancient: entityLayer(FeatureLayer, pick("ancient")),
          iceRegions: entityLayer(FeatureLayer, pick("iceRegion")),
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
            L.zoneAreas,
            L.dust,
            L.dtmFootprints,
            L.traverses,
            L.themis,
            L.savedRoutes,
            L.route,
            L.candidates,
            L.projection,
            L.selection,
            L.features,
            L.landing,
            L.iceRegions,
            L.ancient,
            L.zones,
            L.places,
            L.waypoints,
            L.rovers,
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
          camera:
            savedView.camera && savedView.siteKey === `${start.latitude_deg},${start.longitude_deg}`
              ? savedView.camera
              : {
                  position: { x: lon180(start.longitude_deg), y: Number(start.latitude_deg) - 6, z: 900000, spatialReference: MARS_SR },
                  heading: 0,
                  tilt: 45,
                },
        });
        savedView.siteKey = `${start.latitude_deg},${start.longitude_deg}`;
        viewRef.current = view;
        overlayRef.current = labelContainerRef.current ? createLabelOverlay(view, labelContainerRef.current) : null;

        // Landing sites are multipoint features, which the 3D FeatureLayer cannot draw:
        // they are queried from the same USGS FeatureServer and drawn as labelled points.
        fetch(`${SERVICES.geology}/0/query?where=1%3D1&outFields=*&outSR=104971&f=json`)
          .then((response) => response.json())
          .then((data) => {
            if (destroyed) return;
            const records = [];
            (data.features ?? []).forEach((f) =>
              (f.geometry?.points ?? (f.geometry?.x != null ? [[f.geometry.x, f.geometry.y]] : [])).forEach(([x, y]) =>
                records.push({
                  lat: y,
                  lon: x,
                  kind: "landing",
                  name: String(f.attributes?.FULL_NAME ?? f.attributes?.NAME ?? "Landing site").replace(/ Landing Site$/i, ""),
                }),
              ),
            );
            setEntities(L.landing, Graphic, records);
            labelSetsRef.current.landing = records;
            refreshLabelsRef.current();
          })
          .catch(() => {});

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
          const zone = hits.find((h) => Number.isInteger(h.graphic?.attributes?.zoneIndex));
          if (zone) {
            const z = zonesRef.current[zone.graphic.attributes.zoneIndex];
            if (z) setInfo({ title: "POTENTIAL EXPLORATION ZONE — DERIVED — NEURONEXUS", zone: z });
          }
          const geologic = hits.find((h) => h.graphic && [L.units, L.structures, L.contacts].includes(h.graphic.layer));
          if (geologic && !zone) {
            setInfo({ title: "USGS geology (SIM 3292)", attributes: geologic.graphic.attributes });
          }
          const entity = hits.find((h) => h.graphic?.attributes?.kind && h.graphic.layer !== L.features);
          if (entity && !p.routeMode && entity.graphic.geometry) {
            const g = entity.graphic;
            if (g.layer === L.landing || g.layer === L.rovers)
              setInfo({ title: g.layer === L.rovers ? "Rover location" : "USGS landing site", attributes: { name: g.attributes.name } });
            const point = { latitude_deg: Number(g.geometry.y.toFixed(6)), longitude_deg: Number(lon360(g.geometry.x).toFixed(6)) };
            ownSelectionRef.current = `${point.latitude_deg.toFixed(4)},${point.longitude_deg.toFixed(4)}`;
            p.onSelectCoordinate?.(point);
            return;
          }
          const feature = hits.find((h) => h.graphic?.layer === L.features && Number.isInteger(h.graphic?.attributes?.idx));
          if (feature && !p.routeMode) {
            const chosen = p.features[feature.graphic.attributes.idx];
            if (chosen) {
              ownSelectionRef.current = `${Number(chosen.latitude_deg).toFixed(4)},${lon360(chosen.longitude_deg).toFixed(4)}`;
              p.onSelectFeature?.(chosen);
              return;
            }
          }
          const mp = event.mapPoint;
          if (!mp) return;
          const point = { latitude_deg: Number(mp.y.toFixed(6)), longitude_deg: Number(lon360(mp.x).toFixed(6)) };
          if (p.routeMode) {
            p.onRoutePointAdd?.(point);
            return;
          }
          ownSelectionRef.current = `${point.latitude_deg.toFixed(4)},${point.longitude_deg.toFixed(4)}`;
          p.onSelectCoordinate?.(point);
        });

        let lastMove = 0;
        let hoverBusy = false;
        view.on("pointer-move", (event) => {
          const now = performance.now();
          if (now - lastMove < 120) return;
          lastMove = now;
          const mp = view.toMap({ x: event.x, y: event.y });
          if (hoverBusy) {
            setReadout((current) => (mp ? { ...current, lat: mp.y, lon: lon360(mp.x), z: mp.z } : null));
            return;
          }
          hoverBusy = true;
          const pointLayers = [L.features, L.landing, L.rovers, L.places, L.zones, L.ancient, L.iceRegions, L.waypoints];
          view
            .hitTest(event, { include: pointLayers })
            .then(async ({ results }) => {
              const hit = results?.find((r) => r.graphic?.attributes?.name);
              highlightRef.current.hover?.remove();
              highlightRef.current.hover = null;
              if (hit) {
                const layerView = await view.whenLayerView(hit.graphic.layer);
                highlightRef.current.hover = layerView.highlight(hit.graphic);
              }
              setReadout(mp ? { lat: mp.y, lon: lon360(mp.x), z: mp.z, name: hit?.graphic?.attributes?.name ?? null } : null);
            })
            .catch(() => {})
            .finally(() => {
              hoverBusy = false;
            });
        });

        view.when(
          () => !destroyed && setReady(true),
          (error) => !destroyed && setLoadError(error?.message ?? "The 3D view could not start (WebGL2 is required)."),
        );
      })
      .catch((error) => !destroyed && setLoadError(error.message));

    const highlights = highlightRef.current;
    return () => {
      destroyed = true;
      highlights.hover?.remove();
      highlights.selected?.remove();
      widgetRef.current?.destroy?.();
      widgetRef.current = null;
      overlayRef.current?.destroy();
      overlayRef.current = null;
      try {
        savedView.camera = viewRef.current?.camera?.clone?.() ?? savedView.camera;
      } catch {
        // Keep the previous camera.
      }
      viewRef.current?.destroy();
      viewRef.current = null;
      layersRef.current = {};
      setReady(false);
    };
  }, [open]);

  /* ------------------------------------------------------------ data fetched for layers */
  useEffect(() => {
    if (!open || traverses || !(visible.traverses || visible.rovers)) return;
    fetchMars3dTraverses()
      .then(setTraverses)
      .catch((error) => setTraverses({ status: "unavailable", error: error.message, rovers: [] }));
  }, [open, traverses, visible.traverses, visible.rovers]);

  useEffect(() => {
    if (!open || context || !(visible.iceRegions || visible.ancient || showScience)) return;
    fetchMars3dContext()
      .then(setContext)
      .catch((error) => setContext({ status: "unavailable", error: error.message, ancient_habitability: [], ice_study_regions: [], layers: {} }));
  }, [open, context, visible.iceRegions, visible.ancient, showScience]);

  const siteKey = selectedLocation
    ? `${Number(selectedLocation.latitude_deg).toFixed(3)},${lon360(selectedLocation.longitude_deg).toFixed(3)}`
    : null;
  const gridWanted = open && siteKey && (visible.slope || visible.roughness || visible.walkability);
  useEffect(() => {
    if (!gridWanted || grid.key === siteKey) return undefined;
    let cancelled = false;
    fetchMars3dTerrainGrid(selectedLocation.latitude_deg, selectedLocation.longitude_deg, 20)
      .then((data) => !cancelled && setGrid({ key: siteKey, data, error: "" }))
      .catch((error) => !cancelled && setGrid({ key: siteKey, data: null, error: error.message }));
    return () => {
      cancelled = true;
    };
  }, [gridWanted, siteKey, grid.key, selectedLocation]);

  const zonesKey = `zones:${siteKey ?? "none"}`;
  const zonesWanted = open && (visible.zones || sidePanel === "pez");
  useEffect(() => {
    if (!zonesWanted || zones.key === zonesKey) return undefined;
    let cancelled = false;
    fetchMars3dExplorationZones(selectedLocation)
      .then((data) => !cancelled && setZones({ key: zonesKey, data, error: "", loading: false }))
      .catch((error) => !cancelled && setZones({ key: zonesKey, data: null, error: error.message, loading: false }));
    return () => {
      cancelled = true;
    };
  }, [zonesWanted, zonesKey, zones.key, selectedLocation]);

  /* ------------------------------------------------------------ persistent labels */
  useEffect(() => {
    visibleRef.current = visible;
    refreshLabelsRef.current = () => {
      const overlay = overlayRef.current;
      if (!overlay) return;
      const v = visibleRef.current;
      if (!v.labels) {
        overlay.setEntries([]);
        return;
      }
      const sets = labelSetsRef.current;
      const out = [];
      if (v.features) {
        (sets.features ?? []).forEach((r) => {
          const tier = LABEL_TIERS[r.tier] ?? LABEL_TIERS[4];
          out.push({
            lat: r.lat,
            lon: r.lon,
            text: r.name,
            colour: classColourOf(r.kind),
            kind: "feature",
            priority: 3 + r.tier,
            minScale: tier.minScale,
            size: r.tier <= 1 ? 11 : 9.5,
          });
        });
      }
      Object.entries(LABEL_RULES).forEach(([layerKey, rule]) => {
        const shown = layerKey === "waypoints" ? v.route : v[layerKey];
        if (!shown) return;
        (sets[layerKey] ?? []).forEach((r) =>
          out.push({
            lat: r.lat,
            lon: r.lon,
            text: r.name,
            colour: ENTITY_STYLES[r.kind]?.colour ?? "#e6f6fb",
            kind: r.kind,
            priority: rule.priority,
            minScale: rule.minScale ?? 0,
            size: rule.size,
          }),
        );
      });
      overlay.setEntries(out);
    };
    refreshLabelsRef.current();
  }, [visible, ready]);

  /* ------------------------------------------------------------ layer visibility */
  useEffect(() => {
    const L = layersRef.current;
    const view = viewRef.current;
    if (!ready || !view) return;
    const show = { ...visible, waypoints: visible.route, zoneAreas: visible.zones };
    Object.entries(show).forEach(([key, on]) => {
      if (L[key] && key !== "terrain" && key !== "labels") L[key].visible = Boolean(on);
    });
    const ground = view.map.ground.layers;
    if (visible.terrain && !ground.includes(L.elevation)) ground.add(L.elevation);
    else if (!visible.terrain && ground.includes(L.elevation)) ground.remove(L.elevation);
  }, [ready, visible]);

  /* ------------------------------------------------------------ DTM footprints and modeled dust */
  const footLat = selectedLocation?.latitude_deg;
  const footLon = selectedLocation?.longitude_deg;
  useEffect(() => {
    if (!ready || !visible.dtmFootprints || footLat == null) return undefined;
    const controller = new AbortController();
    const colors = { HIRISE: tokenRgb(cssVar("--nn-src-hirise") || "#3fbcd4"), CTX: tokenRgb(cssVar("--nn-src-ctx") || "#4ea8de") };
    const draw = (products) =>
      rebuild(
        "dtmFootprints",
        products.map((p) => {
          const [x0, y0, x1, y1] = p.bbox;
          const ok = p.asset_status?.status === "OK";
          return {
            geometry: { type: "polygon", rings: [[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]], spatialReference: MARS_SR },
            symbol: { type: "simple-fill", color: [...colors[p.family], 0.06], outline: { color: [...colors[p.family], ok ? 0.95 : 0.5], width: 1.5, style: ok ? "solid" : "dash" } },
            attributes: { name: p.product_id },
          };
        }),
      );
    const url = (families) => `/api/terrain/sources?lat=${footLat}&lon=${lon180(footLon)}&radius_km=10&families=${families}`;
    const collected = [];
    ["HIRISE", "CTX"].forEach((family) =>
      fetch(url(family), { signal: controller.signal })
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
        .then((body) => {
          collected.push(...body.products);
          draw(collected);
        })
        .catch(() => {}),
    );
    return () => controller.abort();
  }, [ready, visible.dtmFootprints, footLat, footLon]);

  useEffect(() => {
    if (!ready || !visible.dust) return undefined;
    const controller = new AbortController();
    const stops = ["--nn-surface-2", "--nn-cyan", "--nn-amber"].map((t) => cssVar(t) || "#808080");
    fetch(`/api/dust/map?sol=${sol}`, { signal: controller.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d) => {
        const graphics = [];
        const dLat = Math.abs(d.lat[1] - d.lat[0]);
        const dLon = Math.abs(d.lon[1] - d.lon[0]);
        for (let r = 0; r < d.lat.length; r += 1) {
          for (let c = 0; c < d.lon.length; c += 1) {
            const tau = d.tau[r][c];
            if (tau == null) continue;
            const [rr, gg, bb] = rampColor((Math.log1p(tau) / Math.log1p(2)) * 100, stops).match(/\d+/g).map(Number);
            const x0 = lon180(d.lon[c] - dLon / 2);
            const y0 = d.lat[r] - dLat / 2;
            graphics.push({
              geometry: { type: "polygon", rings: [[[x0, y0], [x0 + dLon, y0], [x0 + dLon, y0 + dLat], [x0, y0 + dLat], [x0, y0]]], spatialReference: MARS_SR },
              symbol: { type: "simple-fill", color: [rr, gg, bb, 0.55], outline: { width: 0 } },
            });
          }
        }
        rebuild("dust", graphics);
      })
      .catch(() => {});
    return () => controller.abort();
  }, [ready, visible.dust, sol]);

  const smoothFlyTo = (lat, lon, km) => {
    const view = viewRef.current;
    if (view) view.goTo(cameraFor(view, lat, lon, km), { duration: prefersReducedMotion() ? 0 : 3200, easing: "in-out-cubic" }).catch(() => {});
  };
  const flyToCorridor = () => {
    if (routePoints.length < 2) return;
    const lats = routePoints.map((p) => Number(p.latitude_deg));
    const lons = routePoints.map((p) => lon180(p.longitude_deg));
    const spanKm = Math.max(5, haversineKm({ latitude_deg: Math.min(...lats), longitude_deg: Math.min(...lons) }, { latitude_deg: Math.max(...lats), longitude_deg: Math.max(...lons) }));
    smoothFlyTo((Math.min(...lats) + Math.max(...lats)) / 2, (Math.min(...lons) + Math.max(...lons)) / 2, spanKm * 2.2);
  };

  /* ------------------------------------------------------------ graphics builders */
  function rebuild(layerKey, graphics) {
    const layer = layersRef.current[layerKey];
    const Graphic = modulesRef.current?.Graphic;
    if (!layer || !Graphic) return;
    layer.removeAll();
    layer.addMany(graphics.map((g) => new Graphic(g)));
  }
  const entities = (layerKey, records) => {
    setEntities(layersRef.current[layerKey], modulesRef.current?.Graphic, records);
    labelSetsRef.current[layerKey] = records;
    refreshLabelsRef.current();
  };
  const line = (coords) => ({
    type: "polyline",
    paths: [coords.map((c) => [lon180(c.longitude_deg), Number(c.latitude_deg)])],
    spatialReference: MARS_SR,
  });
  const glowLine = (geometry, colour, width, extra = {}) => {
    const rgb = Array.isArray(colour) ? colour : hexToRgb(colour);
    const opacity = extra.opacity ?? 1;
    return [
      { geometry, symbol: { type: "simple-line", color: [...rgb, 0.22 * opacity], width: width * 3 }, attributes: extra },
      { geometry, symbol: { type: "simple-line", color: [...rgb, opacity], width, style: extra.dashed ? "dash" : "solid" }, attributes: extra },
    ];
  };

  useEffect(() => {
    if (!ready) return;
    entities(
      "features",
      features.map((f, index) => ({
        lat: f.latitude_deg,
        lon: f.longitude_deg,
        name: f.feature_name,
        kind: featureClass(f.feature_type),
        idx: index,
        tier: labelTier(f),
      })),
    );
  }, [ready, features]);

  useEffect(() => {
    if (!ready) return;
    const rovers = (traverses?.rovers ?? []).filter((r) => r.path?.length > 1);
    const key = (r) => (r.id.startsWith("msl") ? "curiosity" : "perseverance");
    rebuild(
      "traverses",
      rovers.flatMap((r) =>
        glowLine({ type: "polyline", paths: [r.path.map(([x, y]) => [lon180(x), y])], spatialReference: MARS_SR }, LINE_STYLES[key(r)].colour, 3, {
          rover: r.rover,
        }),
      ),
    );
    entities(
      "rovers",
      rovers.map((r) => ({
        lat: r.end[1],
        lon: r.end[0],
        kind: key(r),
        name: `${r.rover.split(" ")[0]}${r.latest_sol ? ` · sol ${r.latest_sol}` : ""}`,
      })),
    );
  }, [ready, traverses]);

  useEffect(() => {
    if (!ready) return;
    rebuild("route", routePoints.length >= 2 ? glowLine(line(routePoints), LINE_STYLES.route.colour, 4) : []);
    entities(
      "waypoints",
      routePoints.map((p, i) => ({
        lat: p.latitude_deg,
        lon: p.longitude_deg,
        kind: i === 0 ? "routeStart" : i === routePoints.length - 1 ? "routeEnd" : "routeWaypoint",
        name: i === 0 ? "START" : i === routePoints.length - 1 ? "DESTINATION" : `WP ${i + 1}`,
      })),
    );
  }, [ready, routePoints]);

  /* Saved routes: same colours as 2D and the comparison workspace. In compare
   * mode (two or more routes selected) the compared routes stay bright and the
   * rest dim to 25%. */
  useEffect(() => {
    if (!ready) return;
    const comparing = compareRouteIds.length >= 2;
    const bright = (r) => (projection ? false : !comparing || compareRouteIds.includes(r.id));
    rebuild(
      "savedRoutes",
      savedRoutes
        .filter((r) => !hiddenRoutes.has(r.id) && r.points?.length > 1 && !(projection && projectedIds.has(r.id)))
        .flatMap((r) =>
          glowLine(line(r.points), r.colour ?? "#75e6ff", comparing && compareRouteIds.includes(r.id) ? 4 : 3, {
            savedRouteId: r.id,
            opacity: bright(r) ? 1 : projection ? 0.15 : 0.25,
          }),
        ),
    );
  }, [ready, savedRoutes, compareRouteIds, hiddenRoutes, projection, projectedIds]);

  const projectedRoutes = useMemo(
    () => (projection ? savedRoutes.filter((r) => projectedIds.has(r.id) && r.points?.length > 1) : []),
    [projection, savedRoutes, projectedIds],
  );

  useEffect(() => {
    if (!ready) return;
    rebuild(
      "projection",
      projectedRoutes.flatMap((r) => {
        const rgb = hexToRgb(r.colour ?? "#75e6ff");
        const first = r.points[0];
        const last = r.points[r.points.length - 1];
        // Label at the route's middle vertex so routes sharing a start keep separate labels.
        const middle = r.points.length > 2 ? r.points[Math.floor(r.points.length / 2)] : {
          latitude_deg: (Number(first.latitude_deg) + Number(last.latitude_deg)) / 2,
          longitude_deg: (Number(first.longitude_deg) + Number(last.longitude_deg)) / 2,
        };
        const marker = (p, fill) => ({
          geometry: pt(Number(p.latitude_deg), Number(p.longitude_deg)),
          symbol: {
            type: "point-3d",
            symbolLayers: [{ type: "icon", resource: { primitive: "circle" }, size: 10, material: { color: fill }, outline: { color: [...rgb, 1], size: 2 } }],
          },
          attributes: { savedRouteId: r.id },
        });
        return [
          ...glowLine(line(r.points), rgb, 6, { savedRouteId: r.id }),
          marker(first, [98, 245, 154, 1]),
          marker(last, [255, 100, 124, 1]),
          {
            geometry: pt(Number(middle.latitude_deg), Number(middle.longitude_deg)),
            symbol: {
              type: "point-3d",
              verticalOffset: { screenLength: 46, maxWorldLength: 400000, minWorldLength: 0 },
              callout: { type: "line", size: 1, color: [...rgb, 0.9] },
              symbolLayers: [
                {
                  type: "text",
                  text: r.name,
                  size: 11,
                  material: { color: [...rgb, 1] },
                  halo: { color: [4, 8, 11, 0.92], size: 1.6 },
                  font: { family: "monospace", weight: "bold" },
                },
              ],
            },
            attributes: { savedRouteId: r.id },
          },
        ];
      }),
    );
  }, [ready, projectedRoutes]);

  // Reframe the camera to every projected route as the selection changes.
  const projectionKey = projectedRoutes.map((r) => `${r.id}:${r.geometryHash}`).join("|");
  useEffect(() => {
    if (!ready || !projectedRoutes.length) return;
    flyToRoutes(projectedRoutes);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, projectionKey]);


  useEffect(() => {
    if (!ready) return;
    const ordered = [...candidateRoutes].sort((a, b) => Number(a.id === selectedCandidateId) - Number(b.id === selectedCandidateId));
    rebuild(
      "candidates",
      ordered
        .filter((c) => (c.path_coordinates ?? c.coordinates)?.length > 1)
        .flatMap((c) =>
          glowLine(line(c.path_coordinates ?? c.coordinates), c.colour ?? "#75e6ff", c.id === selectedCandidateId ? 5 : 2.5, {
            candidateId: c.id,
            dashed: c.id !== selectedCandidateId,
          }),
        ),
    );
  }, [ready, candidateRoutes, selectedCandidateId]);

  useEffect(() => {
    if (!ready) return;
    entities("places", [
      ...safeHavens.map((h) => ({ lat: h.latitude_deg, lon: h.longitude_deg, kind: "safeHaven", name: h.name ?? "Safe Haven" })),
      ...customPlaces.map((c) => ({ lat: c.latitude_deg, lon: c.longitude_deg, kind: "customPlace", name: c.name ?? "Custom place" })),
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
          symbol: pointSymbol(
            `#${ramp(o.brightness_temperature_k, 170, 290)
              .map((v) => v.toString(16).padStart(2, "0"))
              .join("")}`,
            "circle",
            9,
          ),
        })),
    );
  }, [ready, environment]);

  useEffect(() => {
    if (!ready) return;
    entities(
      "ancient",
      (context?.ancient_habitability ?? []).map((s) => ({ lat: s.latitude_deg, lon: s.longitude_deg, kind: "ancient", name: `${s.name} · ancient` })),
    );
    entities(
      "iceRegions",
      (context?.ice_study_regions ?? []).map((s) => ({
        lat: s.latitude_deg,
        lon: s.longitude_deg,
        kind: "iceRegion",
        name: `${s.name} · ice study`,
      })),
    );
  }, [ready, context]);

  useEffect(() => {
    if (!ready) return;
    const cells = grid.data?.cells ?? [];
    const fill = (rgb) => ({ type: "simple-fill", color: [...rgb, 0.5], outline: { width: 0 } });
    rebuild(
      "slope",
      cells.map((c) => ({ geometry: cellPolygon(c), symbol: fill(ramp(c.slope_deg, 0, 20)) })),
    );
    rebuild(
      "roughness",
      cells.map((c) => ({ geometry: cellPolygon(c), symbol: fill(ramp(c.roughness_m, 0, 60)) })),
    );
    rebuild(
      "walkability",
      cells.map((c) => ({ geometry: cellPolygon(c), symbol: fill(ramp(100 - c.walkability, 0, 100)) })),
    );
  }, [ready, grid]);

  useEffect(() => {
    if (!ready) return;
    const list = (zones.data?.zones ?? []).filter((z) => z.cells?.length);
    zonesRef.current = list;
    const rgb = hexToRgb(ENTITY_STYLES.zone.colour);
    rebuild(
      "zoneAreas",
      list.flatMap((z, zoneIndex) => [
        ...z.cells.map((c) => ({
          geometry: cellPolygon(c),
          symbol: { type: "simple-fill", color: [...rgb, 0.24], outline: { width: 0 } },
          attributes: { zoneIndex },
        })),
        {
          geometry: cellPolygon(z.extent),
          symbol: { type: "simple-fill", color: [...rgb, 0.04], outline: { color: [...rgb, 0.95], width: 1.6, style: "dash" } },
          attributes: { zoneIndex },
        },
      ]),
    );
    entities(
      "zones",
      list.map((z) => ({ lat: (z.extent.lat_min + z.extent.lat_max) / 2, lon: z.longitude_deg, kind: "zone", name: `PEZ · ${z.name}` })),
    );
  }, [ready, zones]);

  /* ------------------------------------------------------------ selection -> camera + highlight */
  useEffect(() => {
    const view = viewRef.current;
    if (!ready || !view || !selectedLocation) return;
    const lat = Number(selectedLocation.latitude_deg);
    const lon = lon360(selectedLocation.longitude_deg);
    rebuild("selection", [{ geometry: pt(lat, lon), symbol: pointSymbol("#ffffff", "circle", 11) }]);
    const key = `${lat.toFixed(4)},${lon.toFixed(4)}`;
    if (ownSelectionRef.current === key) {
      ownSelectionRef.current = null; // selection came from this view: keep the camera where the user is
      return;
    }
    view.goTo(cameraFor(view, lat, lon, 1300), { duration: 1400 }).catch(() => {});
  }, [ready, selectedLocation?.latitude_deg, selectedLocation?.longitude_deg]);

  useEffect(() => {
    const view = viewRef.current;
    const layer = layersRef.current.features;
    highlightRef.current.selected?.remove();
    highlightRef.current.selected = null;
    if (!ready || !view || !layer || !selectedFeature) return;
    const idx = features.findIndex((f) => f.feature_name === selectedFeature.feature_name);
    if (idx < 0) return;
    layer
      .queryObjectIds({ where: `idx = ${idx}` })
      .then(async (ids) => {
        if (!ids?.length) return;
        const layerView = await view.whenLayerView(layer);
        highlightRef.current.selected = layerView.highlight(ids);
      })
      .catch(() => {});
  }, [ready, selectedFeature, features]);

  /* ------------------------------------------------------------ resize */
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

  useEffect(() => {
    if (!toast) return undefined;
    const timer = window.setTimeout(() => setToast(""), 4500);
    return () => window.clearTimeout(timer);
  }, [toast]);

  /* ------------------------------------------------------------ HUD actions */
  function startTool(kind) {
    const view = viewRef.current;
    const M = modulesRef.current;
    widgetRef.current?.destroy?.();
    widgetRef.current = null;
    setTool(kind);
    if (!view || !M || !kind) return;
    try {
      const Widget = kind === "distance" ? M.DirectLine : kind === "area" ? M.AreaMeasure : M.ElevationProfile;
      const widget = kind === "profile" ? new Widget({ view, profiles: [{ type: "ground" }] }) : new Widget({ view });
      view.ui.add(widget, "top-right");
      widgetRef.current = widget;
    } catch (error) {
      setToast(`${kind} tool unavailable on this planetary view: ${error.message}`);
      setTool("");
    }
  }

  function toggleMapMode() {
    const next = !mapMode;
    setMapMode(next);
    setVisible((v) => ({ ...v, features: true, labels: true, colorDem: next }));
    setSidePanel(next ? "legend" : null);
  }

  function togglePanel(name) {
    setSidePanel((current) => (current === name ? null : name));
    if (name === "pez") setVisible((v) => ({ ...v, zones: true }));
  }

  function flyTo(lat, lon, distanceKm = 600) {
    const view = viewRef.current;
    if (view) view.goTo(cameraFor(view, lat, lon, distanceKm), { duration: 1400 }).catch(() => {});
  }

  function flyToRoute(route) {
    flyToRoutes([route]);
  }

  function toggleProjection() {
    if (!projection) {
      // Start from the comparison selection, or every saved route when nothing is selected.
      setProjectedIds(new Set(compareRouteIds.length ? compareRouteIds : savedRoutes.map((r) => r.id)));
      setSidePanel("routes");
    }
    setProjection(!projection);
  }

  function toggleProjected(id) {
    setProjectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function flyToRoutes(routes) {
    const pts = routes.flatMap((route) => route.points ?? []);
    if (!pts.length) return;
    // Frame the bounding box of every route, not the vertex average.
    const lats = pts.map((p) => Number(p.latitude_deg));
    const lons = pts.map((p) => lon180(p.longitude_deg));
    const lat = (Math.min(...lats) + Math.max(...lats)) / 2;
    const lon = (Math.min(...lons) + Math.max(...lons)) / 2;
    const span = Math.max(...pts.map((p) => haversineKm({ latitude_deg: lat, longitude_deg: lon }, p)));
    // A flatter, wider view than a single-site fly-to so every route fits in frame.
    const view = viewRef.current;
    if (view) view.goTo(cameraFor(view, lat, lon, Math.max(160, span * 6.5), 20), { duration: 1400 }).catch(() => {});
  }

  function toggleRouteVisibility(id) {
    setHiddenRoutes((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function handleCompare() {
    if (!compareAvailable) {
      setToast("COMPARE needs at least two saved routes — save routes from the route editor first.");
      return;
    }
    onOpenCompare?.();
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

  if (!open) return null;

  const groups = [...new Set(LAYERS.map((l) => l.group))];
  const terrain = environment?.terrain;
  const thermal = environment?.thermal?.observations?.[0];
  const science = environment?.site_science;
  const zoneList = zones.data?.zones ?? [];

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
        <nav className="m3d-actions" aria-label="3D map tools">
          <button type="button" className="m3d-btn m3d-primary" onClick={onOpenDesigner}>
            AI ROUTE DESIGN
          </button>
          <button type="button" className={`m3d-btn${mapMode ? " active" : ""}`} aria-pressed={mapMode} onClick={toggleMapMode}>
            MAP
          </button>
          <button
            type="button"
            className="m3d-btn"
            onClick={handleCompare}
            title={compareAvailable ? "Compare saved routes" : "Save at least two routes to compare"}
          >
            COMPARE
          </button>
          <button type="button" className="m3d-btn" onClick={onOpenSnapshot} disabled={!snapshotAvailable}>
            USGS SNAPSHOT
          </button>
          <button
            type="button"
            className={`m3d-btn m3d-pez${sidePanel === "pez" ? " active" : ""}`}
            aria-pressed={sidePanel === "pez"}
            onClick={() => togglePanel("pez")}
          >
            POTENTIAL EXPLORATION ZONE
          </button>
          <button
            type="button"
            className={`m3d-btn${sidePanel === "routes" ? " active" : ""}`}
            aria-pressed={sidePanel === "routes"}
            onClick={() => togglePanel("routes")}
            title="Saved routes on the 3D globe"
          >
            <Icon name="route" size={14} /> ROUTES ({savedRoutes.length})
          </button>
          <button
            type="button"
            className={`m3d-btn m3d-projection${projection ? " active" : ""}`}
            aria-pressed={projection}
            onClick={toggleProjection}
            disabled={!savedRoutes.length}
            title={savedRoutes.length ? "Project the selected saved routes on the globe" : "Save a route first"}
          >
            <Icon name="globe" size={14} /> ROUTE PROJECTION{projection ? ` (${projectedRoutes.length})` : ""}
          </button>
          {Object.entries(FLY_TARGETS).map(([key, t]) => (
            <button key={key} type="button" className="m3d-btn" onClick={() => smoothFlyTo(t.lat, t.lon, t.km)} title={`Fly to ${t.label}`}>
              <Icon name="fly" size={14} /> {t.label}
            </button>
          ))}
          <button type="button" className="m3d-btn" onClick={flyToCorridor} disabled={routePoints.length < 2} title={routePoints.length < 2 ? "Plan a route first" : "Fly along the route corridor"}>
            <Icon name="fly" size={14} /> ROUTE
          </button>
          <button
            type="button"
            className={`m3d-btn${sidePanel === "layers" ? " active" : ""}`}
            aria-pressed={sidePanel === "layers"}
            onClick={() => togglePanel("layers")}
          >
            <Icon name="layers" size={14} /> LAYERS
          </button>
          <button
            type="button"
            className={`m3d-btn${sidePanel === "legend" ? " active" : ""}`}
            aria-pressed={sidePanel === "legend"}
            onClick={() => togglePanel("legend")}
          >
            <Icon name="list" size={14} /> LEGEND
          </button>
          <select
            className="m3d-btn m3d-select"
            value={tool}
            onChange={(event) => startTool(event.target.value)}
            disabled={!ready}
            aria-label="Measurement tool"
          >
            <option value="">MEASURE…</option>
            <option value="distance">DISTANCE</option>
            <option value="area">AREA</option>
            <option value="profile">ELEVATION PROFILE</option>
          </select>
          <button type="button" className="m3d-btn" onClick={() => setFullscreen((v) => !v)}>
            {fullscreen ? "EXIT FULL SCREEN" : "⤢ FULL SCREEN"}
          </button>
          <button type="button" className="m3d-btn m3d-close" onClick={onClose} aria-label="Close 3D map">
            ×
          </button>
        </nav>
      </header>

      <div className="m3d-body">
        <div className="m3d-view" ref={containerRef} />
        <div className="m3d-labels" ref={labelContainerRef} aria-hidden="true" />

        {!ready && !loadError && <div className="m3d-status">LOADING ARCGIS MARS SCENE…</div>}
        {loadError && <div className="m3d-status m3d-error">3D VIEW UNAVAILABLE — {loadError}</div>}
        {toast && (
          <div className="m3d-toast" role="status">
            {toast}
          </div>
        )}
        {routeMode && !toast && <div className="m3d-toast">ROUTE MODE — clicks on the 3D surface add waypoints to the route editor.</div>}

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
            {info.zone ? (
              <ZoneDetail zone={info.zone} />
            ) : (
              Object.entries(info.attributes ?? {})
                .filter(([k, v]) => v !== null && v !== "" && !/^(OBJECTID|FID|Shape|GlobalID|oid|idx|tier)/i.test(k))
                .slice(0, 10)
                .map(([k, v]) => (
                  <div key={k}>
                    <b>{k}</b> {String(v)}
                  </div>
                ))
            )}
          </div>
        )}

        <footer className="m3d-readout">
          {readout ? (
            <>
              <span>LAT {fmt(readout.lat, 4, "°")}</span>
              <span>LON {fmt(readout.lon, 4, "°E")}</span>
              <span>ELEV {readout.z == null ? "UNAVAILABLE" : `${Math.round(readout.z)} m`}</span>
              {readout.name && <span className="m3d-hover-name">{readout.name}</span>}
            </>
          ) : (
            <span>MOVE OVER THE SURFACE FOR COORDINATES</span>
          )}
          <span className="m3d-hint">DRAG ROTATE · RIGHT-DRAG TILT · WHEEL ZOOM · CLICK SELECT</span>
        </footer>

        {sidePanel === "legend" && (
          <aside className="m3d-panel" aria-label="3D map legend">
            <header>
              <span>MAP LEGEND</span>
              <button type="button" onClick={() => setSidePanel(null)} aria-label="Close legend">
                ×
              </button>
            </header>
            <Mars3DLegend visible={visible} traverses={traverses} candidateRoutes={candidateRoutes} onFlyTo={flyTo} />
          </aside>
        )}

        {sidePanel === "routes" && (
          <aside className="m3d-panel m3d-routes" aria-label="Saved routes">
            <header>
              <span>SAVED ROUTES ({savedRoutes.length})</span>
              <button type="button" onClick={() => setSidePanel(null)} aria-label="Close saved routes">
                ×
              </button>
            </header>
            {savedRoutes.length === 0 ? (
              <p className="m3d-routes-empty">No saved routes yet. Plan a route in the 2D map's route editor and press SAVE ROUTE.</p>
            ) : (
              <>
                {projection && (
                  <div className="m3d-projection-bar">
                    <span>ROUTE PROJECTION ON · tick routes to project them</span>
                    <button type="button" onClick={() => setProjectedIds(new Set(savedRoutes.map((r) => r.id)))}>
                      PROJECT ALL
                    </button>
                    <button type="button" onClick={() => setProjectedIds(new Set())}>
                      CLEAR
                    </button>
                    <button type="button" onClick={() => flyToRoutes(projectedRoutes)} disabled={!projectedRoutes.length}>
                      REFRAME
                    </button>
                  </div>
                )}
                <div className="m3d-routes-bulk">
                  <button type="button" onClick={() => setHiddenRoutes(new Set())}>
                    SHOW ALL
                  </button>
                  <button type="button" onClick={() => setHiddenRoutes(new Set(savedRoutes.map((r) => r.id)))}>
                    HIDE ALL
                  </button>
                </div>
                <ul>
                  {savedRoutes.map((route) => {
                    const stats = routeStatsFor(route) ?? {};
                    const inCompare = compareRouteIds.includes(route.id);
                    const hidden = hiddenRoutes.has(route.id);
                    const n = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v).toFixed(d) : "–");
                    return (
                      <li key={route.id} className={hidden ? "is-hidden" : ""}>
                        <div className="m3d-route-name">
                          {projection && (
                            <input
                              type="checkbox"
                              className="m3d-project-check"
                              checked={projectedIds.has(route.id)}
                              onChange={() => toggleProjected(route.id)}
                              aria-label={`Project ${route.name}`}
                              style={{ accentColor: route.colour }}
                            />
                          )}
                          <span className="m3d-route-swatch" style={{ background: route.colour }} />
                          <strong>{route.name}</strong>
                          {route.generation?.source === "ai-route-designer" && <em className="m3d-route-ai">AI</em>}
                          <small>{n(stats.distanceKm, 1)} km</small>
                        </div>
                        <div className="m3d-route-stats">
                          ELEV {n(stats.elevation_m?.min)}/{n(stats.elevation_m?.mean)}/{n(stats.elevation_m?.max)} m · SLOPE {n(stats.slope_deg?.min, 1)}/
                          {n(stats.slope_deg?.mean, 1)}/{n(stats.slope_deg?.max, 1)}° · ROUGH {n(stats.roughness_m?.mean, 1)} m mean
                          {stats.status === "waypoints-only" ? " · waypoints only" : ""}
                        </div>
                        <div className="m3d-route-actions">
                          <button type="button" onClick={() => toggleRouteVisibility(route.id)} aria-pressed={!hidden} title="Show / hide">
                            {hidden ? "SHOW" : "HIDE"}
                          </button>
                          <button type="button" onClick={() => flyToRoute(route)} title="Fly to route">
                            <Icon name="fly" size={14} /> FLY
                          </button>
                          <button type="button" className={inCompare ? "active" : ""} onClick={() => onToggleCompareRoute?.(route.id)} title="Add to / remove from comparison">
                            {inCompare ? "IN COMPARE" : "COMPARE"}
                          </button>
                          <button type="button" onClick={() => onSnapshotRoute?.(route.id)} title="USGS snapshot of this route">
                            USGS
                          </button>
                          <button type="button" onClick={() => onRenameRoute?.(route.id)} title="Rename">
                            <Icon name="edit" size={14} title="Rename" />
                          </button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
                <button type="button" className="m3d-btn m3d-primary m3d-compare-go" onClick={handleCompare} disabled={compareRouteIds.length < 2}>
                  COMPARE SELECTED ({compareRouteIds.length}/4)
                </button>
              </>
            )}
          </aside>
        )}

        {sidePanel === "pez" && (
          <aside className="m3d-panel" aria-label="Potential Exploration Zones">
            <header>
              <span>POTENTIAL EXPLORATION ZONES</span>
              <button type="button" onClick={() => setSidePanel(null)} aria-label="Close zones">
                ×
              </button>
            </header>
            <p className="m3d-pez-label">
              <Tag status="DERIVED" /> DERIVED — NEURONEXUS · not an official NASA zone · not certified safe · no guaranteed habitability or confirmed
              resource.
            </p>
            {!zones.data && !zones.error && <p className="m3d-muted">Evaluating bounded MOLA windows…</p>}
            {zones.error && <p className="m3d-error-text">Zones unavailable — {zones.error}</p>}
            {zoneList.map((z) => (
              <div key={`${z.name}-${z.latitude_deg}`} className="m3d-zone">
                <div className="m3d-zone-head">
                  <strong>{z.name}</strong>
                  <Tag status={z.status === "DERIVED" ? "DERIVED" : z.status === "UNAVAILABLE" ? "UNAVAILABLE" : "DERIVED"} />
                </div>
                <ZoneDetail zone={z} compact />
                <button type="button" className="m3d-btn" onClick={() => flyTo(z.latitude_deg, z.longitude_deg, 260)}>
                  FLY TO
                </button>
              </div>
            ))}
            {zones.data?.method && <small>{zones.data.method}</small>}
          </aside>
        )}

        {sidePanel === "layers" && (
          <aside className="m3d-panel" aria-label="3D map layers and site science">
            <header>
              <span>FILTER / LAYERS</span>
              <button type="button" onClick={() => setSidePanel(null)} aria-label="Close layers">
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
                    {LAYER_LEDGER[l.key] && <SourceTag ledgerId={LAYER_LEDGER[l.key]} compact />}
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
                    {traverses.status !== "ok" && (
                      <button type="button" className="m3d-link" onClick={() => setTraverses(null)}>
                        RETRY
                      </button>
                    )}
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
                        <b>Elevation</b> {fmt(terrain?.elevation_m, 0, " m")} · <b>Slope</b> {fmt(terrain?.slope_deg, 2, "°")} · <b>Aspect</b>{" "}
                        {fmt(terrain?.aspect_deg, 1, "°")} · <b>Roughness</b> {fmt(terrain?.roughness_m, 1, " m")} <Tag status="OBSERVED" />
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

function cellPolygon(c) {
  return {
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
  };
}

function ZoneDetail({ zone, compact = false }) {
  if (zone.status === "UNAVAILABLE") {
    return <p className="m3d-muted">{zone.reason}</p>;
  }
  return (
    <div className="m3d-zone-detail">
      <div>
        <b>Classification</b> {zone.classification}
      </div>
      <div>
        <b>Context</b> {zone.context}
      </div>
      <div>
        <b>Candidate area</b> {fmt(zone.candidate_area_km2, 0, " km²")} ({fmt((zone.candidate_fraction ?? 0) * 100, 0, "%")} of the ±
        {zone.window_half_width_km} km window)
      </div>
      <div>
        <b>Mean walkability / slope / roughness</b> {fmt(zone.mean_walkability, 1)} / {fmt(zone.mean_slope_deg, 2, "°")} /{" "}
        {fmt(zone.mean_roughness_m, 1, " m")}
      </div>
      <div>
        <b>Mean elevation</b> {fmt(zone.mean_elevation_m, 0, " m")} · <b>30–50° ice-study band</b> {zone.in_ice_study_latitude_band ? "YES" : "NO"}
      </div>
      {!compact && <small>{zone.source}</small>}
    </div>
  );
}
