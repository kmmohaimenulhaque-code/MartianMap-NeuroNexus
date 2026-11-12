import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";

import MarsMap from "./components/mars/MarsMap";
import MarsTopographicMap from "./components/mars/MarsTopographicMap";

import AiRouteDesigner from "./components/route/AiRouteDesigner";
import UsgsRouteSnapshot from "./components/mars/UsgsRouteSnapshot";
import OrbitalTrackingPanel from "./components/mission/OrbitalTrackingPanel";
import MarsIntelligence from "./components/mission/MarsIntelligence";

import RouteComparisonWorkspace, { MAX_COMPARE_ROUTES } from "./route/RouteComparisonWorkspace";
import CommandIndex from "./command/CommandIndex";
import { SHORTCUTS, TEAM_URL, buildRegistry } from "./features/registry";
import {
  STORAGE_KEY_V4,
  comparisonToCsv,
  evaluationFromResponse,
  geometryHash,
  loadSavedRoutes,
  nextColourIndex,
  routeColour,
  routeStats,
} from "./utils/savedRoutes";

import {
  askMarsIntelligence,
  evaluateRoute,
  fetchDustSeries,
  fetchProvenanceLedger,
  fetchAiStatus,
  fetchEnvironmentByCoordinate,
  fetchEnvironmentByPlace,
  fetchOrbitalTracking,
  fetchPlaceSuggestions,
  fetchPlaces,
  fetchRoutePlan,
  fetchUsgsMultiRouteSnapshot,
  fetchUsgsRouteSnapshot,
  fetchUsgsSync,
  generateRouteCandidates,
  requestRouteAnalysis,
} from "./services/marsEnvironmentApi";

import { DEFAULT_MISSION_PROFILE, buildMissionConsoleState, safeHavenRelationship } from "./utils/missionConsole";
import { CANDIDATE_COLOURS } from "./utils/routeObjectives";
import { EXPORT_SCHEMA, exportFilename, missionToCsv, routeToCsv } from "./utils/missionExport";
import { buildThermalPanel } from "./utils/thermalPanel";
import BrowserOptimizationPanel from "./components/BrowserOptimizationPanel";
import { perfStore } from "./perf/perfStore";
import { usePerfSettings } from "./perf/usePerf";
import { SolProvider } from "./state/SolContext";
import RadialFeatureWheel from "./components/RadialFeatureWheel";
import { buildConsoleHandlers } from "./features/consoleHandlers";
import CategorizedLayersMenu from "./components/CategorizedLayersMenu";
import DynamicMapLegend from "./components/DynamicMapLegend";
import ContextLayers from "./components/mars/ContextLayers";
import { useContextLayerData } from "./components/mars/useContextLayerData";
import { layerStore, useLayers } from "./components/layers/layerStore";
import { DEMOS } from "./components/manualContent";
import SourcesDrawer from "./sources/SourcesDrawer";
import { SourcesContext } from "./sources/SourcesContext";

import { MAX_CHECKLIST_POINTS, MAX_CHECKLIST_WORDS, MAX_ROUTE_POINTS, countWords, createId, downloadTextFile, isNetworkFailure, normaliseLocation, normaliseLongitude, probeBackend, readStorage, writeStorage } from "./utils/appHelpers";
import MissionMenu from "./components/console/MissionMenu";
import RouteConsole from "./components/console/RouteConsole";
import RightColumn from "./components/console/RightColumn";
import EvidenceBar from "./components/console/EvidenceBar";
import LeftColumn from "./components/console/LeftColumn";
import TopBar from "./components/console/TopBar";
import SearchBar from "./components/console/SearchBar";
import ArcgisLayeredMap from "./components/mars/ArcgisLayeredMap";
import ScrollJumpButton from "./components/console/ScrollJumpButton";
import ErrorBoundary from "./ui/ErrorBoundary";
import { decodePlanLink } from "./marswalk/planLink";
import MobileDock, { MapViewToggle, SheetHead } from "./components/mobile/MobileDock";
import { mobileUi as mobileUiStore, useMobileUi } from "./components/mobile/mobileStore";

import "./ui/tokens.css";
import "./App.css";
import "./ui/ui.css";
import "./ui/responsive.css";

const loadMarswalk = () => import("./marswalk/MarswalkView");
const loadGlobe = () => import("./components/mars3d/Mars3DView");
const loadManual = () => import("./components/MissionManualDrawer");
const MarswalkView = lazy(loadMarswalk);
const Mars3DView = lazy(loadGlobe);
const MissionManualDrawer = lazy(loadManual);

const DEFAULT_PLACE = "Gale";
const DEFAULT_SOL = 100;
const MAX_SOL = 668;


const STORAGE_KEYS = {
  routes: STORAGE_KEY_V4,
  sol: "neuronexus.consoleSol.v1",
  customPlaces: "neuronexus.customPlaces.v2",
  safeHavens: "neuronexus.safeHavens.v2",
  todo: "neuronexus.missionTodo.v2",
  checklist: "neuronexus.missionChecklist.v2",
  missionProfile: "neuronexus.missionProfile.v1",
  routeObjectives: "neuronexus.routeObjectives.v1",
};

const DEFAULT_OBJECTIVE_WEIGHTS = {
  eva: 25,
  terrain: 25,
  science: 25,
  operational: 25,
};

const DEFAULT_EVA_PACE_KMH = 2.5;
const DEFAULT_ASCENT_ALLOWANCE_M_PER_H = 600;
const APP_VERSION = "2.0.0";
const USGS_SYNC_HALF_WIDTH_KM = 40;


export default function App() {
  // A shared MARSWALK plan link (#mw=...) opens MARSWALK and replans that request.
  const [sharedPlan] = useState(() => decodePlanLink(typeof window === "undefined" ? "" : window.location.hash));
  const [appMode, setAppMode] = useState(() => (sharedPlan || readStorage("nn.appMode", "global") === "marswalk" ? "marswalk" : "global"));
  const [marswalkDemo, setMarswalkDemo] = useState({ key: 0, demo: sharedPlan });
  const [manualOpen, setManualOpen] = useState(false);
  const [legendOpen, setLegendOpen] = useState(false);
  // Shared by the 2D map, the ArcGIS view and the 3D globe (components/layers/layerStore.js).
  const { visibility: layerVisibility } = useLayers();
  const setLayerVisibility = layerStore.setVisibility;
  const [sourcesDrawer, setSourcesDrawer] = useState({ open: false, focusId: null });
  const sourcesContext = useMemo(() => ({ openSources: (focusId) => setSourcesDrawer({ open: true, focusId }) }), []);

  useEffect(() => {
    writeStorage("nn.appMode", appMode);
  }, [appMode]);

  const perf = usePerfSettings();
  const [globeWasOpen, setGlobeWasOpen] = useState(false);

  useEffect(() => {
    // With lazy loading off, fetch the heavy chunks right away so they open instantly.
    if (!perf.toggles.lazyHeavyViews) [loadMarswalk, loadGlobe, loadManual].forEach((load) => load());
  }, [perf.toggles.lazyHeavyViews]);


  const [places, setPlaces] = useState([]);

  const [query, setQuery] = useState("");

  const [suggestions, setSuggestions] = useState([]);

  const [selectedFeature, setSelectedFeature] = useState(null);

  const [activeCustomPlace, setActiveCustomPlace] = useState(null);

  const [selectedLocation, setSelectedLocation] = useState(null);

  const [environment, setEnvironment] = useState(null);

  const [loading, setLoading] = useState(true);

  const [error, setError] = useState("");

  const [backendConnected, setBackendConnected] = useState(false);

  const [routeMode, setRouteMode] = useState(false);

  const [routePoints, setRoutePoints] = useState([]);

  const [routePlan, setRoutePlan] = useState(null);

  const [routeLoading, setRouteLoading] = useState(false);

  const [customPlaces, setCustomPlaces] = useState(() => readStorage(STORAGE_KEYS.customPlaces, []));

  const [safeHavens, setSafeHavens] = useState(() => readStorage(STORAGE_KEYS.safeHavens, []));

  const [savedRoutes, setSavedRoutes] = useState(() => loadSavedRoutes());

  const [sol, setSolState] = useState(() => {
    const stored = Number(readStorage(STORAGE_KEYS.sol, DEFAULT_SOL));
    return Number.isInteger(stored) && stored >= 1 && stored <= MAX_SOL ? stored : DEFAULT_SOL;
  });

  const [dustPlaying, setDustPlaying] = useState(false);

  const [commandIndex, setCommandIndex] = useState({ open: false, tab: "commands" });

  const [requested3dPanel, setRequested3dPanel] = useState(null);

  const [notice, setNotice] = useState("");

  const [compareRouteIds, setCompareRouteIds] = useState([]);

  const [comparisonOpen, setComparisonOpen] = useState(false);


  const [todoText, setTodoText] = useState(() => readStorage(STORAGE_KEYS.todo, ""));

  const [checklist, setChecklist] = useState(() => readStorage(STORAGE_KEYS.checklist, []));

  /*
   * SHARED SPATIAL MISSION STATE (v2)
   *
   * App.jsx remains the single source of truth. The coloured map, the USGS
   * scientific map, the AI route designer, the Crewed Mars Console, the
   * orbital tracker, Mars Intelligence and both exports all read from here.
   */
  const [missionProfile, setMissionProfile] = useState(() => readStorage(STORAGE_KEYS.missionProfile, DEFAULT_MISSION_PROFILE));

  const [objectiveWeights, setObjectiveWeights] = useState(() => readStorage(STORAGE_KEYS.routeObjectives, DEFAULT_OBJECTIVE_WEIGHTS));

  const [evaPaceKmh, setEvaPaceKmh] = useState(DEFAULT_EVA_PACE_KMH);

  const [ascentAllowance, setAscentAllowance] = useState(DEFAULT_ASCENT_ALLOWANCE_M_PER_H);

  const [includeScience, setIncludeScience] = useState(true);

  const [routeMetrics, setRouteMetrics] = useState(null);

  const [designerOpen, setDesignerOpen] = useState(false);

  const [map3dOpen, setMap3dOpen] = useState(false);
  // USGS panel: the NeuroNexus ArcGIS view with the shared layers ("layered") or the USGS geologic web app ("app").
  const [usgsView, setUsgsView] = useState(() => (readStorage("nn.usgsView", "layered") === "app" ? "app" : "layered"));
  useEffect(() => writeStorage("nn.usgsView", usgsView), [usgsView]);

  const switchMode = useCallback(
    (next) => {
      if (next === appMode) return;
      // Suspend the 3D globe's WebGL context while planning in MARSWALK; reopen it (same camera) on return.
      if (next === "marswalk" && perfStore.enabled("suspendWebGL") && map3dOpen) {
        setGlobeWasOpen(true);
        setMap3dOpen(false);
      }
      if (next === "global" && globeWasOpen) {
        setGlobeWasOpen(false);
        setMap3dOpen(true);
      }
      setAppMode(next);
    },
    [appMode, map3dOpen, globeWasOpen],
  );

  /* LAYERS "link" rows: go to where that information lives (MARSWALK, the USGS app, a left-panel card). */
  const handleLayerLink = useCallback(
    (action) => {
      if (action === "marswalk") return switchMode("marswalk");
      if (action === "usgs") setUsgsView("app");
      const target = { usgs: "panel-usgs-map", thermal: "panel-thermal", solar: "panel-solar" }[action];
      if (window.matchMedia?.("(max-width: 767px)").matches) {
        if (action === "usgs") mobileUiStore.setMapView("usgs");
        else mobileUiStore.setSheet("intel");
      }
      document.getElementById(target)?.scrollIntoView({ behavior: "smooth", block: "center" });
      return undefined;
    },
    [switchMode],
  );

  const startDemo = useCallback(
    (demoId) => {
      const demo = DEMOS[demoId];
      if (!demo) return;
      setManualOpen(false);
      switchMode("marswalk");
      setMarswalkDemo((current) => ({ key: current.key + 1, demo }));
    },
    [switchMode],
  );

  const [designStart, setDesignStart] = useState(null);

  const [designDestination, setDesignDestination] = useState(null);

  const [routeCandidates, setRouteCandidates] = useState(null);

  const [candidatesLoading, setCandidatesLoading] = useState(false);

  const [candidatesError, setCandidatesError] = useState("");

  const [selectedCandidateId, setSelectedCandidateId] = useState(null);

  const [routeAnalysis, setRouteAnalysis] = useState(null);

  const [analysisLoading, setAnalysisLoading] = useState(false);

  const [usgsSync, setUsgsSync] = useState({ key: null, url: null, extent: null, error: "" });

  const [snapshotOpen, setSnapshotOpen] = useState(false);

  const [snapshot, setSnapshot] = useState(null);

  const [snapshotLoading, setSnapshotLoading] = useState(false);

  const [snapshotError, setSnapshotError] = useState("");

  const [orbitalOpen, setOrbitalOpen] = useState(false);

  const [orbitalData, setOrbitalData] = useState(null);

  const [orbitalLoading, setOrbitalLoading] = useState(false);

  const [orbitalError, setOrbitalError] = useState("");

  const [orbitalHorizon, setOrbitalHorizon] = useState(365);

  const [intelligenceOpen, setIntelligenceOpen] = useState(false);

  const [aiStatus, setAiStatus] = useState(null);

  useEffect(() => {
    writeStorage(STORAGE_KEYS.customPlaces, customPlaces);
  }, [customPlaces]);

  useEffect(() => {
    writeStorage(STORAGE_KEYS.safeHavens, safeHavens);
  }, [safeHavens]);

  useEffect(() => {
    writeStorage(STORAGE_KEYS.routes, savedRoutes);
  }, [savedRoutes]);

  /* ---------------------------------------------------------------- CONSOLE SOL */

  const setSol = useCallback(
    (value) =>
      setSolState((current) => {
        const next = typeof value === "function" ? value(current) : value;
        return Math.min(MAX_SOL, Math.max(1, Math.round(Number(next) || 1)));
      }),
    [],
  );

  const mapPanelScrollRef = useRef(null);
  const mobileUi = useMobileUi();
  const selectionKeyRef = useRef(null);
  const selectionKey = selectedLocation ? `${selectedLocation.latitude_deg},${selectedLocation.longitude_deg}` : null;

  useEffect(() => {
    selectionKeyRef.current = selectionKey;
  }, [selectionKey]);
  const solInitialised = useRef(false);

  /*
   * The sol drives the environment (dust, solar geometry, assessment). The
   * dust panel updates instantly from its cached series; the full
   * environment is refetched once the sol settles.
   */
  useEffect(() => {
    writeStorage(STORAGE_KEYS.sol, sol);
    if (!solInitialised.current) {
      solInitialised.current = true;
      return undefined;
    }
    if (!selectedLocation) return undefined;
    const key = selectionKey;
    const feature = selectedFeature;
    const location = selectedLocation;
    const timer = window.setTimeout(
      async () => {
        try {
          const response = feature
            ? await fetchEnvironmentByPlace(feature.feature_name, sol)
            : await fetchEnvironmentByCoordinate(location.latitude_deg, location.longitude_deg, sol);
          if (selectionKeyRef.current === key) setEnvironment(response);
        } catch (err) {
          setError(err.message);
        }
      },
      dustPlaying ? 1500 : 350,
    );
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sol]);

  /* ---------------------------------------------------------------- SAVED ROUTE EVALUATION */

  /*
   * Every saved route gets one deterministic along-track evaluation
   * (POST /routes/evaluate with an elevation profile), one route at a time.
   */
  const evaluatingRef = useRef(false);

  useEffect(() => {
    if (evaluatingRef.current) return;
    const next = savedRoutes.find((route) => route.evaluation?.status === "pending");
    if (!next) return;
    evaluatingRef.current = true;
    const patch = (evaluation) => setSavedRoutes((current) => current.map((route) => (route.id === next.id ? { ...route, evaluation } : route)));
    patch({ status: "running" });
    evaluateRoute({
      coordinates: next.points,
      evaPaceKmh,
      ascentAllowanceMPerH: ascentAllowance,
      safeHavens,
      includeScience: false,
      includeProfile: true,
    })
      .then((response) => patch(evaluationFromResponse(response)))
      .catch((err) => patch({ status: "error", error: err.message }))
      .finally(() => {
        evaluatingRef.current = false;
        setSavedRoutes((current) => [...current]);
      });
  }, [savedRoutes, evaPaceKmh, ascentAllowance, safeHavens]);

  useEffect(() => {
    if (!notice) return undefined;
    const timer = window.setTimeout(() => setNotice(""), 6000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    writeStorage(STORAGE_KEYS.todo, todoText);
  }, [todoText]);

  useEffect(() => {
    writeStorage(STORAGE_KEYS.checklist, checklist);
  }, [checklist]);

  useEffect(() => {
    writeStorage(STORAGE_KEYS.missionProfile, missionProfile);
  }, [missionProfile]);

  useEffect(() => {
    writeStorage(STORAGE_KEYS.routeObjectives, objectiveWeights);
  }, [objectiveWeights]);

  /*
   * REAL BACKEND STATUS
   *
   * SYSTEM ONLINE  = /api responds successfully
   * SYSTEM DEGRADED = backend is unreachable or unhealthy
   */
  useEffect(() => {
    let cancelled = false;

    async function checkBackend() {
      const online = await probeBackend();
      if (!cancelled) setBackendConnected(online);
    }

    checkBackend();

    const interval = window.setInterval(checkBackend, 10000);

    return () => {
      cancelled = true;

      window.clearInterval(interval);
    };
  }, []);

  /*
   * IMPORTANT:
   *
   * nearest_feature is NOT selectedFeature.
   *
   * For an unnamed coordinate, the exact coordinate remains
   * the selected identity.
   */
  const namedFeature = environment?.gazetteer?.selected_feature ?? selectedFeature ?? null;

  const displayName = namedFeature?.feature_name ?? activeCustomPlace?.name ?? selectedLocation?.label ?? "UNNAMED LOCATION";

  const displayType = namedFeature?.feature_type ?? (activeCustomPlace ? "USER PLACE" : selectedLocation ? "COORDINATE SELECTION" : "NO LOCATION");

  const thermal = environment?.thermal?.observations?.[0];

  const thermalPanel = buildThermalPanel(environment?.thermal);

  const dust = environment?.dust;

  const terrain = environment?.terrain;

  const solar = environment?.solar;

  const siteScience = environment?.site_science;

  /*
   * TWO MAPS, ONE LOCATION
   *
   * Any selection · coordinate click, named USGS feature, custom place or
   * Safe Haven · moves the USGS scientific map to the same coordinate via the
   * supported ArcGIS extent URL parameter. A failure is reported, never faked.
   */
  const usgsSyncKey = selectedLocation ? `${selectedLocation.latitude_deg},${selectedLocation.longitude_deg}` : null;

  useEffect(() => {
    if (!usgsSyncKey) {
      return undefined;
    }

    let cancelled = false;
    const [latitude, longitude] = usgsSyncKey.split(",").map(Number);

    fetchUsgsSync(latitude, longitude, USGS_SYNC_HALF_WIDTH_KM)
      .then((response) => {
        if (!cancelled) {
          setUsgsSync({ key: usgsSyncKey, url: response.url, extent: response.extent, error: "" });
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setUsgsSync({ key: usgsSyncKey, url: null, extent: null, error: err.message });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [usgsSyncKey]);

  /* Sync status is derived, so no state is written during render or effects. */
  const usgsSyncStatus = !usgsSyncKey ? "idle" : usgsSync.key !== usgsSyncKey ? "loading" : usgsSync.error ? "error" : "ok";

  useEffect(() => {
    let cancelled = false;
    fetchAiStatus()
      .then((response) => !cancelled && setAiStatus(response))
      .catch(() => !cancelled && setAiStatus({ configured: false }));
    return () => {
      cancelled = true;
    };
  }, []);

  const candidateRoutes = useMemo(
    () =>
      (routeCandidates?.candidates ?? []).map((candidate, index) => ({
        ...candidate,
        colour: CANDIDATE_COLOURS[index % CANDIDATE_COLOURS.length],
      })),
    [routeCandidates],
  );

  const activeRoute = useMemo(() => {
    if (!routePoints.length) {
      return null;
    }
    return {
      id: routePlan ? "current-route" : "route-draft",
      name: routePlan ? "Current analyzed route" : "Route draft",
      coordinates: routePoints,
      metrics: routeMetrics?.metrics ?? null,
      analysed: Boolean(routePlan),
      warnings: routePlan?.guidance?.notes ?? [],
      generation_method: routeMetrics ? "NeuroNexus deterministic evaluation over NASA MOLA 128 ppd" : null,
      eva: { pace_kmh: evaPaceKmh, ascent_allowance_m_per_h: ascentAllowance },
    };
  }, [routePoints, routePlan, routeMetrics, evaPaceKmh, ascentAllowance]);

  const missionConsoleState = useMemo(
    () =>
      buildMissionConsoleState({
        profile: missionProfile,
        sol,
        selection: selectedLocation ? { ...selectedLocation, label: displayName, feature_name: namedFeature?.feature_name ?? null } : null,
        environment,
        route: activeRoute,
        routeCandidates,
        selectedCandidateId,
        savedRoutes,
        safeHavens,
        customPlaces,
        orbitalTracking: orbitalData,
        backendConnected,
      }),
    [
      sol,
      missionProfile,
      selectedLocation,
      displayName,
      namedFeature,
      environment,
      activeRoute,
      routeCandidates,
      selectedCandidateId,
      savedRoutes,
      safeHavens,
      customPlaces,
      orbitalData,
      backendConnected,
    ],
  );

  useEffect(() => {
    let cancelled = false;

    async function initialize() {
      try {
        setLoading(true);

        setError("");

        const [placesResponse, marsResponse] = await Promise.all([fetchPlaces(2052), fetchEnvironmentByPlace(DEFAULT_PLACE, sol)]);

        if (cancelled) {
          return;
        }

        const featureList = placesResponse.features ?? [];

        const initialFeature = marsResponse?.gazetteer?.selected_feature ?? null;

        setPlaces(featureList);

        setEnvironment(marsResponse);

        setSelectedFeature(initialFeature);

        setActiveCustomPlace(null);

        setSelectedLocation(initialFeature ? normaliseLocation(initialFeature, initialFeature.feature_name) : null);

        setQuery(marsResponse?.query?.resolved_name ?? initialFeature?.feature_name ?? DEFAULT_PLACE);

        setBackendConnected(true);
      } catch (err) {
        if (!cancelled) {
          setError(err.message);

          setBackendConnected(false);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    initialize();

    return () => {
      cancelled = true;
    };
    // The initial load uses the stored sol; later sol changes refetch separately.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const value = query.trim();

    if (!value) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- clears derived UI state when its input empties; no cascade
      setSuggestions([]);

      return undefined;
    }

    if (selectedFeature && value.toLowerCase() === String(selectedFeature.feature_name).toLowerCase()) {
      setSuggestions([]);

      return undefined;
    }

    const controller = new AbortController();

    const timer = setTimeout(async () => {
      try {
        const response = await fetchPlaceSuggestions(value, 8);

        if (!controller.signal.aborted) {
          setSuggestions(response.suggestions ?? []);
        }
      } catch {
        if (!controller.signal.aborted) {
          setSuggestions([]);
        }
      }
    }, 180);

    return () => {
      controller.abort();

      clearTimeout(timer);
    };
  }, [query, selectedFeature]);

  async function handleSelectPlace(feature) {
    try {
      setQuery(feature.feature_name);

      setSuggestions([]);

      setSelectedFeature(feature);

      setActiveCustomPlace(null);

      setSelectedLocation(normaliseLocation(feature, feature.feature_name));

      setEnvironment(null);

      setLoading(true);

      setError("");

      const response = await fetchEnvironmentByPlace(feature.feature_name, sol);

      setEnvironment(response);

      const resolvedFeature = response?.gazetteer?.selected_feature ?? feature;

      setSelectedFeature(resolvedFeature);

      setSelectedLocation(normaliseLocation(resolvedFeature, resolvedFeature.feature_name));

      setBackendConnected(true);
    } catch (err) {
      setError(err.message);

      if (isNetworkFailure(err)) {
        setBackendConnected(false);
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleSelectCoordinate(point) {
    const location = normaliseLocation(point, null);

    try {
      setQuery("");

      setSuggestions([]);

      setSelectedFeature(null);

      setActiveCustomPlace(null);

      setSelectedLocation(location);

      setEnvironment(null);

      setLoading(true);

      setError("");

      const response = await fetchEnvironmentByCoordinate(location.latitude_deg, location.longitude_deg, sol);

      /*
       * Do NOT promote nearest_feature.
       *
       * The coordinate is still the selected site.
       */
      setEnvironment(response);

      setBackendConnected(true);
    } catch (err) {
      setError(err.message);

      if (isNetworkFailure(err)) {
        setBackendConnected(false);
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleSelectCustomPlace(place) {
    const location = normaliseLocation(place, place.name);

    try {
      setQuery("");

      setSuggestions([]);

      setSelectedFeature(null);

      setActiveCustomPlace(place);

      setSelectedLocation(location);

      setEnvironment(null);

      setLoading(true);

      setError("");

      const response = await fetchEnvironmentByCoordinate(location.latitude_deg, location.longitude_deg, sol);

      setEnvironment(response);

      setBackendConnected(true);
    } catch (err) {
      setError(err.message);

      if (isNetworkFailure(err)) {
        setBackendConnected(false);
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleSelectSafeHaven(haven) {
    const location = normaliseLocation(haven, haven.name);

    try {
      setQuery("");

      setSuggestions([]);

      setSelectedFeature(null);

      setActiveCustomPlace(null);

      setSelectedLocation(location);

      setEnvironment(null);

      setLoading(true);

      setError("");

      const response = await fetchEnvironmentByCoordinate(location.latitude_deg, location.longitude_deg, sol);

      setEnvironment(response);

      setBackendConnected(true);
    } catch (err) {
      setError(err.message);

      if (isNetworkFailure(err)) {
        setBackendConnected(false);
      }
    } finally {
      setLoading(false);
    }
  }

  function normaliseRoutePoint(point, fallbackLabel = null) {
    return {
      latitude_deg: Number(point.latitude_deg),

      longitude_deg: normaliseLongitude(point.longitude_deg),

      label: point.label ?? fallbackLabel ?? null,
    };
  }

  function handleRoutePointAdd(point) {
    const nextPoint = normaliseRoutePoint(point, point.label ?? null);

    setError("");

    setRoutePlan(null);

    setRouteMetrics(null);

    setRoutePoints((current) => {
      if (current.length >= MAX_ROUTE_POINTS) {
        return current;
      }

      return [
        ...current,
        {
          ...nextPoint,

          label: nextPoint.label || `WP ${current.length + 1}`,
        },
      ];
    });
  }

  function handleAddSelected() {
    if (!selectedLocation || routePoints.length >= MAX_ROUTE_POINTS) {
      return;
    }

    handleRoutePointAdd({
      latitude_deg: selectedLocation.latitude_deg,

      longitude_deg: selectedLocation.longitude_deg,

      label: selectedLocation.label ?? activeCustomPlace?.name ?? namedFeature?.feature_name ?? null,
    });
  }

  function removeLastWaypoint() {
    setRoutePoints((current) => current.slice(0, -1));

    setRoutePlan(null);

    setRouteMetrics(null);
  }

  async function handleAnalyzeRoute() {
    if (routePoints.length < 2) {
      return;
    }

    try {
      setRouteLoading(true);

      setError("");

      const response = await fetchRoutePlan(routePoints);

      setRoutePlan(response);

      /*
       * The same deterministic engine that scores AI candidates also scores
       * manually planned routes, so comparison is like-for-like.
       */
      try {
        const metrics = await evaluateRoute({
          coordinates: routePoints,
          evaPaceKmh,
          ascentAllowanceMPerH: ascentAllowance,
          safeHavens,
          includeScience,
        });
        setRouteMetrics(metrics);
      } catch {
        setRouteMetrics(null);
      }

      setRouteMode(false);

      setBackendConnected(true);
    } catch (err) {
      setRoutePlan(null);

      setRouteMetrics(null);

      setError(err.message);

      if (isNetworkFailure(err)) {
        setBackendConnected(false);
      }
    } finally {
      setRouteLoading(false);
    }
  }

  function toggleRouteMode() {
    /*
     * Starting a new route after an analysed route should
     * always start with a clean waypoint editor.
     */
    setRouteMode((active) => {
      if (!active) {
        setRoutePoints([]);

        setRoutePlan(null);
      }

      return !active;
    });
  }

  function clearRoute() {
    setRoutePoints([]);

    setRoutePlan(null);

    setRouteMode(false);
  }

  function handleCreateUserPlace(point) {
    const latitude = Number(point.latitude_deg ?? point.lat);

    const longitude = normaliseLongitude(point.longitude_deg ?? point.lng);

    const name = String(point.name ?? "").trim();

    if (!name || !Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      return;
    }

    const customPlace = {
      id: createId("place"),

      name,

      latitude_deg: latitude,

      longitude_deg: longitude,

      feature_name: name,

      feature_type: "USER PLACE",

      createdAt: new Date().toISOString(),
    };

    setCustomPlaces((current) => [...current, customPlace]);

    setActiveCustomPlace(customPlace);

    setSelectedFeature(null);

    setSelectedLocation({
      latitude_deg: latitude,

      longitude_deg: longitude,

      label: name,
    });

    setQuery("");

    setSuggestions([]);
  }

  function handleCreateSafeHaven(point) {
    const latitude = Number(point.latitude_deg ?? point.lat);

    const longitude = normaliseLongitude(point.longitude_deg ?? point.lng);

    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      return;
    }

    const fallback = `Safe Haven ${safeHavens.length + 1}`;

    const name = String(point.name ?? "").trim() || fallback;

    const haven = {
      id: createId("haven"),

      name,

      latitude_deg: latitude,

      longitude_deg: longitude,

      createdAt: new Date().toISOString(),
    };

    setSafeHavens((current) => [...current, haven]);
  }

  function handleSavePlace() {
    if (!selectedLocation) {
      return;
    }

    const defaultName = activeCustomPlace?.name ?? selectedLocation.label ?? "Mars location";

    const name = window.prompt("Name this Mars place:", defaultName);

    if (!name?.trim()) {
      return;
    }

    handleCreateUserPlace({
      ...selectedLocation,

      name: name.trim(),
    });
  }

  function handleAddSafeHaven() {
    if (!selectedLocation) {
      return;
    }

    const defaultName = `Safe Haven ${safeHavens.length + 1}`;

    const name = window.prompt("Optional Safe Haven name:", defaultName);

    if (name === null) {
      return;
    }

    handleCreateSafeHaven({
      ...selectedLocation,

      name: name.trim() || defaultName,
    });
  }

  /*
   * Every saved route · manual or AI-designed · is one schema-v3 record with
   * its exact geometry and a `generation` block holding the inputs needed to
   * reproduce it (see verifyRouteReproducibility).
   */
  function promptRouteName(defaultName) {
    const name = window.prompt("Name this route:", defaultName);
    return name?.trim() ? name.trim().slice(0, 80) : null;
  }

  function saveRouteRecord({ name, points, plan = null, generation }) {
    const exactPoints = points.map((point, index) => ({
      latitude_deg: Number(point.latitude_deg),
      longitude_deg: normaliseLongitude(point.longitude_deg),
      label: point.label ?? (index === 0 ? "START" : index === points.length - 1 ? "DESTINATION" : `WP ${index}`),
    }));

    const record = {
      id: createId("route"),
      schema: 3,
      name,
      createdAt: new Date().toISOString(),
      colourIndex: 0,
      points: exactPoints,
      geometryHash: geometryHash(exactPoints),
      // Deep copy so later edits can never mutate a saved route.
      plan: plan ? JSON.parse(JSON.stringify(plan)) : null,
      generation: { ...generation, app_version: APP_VERSION, saved_at: new Date().toISOString() },
      // Filled by the along-track evaluation effect.
      evaluation: { status: "pending" },
    };

    setSavedRoutes((current) => [...current, { ...record, colourIndex: nextColourIndex(current) }]);
    setCompareRouteIds((current) => (current.includes(record.id) || current.length >= MAX_COMPARE_ROUTES ? current : [...current, record.id]));
    return record;
  }

  function candidateGeneration(candidate) {
    return {
      source: "ai-route-designer",
      candidate_id: candidate.id,
      candidate_name: candidate.name,
      objective_basis: candidate.objective_basis ?? null,
      objective_weights: candidate.objective_weights ?? candidate.scoring_weights ?? null,
      algorithm_version: candidate.algorithm_version ?? null,
      request: routeCandidates?.request ?? null,
      request_key: routeCandidates?.requestKey ?? null,
      metrics_at_save: candidate.metrics ?? null,
    };
  }

  function handleSaveRoute() {
    if (routePoints.length < 2) {
      return;
    }

    const name = promptRouteName(`Marswalk ${savedRoutes.length + 1}`);

    if (!name) {
      return;
    }

    // An applied AI candidate that was not edited keeps its AI provenance.
    const candidate = candidateRoutes.find((item) => item.id === selectedCandidateId);
    const unchangedCandidate =
      candidate && geometryHash(candidate.coordinates ?? []) === geometryHash(routePoints.map((p) => ({ ...p, longitude_deg: normaliseLongitude(p.longitude_deg) })));

    saveRouteRecord({
      name,
      points: routePoints,
      plan: routePlan,
      generation: unchangedCandidate
        ? candidateGeneration(candidate)
        : {
            source: "manual",
            method: "user-defined waypoints · haversine geometry · NASA MOLA along-track evaluation",
            eva: { pace_kmh: evaPaceKmh, ascent_allowance_m_per_h: ascentAllowance },
          },
    });

    // Saving finalises the route and clears the editor, so the next route starts independently.
    setRoutePoints([]);
    setRoutePlan(null);
    setRouteMetrics(null);
    setRouteMode(false);
  }

  function handleSaveCandidate(candidate, { name: givenName = null } = {}) {
    if ((candidate.coordinates ?? []).length < 2) return null;
    const name = givenName ?? promptRouteName(candidate.name ?? `AI route ${savedRoutes.length + 1}`);
    if (!name) return null;
    const record = saveRouteRecord({ name, points: candidate.coordinates, generation: candidateGeneration(candidate) });
    setNotice(`Saved "${name}" from the AI Route Designer.`);
    return record;
  }

  function handleSaveAllCandidates() {
    const candidates = routeCandidates?.candidates ?? [];
    if (!candidates.length) return;
    const prefix = window.prompt("Name prefix for the saved candidates:", "AI");
    if (prefix === null) return;
    candidates.forEach((candidate) => handleSaveCandidate(candidate, { name: `${prefix.trim() || "AI"} · ${candidate.name}`.slice(0, 80) }));
    setNotice(`Saved ${candidates.length} AI candidates as named routes (the first ${MAX_COMPARE_ROUTES} are selected for comparison).`);
  }

  function handleRenameRoute(routeId) {
    const route = savedRoutes.find((item) => item.id === routeId);
    if (!route) return;
    const name = promptRouteName(route.name);
    if (!name || name === route.name) return;
    setSavedRoutes((current) => current.map((item) => (item.id === routeId ? { ...item, name } : item)));
  }

  /*
   * Reproducibility check. AI routes: replay the stored /routes/candidates
   * request and compare the same candidate's geometry vertex by vertex.
   * Manual routes: geometry is the stored waypoints themselves; re-run the
   * deterministic along-track evaluation and compare its numbers.
   */
  async function verifyRouteReproducibility(routeId) {
    const route = savedRoutes.find((item) => item.id === routeId);
    if (!route) return;
    const mark = (reproducibility) =>
      setSavedRoutes((current) => current.map((item) => (item.id === routeId ? { ...item, reproducibility } : item)));
    mark({ status: "checking" });
    try {
      let detail;
      let ok;
      const generation = route.generation ?? {};
      if (generation.source === "ai-route-designer" && generation.request) {
        const r = generation.request;
        const replay = await generateRouteCandidates({
          start: r.start,
          destination: r.destination,
          weights: r.weights,
          evaPaceKmh: r.eva_pace_kmh,
          ascentAllowanceMPerH: r.ascent_allowance_m_per_h,
          safeHavens: r.safe_havens ?? [],
          includeScience: r.include_science,
        });
        const match = (replay.candidates ?? []).find((c) => c.id === generation.candidate_id);
        ok = Boolean(match) && geometryHash(match.coordinates ?? []) === route.geometryHash;
        detail = !match
          ? `Candidate ${generation.candidate_id} not returned by the engine (${replay.candidates?.[0]?.algorithm_version ?? "unknown version"}).`
          : ok
            ? `Engine regenerated identical geometry (${match.coordinates.length} vertices, ${match.algorithm_version}).`
            : `Engine ${match.algorithm_version} now returns different geometry (saved with ${generation.algorithm_version}).`;
      } else {
        const response = await evaluateRoute({
          coordinates: route.points,
          evaPaceKmh: generation.eva?.pace_kmh ?? evaPaceKmh,
          ascentAllowanceMPerH: generation.eva?.ascent_allowance_m_per_h ?? ascentAllowance,
          safeHavens,
          includeScience: false,
          includeProfile: true,
        });
        const fresh = evaluationFromResponse(response);
        const before = route.evaluation ?? {};
        const same = (a, b) => a === b || (Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) < 1e-6);
        ok = same(fresh.distanceKm, before.distanceKm) && same(fresh.slope_deg?.max, before.slope_deg?.max) && same(fresh.elevation_m?.mean, before.elevation_m?.mean);
        detail = ok
          ? `Stored waypoints re-evaluated to identical MOLA statistics (${fresh.sampleCount} samples).`
          : "Re-evaluation differs from the stored statistics (terrain data or evaluation parameters changed).";
      }
      mark({ status: ok ? "reproduced" : "differs", checkedAt: new Date().toISOString(), detail });
      setNotice(`${route.name}: ${detail}`);
    } catch (err) {
      mark({ status: "error", checkedAt: new Date().toISOString(), detail: err.message });
      setNotice(`${route.name}: reproducibility check failed · ${err.message}`);
    }
  }


  function handleToggleCompareRoute(routeId) {
    setCompareRouteIds((current) => {
      if (current.includes(routeId)) {
        return current.filter((id) => id !== routeId);
      }

      if (current.length >= MAX_COMPARE_ROUTES) {
        return current;
      }

      return [...current, routeId];
    });
  }

  function handleOpenComparison() {
    let ids = compareRouteIds;

    if (ids.length < 2) {
      ids = savedRoutes.slice(0, 2).map((route) => route.id);

      setCompareRouteIds(ids);
    }

    if (ids.length >= 2) {
      setComparisonOpen(true);
    }
  }

  function handleDeleteSavedRoute(routeId) {
    setSavedRoutes((current) => current.filter((route) => route.id !== routeId));

    setCompareRouteIds((current) => current.filter((id) => id !== routeId));
  }

  function handleChecklistTextChange(id, value) {
    setChecklist((current) => {
      const next = current.map((item) =>
        item.id === id
          ? {
              ...item,
              text: value,
            }
          : item,
      );

      const totalWords = countWords(next.map((item) => item.text).join(" "));

      if (totalWords <= MAX_CHECKLIST_WORDS) {
        return next;
      }

      let remaining = MAX_CHECKLIST_WORDS;

      return next.map((item) => {
        const words = item.text.trim().split(/\s+/).filter(Boolean);

        const allowed = words.slice(0, Math.max(0, remaining));

        remaining -= allowed.length;

        return {
          ...item,
          text: allowed.join(" "),
        };
      });
    });
  }

  function handleChecklistToggle(id) {
    setChecklist((current) =>
      current.map((item) =>
        item.id === id
          ? {
              ...item,
              done: !item.done,
            }
          : item,
      ),
    );
  }

  function handleAddChecklistItem() {
    if (checklist.length >= MAX_CHECKLIST_POINTS) {
      return;
    }

    const totalWords = countWords(checklist.map((item) => item.text).join(" "));

    if (totalWords >= MAX_CHECKLIST_WORDS) {
      return;
    }

    setChecklist((current) => [
      ...current,
      {
        id: createId("check"),
        text: "",
        done: false,
      },
    ]);
  }

  function handleRemoveChecklistItem(id) {
    setChecklist((current) => current.filter((item) => item.id !== id));
  }

  /* ---------------------------------------------------------------- AI ROUTE DESIGN */

  /*
   * The 120 km planning-window guard stays exactly as it is · it protects the
   * bounded MOLA sampling. Only the wording is made actionable.
   */
  function friendlyCandidateError(message) {
    const match = /window would be ([\d.]+) km/.exec(message ?? "");
    if (match) {
      return `Start and destination are ${match[1]} km apart, beyond the 120 km bounded planning window. Add an intermediate waypoint and design the legs one at a time, or choose a closer destination.`;
    }
    if (/run git lfs pull|tile/i.test(message ?? "")) {
      return `Terrain tiles for this area are not available locally · ${message}`;
    }
    return message;
  }

  function locationForDesign(label) {
    if (!selectedLocation) {
      return null;
    }
    return {
      latitude_deg: selectedLocation.latitude_deg,
      longitude_deg: selectedLocation.longitude_deg,
      label: selectedLocation.label ?? namedFeature?.feature_name ?? activeCustomPlace?.name ?? label,
    };
  }

  async function handleGenerateCandidates() {
    if (!designStart || !designDestination) {
      return;
    }
    try {
      setCandidatesLoading(true);
      setCandidatesError("");
      setRouteAnalysis(null);

      const request = {
        start: { latitude_deg: Number(designStart.latitude_deg), longitude_deg: Number(designStart.longitude_deg), label: designStart.label ?? null },
        destination: { latitude_deg: Number(designDestination.latitude_deg), longitude_deg: Number(designDestination.longitude_deg), label: designDestination.label ?? null },
        weights: { ...objectiveWeights },
        eva_pace_kmh: evaPaceKmh,
        ascent_allowance_m_per_h: ascentAllowance,
        safe_havens: safeHavens.map((h) => ({ id: h.id, name: h.name, latitude_deg: h.latitude_deg, longitude_deg: h.longitude_deg })),
        include_science: includeScience,
      };

      const response = await generateRouteCandidates({
        start: request.start,
        destination: request.destination,
        weights: request.weights,
        evaPaceKmh: request.eva_pace_kmh,
        ascentAllowanceMPerH: request.ascent_allowance_m_per_h,
        safeHavens: request.safe_havens,
        includeScience: request.include_science,
      });

      // The exact request is kept so saved candidates can be regenerated and verified.
      setRouteCandidates({ ...response, request, requestKey: JSON.stringify(request) });
      setSelectedCandidateId(response.candidates?.[0]?.id ?? null);
      setBackendConnected(true);
    } catch (err) {
      setRouteCandidates(null);
      setSelectedCandidateId(null);
      setCandidatesError(friendlyCandidateError(err.message));
      if (isNetworkFailure(err)) {
        setBackendConnected(false);
      }
    } finally {
      setCandidatesLoading(false);
    }
  }

  /*
   * APPLY ROUTE
   *
   * A candidate is copied into the EXISTING route editor as ordinary
   * waypoints. From there ANALYZE / SAVE ROUTE / COMPARE / EXPORT behave
   * exactly as they always have: there is no second routing workflow.
   */
  function handleApplyCandidate(candidate) {
    const points = (candidate.coordinates ?? []).map((point, index) => ({
      latitude_deg: Number(point.latitude_deg),
      longitude_deg: normaliseLongitude(point.longitude_deg),
      label: point.label ?? (index === 0 ? "START" : `WP ${index}`),
    }));

    if (points.length < 2) {
      return;
    }

    setRoutePoints(points.slice(0, MAX_ROUTE_POINTS));
    setRoutePlan(null);
    setRouteMetrics({ status: "ok", metrics: candidate.metrics, methodology: routeCandidates?.methodology });
    setRouteMode(false);
    setSelectedCandidateId(candidate.id);
    setDesignerOpen(false);
    setError("");
  }

  async function handleRequestRouteAnalysis() {
    if (!routeCandidates?.candidates?.length) {
      return;
    }
    try {
      setAnalysisLoading(true);
      const response = await requestRouteAnalysis({
        candidates: routeCandidates.candidates.map((candidate) => ({
          id: candidate.id,
          name: candidate.name,
          objective_basis: candidate.objective_basis,
          objective_weights: candidate.objective_weights ?? candidate.scoring_weights,
          generation_method: candidate.generation_method,
          pareto_label: candidate.pareto_label,
          uncertainties: candidate.uncertainties,
          metrics: candidate.metrics,
        })),
        selected_candidate_id: selectedCandidateId,
        objective_weights: objectiveWeights,
        methodology: routeCandidates.methodology,
        context: {
          site: displayName,
          selection: selectedLocation,
          safe_haven_count: safeHavens.length,
          evidence_status: routeCandidates.evidence_status,
        },
      });
      setRouteAnalysis(response);
    } catch (err) {
      setRouteAnalysis({ status: "error", reason: err.message });
    } finally {
      setAnalysisLoading(false);
    }
  }

  /* ---------------------------------------------------------------- USGS SNAPSHOT */

  function snapshotSubject() {
    const candidate = candidateRoutes.find((item) => item.id === selectedCandidateId);
    if (routePoints.length >= 2) {
      return {
        id: activeRoute?.id,
        name: activeRoute?.name,
        coordinates: routePoints,
        metrics: routeMetrics?.metrics ?? candidate?.metrics ?? null,
        objective_weights: candidate?.objective_weights ?? null,
        generation_method: activeRoute?.generation_method ?? candidate?.generation_method ?? null,
        eva: { pace_kmh: evaPaceKmh, ascent_allowance_m_per_h: ascentAllowance },
        provenance: candidate?.provenance ?? null,
      };
    }
    return candidate ?? null;
  }

  const comparedRoutes = savedRoutes.filter((route) => compareRouteIds.includes(route.id)).map((route) => ({ ...route, colour: routeColour(route) }));

  async function handleOpenSnapshot() {
    // Two or more routes selected for comparison → one USGS frame with all of them.
    const multi = comparedRoutes.length >= 2;
    const subject = multi ? null : snapshotSubject();
    if (!multi && !subject) {
      return;
    }
    setSnapshotOpen(true);
    setSnapshotLoading(true);
    setSnapshotError("");
    try {
      const response = multi ? await fetchUsgsMultiRouteSnapshot(comparedRoutes) : await fetchUsgsRouteSnapshot(subject);
      setSnapshot(multi ? { ...response, route: { name: comparedRoutes.map((r) => r.name).join(" · ") } } : response);
    } catch (err) {
      setSnapshot(null);
      setSnapshotError(err.message);
    } finally {
      setSnapshotLoading(false);
    }
  }


  function handleExportSnapshot() {
    if (!snapshot) {
      return;
    }
    downloadTextFile(exportFilename("usgs-route-snapshot", "json"), JSON.stringify(snapshot, null, 2), "application/json");
  }

  /* ---------------------------------------------------------------- ORBITAL TRACKING */

  async function loadOrbitalTracking(days = orbitalHorizon) {
    try {
      setOrbitalLoading(true);
      setOrbitalError("");
      const response = await fetchOrbitalTracking({ days, distMaxAu: 0.05, limit: 50 });
      setOrbitalData(response);
    } catch (err) {
      setOrbitalData(null);
      setOrbitalError(err.message);
    } finally {
      setOrbitalLoading(false);
    }
  }

  function handleOpenOrbital() {
    setOrbitalOpen(true);
    if (!orbitalData && !orbitalLoading) {
      loadOrbitalTracking();
    }
  }

  function handleOrbitalHorizonChange(days) {
    setOrbitalHorizon(days);
    loadOrbitalTracking(days);
  }

  /* ---------------------------------------------------------------- MARS INTELLIGENCE */

  function buildAiMissionState() {
    return {
      selection: selectedLocation
        ? {
            latitude_deg: selectedLocation.latitude_deg,
            longitude_deg: selectedLocation.longitude_deg,
            label: displayName,
            mode: namedFeature ? "named_feature" : activeCustomPlace ? "user_place" : "coordinate",
            selected_feature: namedFeature,
          }
        : null,
      environment,
      media: { photos: [] },
      route: activeRoute,
      route_candidates: routeCandidates ? { ...routeCandidates, selected_id: selectedCandidateId, evidence_items: undefined } : null,
      sol,
      saved_routes: savedRoutes.map((route) => {
        const stats = routeStats(route);
        return {
          id: route.id,
          name: route.name,
          coordinates: route.points,
          statistics_basis: stats.status === "waypoints-only" ? "waypoints only" : "along-track NASA MOLA sampling",
          metrics: {
            distance_km: stats.distanceKm,
            estimated_eva_hours: stats.evaHours,
            elevation_min_m: stats.elevation_m?.min,
            mean_elevation_m: stats.elevation_m?.mean,
            elevation_max_m: stats.elevation_m?.max,
            elevation_gain_m: stats.elevation_m?.gain,
            elevation_loss_m: stats.elevation_m?.loss,
            min_slope_deg: stats.slope_deg?.min,
            mean_slope_deg: stats.slope_deg?.mean,
            max_slope_deg: stats.slope_deg?.max,
            min_roughness_m: stats.roughness_m?.min,
            mean_roughness_m: stats.roughness_m?.mean,
            max_roughness_m: stats.roughness_m?.max,
            terrain_risk_proxy: stats.terrainRisk,
            data_support_score: stats.dataSupportPct,
          },
        };
      }),
      safe_havens: safeHavens,
      custom_places: customPlaces,
      mission_console: missionConsoleState,
      provenance: missionConsoleState.provenance,
    };
  }

  async function handleAskIntelligence(messages, options = {}) {
    return askMarsIntelligence({ messages, missionState: buildAiMissionState(), enableSearch: Boolean(options.enableSearch) });
  }

  /* ---------------------------------------------------------------- COMMAND INDEX */

  function scrollToPanel(id) {
    const element = document.getElementById(id);
    if (!element) return;
    element.scrollIntoView({ behavior: "smooth", block: "start" });
    element.classList.add("nn-flash");
    window.setTimeout(() => element.classList.remove("nn-flash"), 1600);
  }

  function requestUsgsSync() {
    if (!selectedLocation) return;
    fetchUsgsSync(selectedLocation.latitude_deg, selectedLocation.longitude_deg, USGS_SYNC_HALF_WIDTH_KM)
      .then((response) => setUsgsSync({ key: usgsSyncKey, url: `${response.url}&t=${Date.now()}`, extent: response.extent, error: "" }))
      .catch((err) => setUsgsSync({ key: usgsSyncKey, url: null, extent: null, error: err.message }));
  }

  function open3dPanel(name) {
    setMap3dOpen(true);
    setRequested3dPanel((current) => ({ name, seq: (current?.seq ?? 0) + 1 }));
  }

  async function handleSnapshotSavedRoute(routeId) {
    const route = savedRoutes.find((item) => item.id === routeId);
    if (!route) return;
    setSnapshotOpen(true);
    setSnapshotLoading(true);
    setSnapshotError("");
    try {
      setSnapshot(await fetchUsgsRouteSnapshot({ id: route.id, name: route.name, coordinates: route.points }));
    } catch (err) {
      setSnapshot(null);
      setSnapshotError(err.message);
    } finally {
      setSnapshotLoading(false);
    }
  }

  function reevaluateRoutes(ids = null) {
    setSavedRoutes((current) => current.map((route) => (!ids || ids.includes(route.id) ? { ...route, evaluation: { status: "pending" } } : route)));
  }

  async function jumpToPeakDust() {
    if (!selectedLocation) return;
    try {
      const series = await fetchDustSeries(selectedLocation.latitude_deg, selectedLocation.longitude_deg);
      setSol(series.stats.peak_sol);
      setNotice(`Sol ${series.stats.peak_sol}: this site's modeled MY34 dust peak (τ ${series.stats.tau.max}).`);
      scrollToPanel("panel-dust");
    } catch (err) {
      setError(err.message);
    }
  }

  async function downloadProvenance() {
    try {
      const ledger = await fetchProvenanceLedger();
      downloadTextFile(exportFilename("data-provenance", "json"), JSON.stringify(ledger, null, 2), "application/json");
    } catch (err) {
      setError(err.message);
    }
  }

  const needSite = () => (selectedLocation ? true : "Select a site first");
  const savedWithColour = savedRoutes.map((route) => ({ ...route, colour: routeColour(route) }));

  const contextLayers = useContextLayerData(appMode === "global" ? layerVisibility : {}, selectedLocation, sol);

  const commandHandlers = {
    "marswalk-mode": { run: () => switchMode(appMode === "marswalk" ? "global" : "marswalk") },
    "browser-optimization": { run: () => setManualOpen(true) },
    "marswalk-demo": { run: () => startDemo("gale") },
    "mission-manual": { run: () => setManualOpen(true) },
    "sources-ledger": { run: () => setSourcesDrawer({ open: true, focusId: null }) },
    "search-place": { run: () => document.querySelector(".search-box input")?.focus() },
    "select-coordinate": { run: () => setNotice("Click any point on the 2D map, the 3D globe or the global dust map to select it.") },
    "save-place": { run: handleSavePlace, available: needSite },
    "add-safe-haven": { run: handleAddSafeHaven, available: needSite },
    "sync-usgs": { run: requestUsgsSync, available: needSite },
    "route-mode": { run: toggleRouteMode },
    "add-selected-waypoint": { run: handleAddSelected, available: needSite },
    "analyze-route": { run: handleAnalyzeRoute, available: () => (routePoints.length >= 2 ? true : "Needs at least 2 waypoints") },
    "remove-last-waypoint": { run: removeLastWaypoint, available: () => (routePoints.length ? true : "No waypoints yet") },
    "clear-route": { run: clearRoute, available: () => (routePoints.length || routePlan ? true : "No route to clear") },
    "save-route": { run: handleSaveRoute, available: () => (routePoints.length >= 2 ? true : "Plan or apply a route with at least 2 waypoints first") },
    "save-candidates": {
      run: handleSaveAllCandidates,
      available: () => (routeCandidates?.candidates?.length ? true : "Generate AI route candidates first"),
    },
    "verify-routes": {
      run: () => savedRoutes.forEach((route) => verifyRouteReproducibility(route.id)),
      available: () => (savedRoutes.length ? true : "No saved routes"),
    },
    "ai-route-design": { run: () => setDesignerOpen(true) },
    "compare-routes": { run: handleOpenComparison, available: () => (savedRoutes.length >= 2 ? true : "Save at least 2 routes") },
    "routes-3d": { run: () => open3dPanel("routes") },
    "route-projection": { run: () => open3dPanel("projection"), available: () => (savedRoutes.length ? true : "Save a route first") },
    "route-snapshot": {
      run: handleOpenSnapshot,
      available: () => (comparedRoutes.length >= 2 || routePoints.length >= 2 || selectedCandidateId ? true : "Plan, apply or select routes for comparison first"),
    },
    "reevaluate-routes": { run: () => reevaluateRoutes(), available: () => (savedRoutes.length ? true : "No saved routes") },
    "mars-intelligence": { run: () => setIntelligenceOpen(true) },
    "hazard-overview": { run: () => scrollToPanel("panel-interpretation") },
    "site-science": { run: () => scrollToPanel("panel-site-science") },
    "dust-panel": { run: () => scrollToPanel("panel-dust") },
    "dust-play": { run: () => setDustPlaying((value) => !value) },
    "sol-next": { run: () => setSol((value) => value + 1) },
    "sol-prev": { run: () => setSol((value) => value - 1) },
    "sol-peak": { run: jumpToPeakDust, available: needSite },
    morphology: { run: () => scrollToPanel("panel-morphology") },
    thermal: { run: () => scrollToPanel("panel-thermal") },
    "map-3d": { run: () => setMap3dOpen(true) },
    "exploration-zones": { run: () => open3dPanel("pez") },
    "focus-usgs": { run: () => scrollToPanel("panel-usgs-map") },
    "crew-console": { run: () => scrollToPanel("panel-crew") },
    "orbital-tracking": { run: handleOpenOrbital },
    "nasa-feed": { run: () => scrollToPanel("panel-feed") },
    "export-json": { run: handleExportJson },
    "export-csv": { run: handleExportCsv },
    "export-route-csv": {
      run: handleExportRouteCsv,
      available: () => (routePoints.length >= 2 || selectedCandidateId || savedRoutes.length ? true : "Plan, apply or save a route first"),
    },
    "export-comparison": {
      run: () => downloadTextFile(exportFilename("route-comparison", "csv"), comparisonToCsv(savedRoutes), "text/csv;charset=utf-8"),
      available: () => (savedRoutes.length ? true : "No saved routes"),
    },
    print: { run: handlePrint },
    provenance: { run: downloadProvenance },
    "field-notes": { run: () => setCommandIndex({ open: true, tab: "notes" }) },
    shortcuts: {
      run: () =>
        setNotice("Ctrl/Cmd+K command index · / search · R route mode · S save route · A route designer · C compare · I intelligence · 3 3D · O orbital · P print · N notes · [ ] sol"),
    },
    "backend-status": { run: () => setNotice(backendConnected ? "Backend online: GET /api/health answered ok." : "Backend unreachable: start it with python tools/run_backend.py (port 8002).") },
    about: { run: () => setCommandIndex({ open: true, tab: "team" }) },
    "meet-the-team": { run: () => window.open(TEAM_URL, "_blank", "noopener,noreferrer") },
    ...buildConsoleHandlers({ appMode, switchMode, setLayerVisibility, setLegendOpen, scrollToPanel, setCommandIndex, setNotice, setSol, setDustPlaying, startDemo }),
  };

  const commandRegistry = buildRegistry(commandHandlers);
  const runCommand = (id) => {
    const command = commandRegistry.find((c) => c.id === id);
    if (command?.ok) command.run();
    else setNotice(command?.reason ?? `Unknown action ${id}`);
  };
  const commandAvailable = (id) => {
    const command = commandRegistry.find((c) => c.id === id);
    return command?.ok ? true : (command?.reason ?? "Not wired");
  };
  const commandRegistryRef = useRef(commandRegistry);

  useEffect(() => {
    commandRegistryRef.current = commandRegistry;
  });

  useEffect(() => {
    function onKeyDown(event) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setCommandIndex((state) => ({ open: !state.open, tab: "commands" }));
        return;
      }
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target;
      if (target?.closest?.("input, textarea, select, [contenteditable='true'], [role='dialog'], .m3d-shell")) return;
      const id = SHORTCUTS[event.key.toLowerCase()];
      const command = id && commandRegistryRef.current.find((c) => c.id === id);
      if (command?.ok) {
        event.preventDefault();
        command.run();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  /*
   * COMPLETE MISSION STATE
   *
   * One object is the source of truth for BOTH exports:
   *   JSON  authoritative, lossless-ish record
   *   CSV   long-form flattening of this same object
   * Nothing reachable here can be silently dropped from the CSV.
   */
  function buildMissionExport() {
    const havenRelationship = safeHavenRelationship(activeRoute, safeHavens);

    return {
      export: {
        schema: EXPORT_SCHEMA,
        project: "NeuroNexus · Interplanetary Survival Guide: Martian Map",
        event: "NASA Space Apps Challenge 2026",
        exported_at: new Date().toISOString(),
        sol,
        backend_connected: backendConnected,
      },

      selection: {
        mode: namedFeature ? "named_feature" : activeCustomPlace ? "user_place" : selectedLocation ? "coordinate" : "none",
        label: displayName,
        type: displayType,
        latitude_deg: selectedLocation?.latitude_deg ?? null,
        longitude_deg: selectedLocation?.longitude_deg ?? null,
        selected_feature: namedFeature,
        custom_place: activeCustomPlace,
        usgs_sync_url: usgsSync.url,
        usgs_sync_status: usgsSyncStatus,
      },

      environment,

      route: activeRoute
        ? {
            ...activeRoute,
            plan: routePlan,
            waypoint_analysis: routePlan?.waypoint_analysis ?? [],
            displacement_km: routePlan?.displacement?.distance_km ?? null,
            planned_route_km: routePlan?.planned_route?.planned_route_km ?? null,
            extension_km: routePlan?.planned_route?.extension_km ?? null,
            evaluation: routeMetrics,
            safe_haven_relationship: havenRelationship,
            eva_pace_kmh: evaPaceKmh,
            ascent_allowance_m_per_h: ascentAllowance,
          }
        : null,

      route_candidates: routeCandidates
        ? {
            ...routeCandidates,
            selected_id: selectedCandidateId,
            objective_weights: objectiveWeights,
            ai_analysis: routeAnalysis?.status === "ok" ? routeAnalysis.analysis : (routeAnalysis ?? null),
          }
        : null,

      saved_routes: savedRoutes,
      safe_havens: safeHavens,
      custom_places: customPlaces,

      mission_console: missionConsoleState,
      mission_profile: missionProfile,

      orbital_tracking: orbitalData,

      usgs_route_snapshot: snapshot
        ? {
            ...snapshot,
            image: snapshot.image ? { ...snapshot.image, data_uri: "[omitted: binary image]" } : null,
            geology: { ...snapshot.geology, polygons: undefined, contacts: undefined, structures: undefined },
          }
        : null,

      mission_notes: { todo: todoText, checklist },

      provenance: {
        usgs_nomenclature: {
          source: "USGS / IAU Gazetteer of Planetary Nomenclature",
          status: "NASA REFERENCE",
          url: "https://planetarynames.wr.usgs.gov/",
        },
        usgs_geology: {
          source: "USGS SIM 3292 Geologic Map of Mars (Tanaka et al., 2014)",
          status: "NASA REFERENCE",
          url: "https://pubs.usgs.gov/sim/3292/",
        },
        themis: { source: "NASA THEMIS IR-PBT historical observations", status: "NASA OBSERVED", url: "https://themis.asu.edu/" },
        mola: {
          source: "NASA MOLA MEGDR 128 pixels/degree",
          status: "NASA OBSERVED",
          url: "https://pds-geosciences.wustl.edu/missions/mgs/megdr.html",
        },
        atmosphere: {
          source: "NASA Ames Mars GCM MY34 dust scenario",
          status: "MODELED",
          url: "https://www.nasa.gov/space-science-and-astrobiology-at-ames/division-overview/planetary-systems-branch-overview-stt/mars-climate-modeling-center-mcmc/",
        },
        rover_media: { source: "NASA Image and Video Library", status: "NASA OBSERVED", url: "https://images.nasa.gov/" },
        orbital: { source: "NASA/JPL SSD Close-Approach Data API", status: "NASA OBSERVED", url: "https://ssd-api.jpl.nasa.gov/doc/cad.html" },
        routing: { source: "NeuroNexus deterministic multi-objective route engine", status: "DERIVED" },
        risk_proxy: { source: "NeuroNexus derived terrain-risk proxy (not certified)", status: "DERIVED" },
        eva: { source: "NeuroNexus estimated EVA time (configurable pace)", status: "DERIVED" },
        mission_simulation: { source: "NeuroNexus mission simulation profile", status: "SIMULATED" },
        ai: { source: `Google Gemini (${aiStatus?.model ?? "not configured"})`, status: "AI INTERPRETATION" },
        note: "Observed, reference, modeled, derived, computed, simulated and unavailable evidence are kept explicitly distinct.",
      },

      software: {
        app_version: APP_VERSION,
        route_engine: routeCandidates?.algorithm_version ?? routeMetrics?.algorithm_version ?? "neuronexus-route-mo 1.0.0",
        ai_model: aiStatus?.model ?? null,
        ai_configured: aiStatus?.configured ?? false,
        export_schema: EXPORT_SCHEMA,
      },
    };
  }

  function handleExportJson() {
    downloadTextFile(exportFilename("mission", "json"), JSON.stringify(buildMissionExport(), null, 2), "application/json");
  }

  /*
   * CSV EXPORT · complete, long-form.
   *
   * Columns: record_type, record_id, parent_id, field, value, unit, status,
   * source, source_url, timestamp, latitude_deg, longitude_deg.
   * Every scalar in the mission JSON becomes a row, so nested THEMIS
   * observations, atmospheric gases, rover metadata, AI candidates and
   * tracking records all survive. RFC 4180 quoting, CRLF, UTF-8 BOM.
   */
  function handleExportCsv() {
    downloadTextFile(exportFilename("mission-complete", "csv"), missionToCsv(buildMissionExport()), "text/csv;charset=utf-8");
  }

  /*
   * ROUTE CSV
   *
   * Exports, in order of preference: the route in the route editor (with its
   * per-waypoint MOLA analysis when analysed), otherwise the highlighted AI
   * candidate (its full terrain-aware path), otherwise the most recently
   * saved route. When there is nothing to export the user is told why,
   * instead of the button silently doing nothing.
   */
  function routeForCsvExport() {
    if (activeRoute?.coordinates?.length >= 2) {
      return { ...activeRoute, waypoint_analysis: routePlan?.waypoint_analysis ?? [] };
    }
    const candidate = candidateRoutes.find((item) => item.id === selectedCandidateId);
    if (candidate?.coordinates?.length >= 2) {
      return { ...candidate, name: candidate.name ?? "AI candidate" };
    }
    const saved = savedRoutes[savedRoutes.length - 1];
    if (saved?.points?.length >= 2) {
      return { id: saved.id, name: saved.name, coordinates: saved.points, waypoint_analysis: saved.plan?.waypoint_analysis ?? [] };
    }
    return null;
  }

  function handleExportRouteCsv() {
    const route = routeForCsvExport();
    if (!route) {
      setError("No route to export yet · plan a route, apply an AI candidate or save a route first.");
      return;
    }
    const slug = String(route.name ?? "route")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40);
    downloadTextFile(exportFilename(`route-${slug || "waypoints"}`, "csv"), routeToCsv(route), "text/csv;charset=utf-8");
  }

  function handlePrint() {
    setCommandIndex((state) => ({ ...state, open: false }));

    window.setTimeout(() => window.print(), 60);
  }

  return (
    <SolProvider sol={sol} setSol={setSol} playing={dustPlaying} setPlaying={setDustPlaying}>
    <SourcesContext.Provider value={sourcesContext}>
    <main className="mission-shell" data-mode={appMode} data-sheet={mobileUi.sheet ?? undefined} data-mapview={mobileUi.mapView}>
      <TopBar
        appMode={appMode}
        backendConnected={backendConnected}
        commandIndex={commandIndex}
        comparedRoutes={comparedRoutes}
        handleOpenOrbital={handleOpenOrbital}
        handleOpenSnapshot={handleOpenSnapshot}
        handleSelectPlace={handleSelectPlace}
        manualOpen={manualOpen}
        places={places}
        query={query}
        routePoints={routePoints}
        selectedCandidateId={selectedCandidateId}
        setCommandIndex={setCommandIndex}
        setDesignerOpen={setDesignerOpen}
        setIntelligenceOpen={setIntelligenceOpen}
        setManualOpen={setManualOpen}
        setQuery={setQuery}
        suggestions={suggestions}
        switchMode={switchMode}
      />

      <CommandIndex
        key={commandIndex.open ? `open-${commandIndex.tab}` : "closed"}
        open={commandIndex.open}
        initialTab={commandIndex.tab}
        onClose={() => setCommandIndex((state) => ({ ...state, open: false }))}
        registry={commandRegistry}
        appVersion={APP_VERSION}
        notesPanel={
            <MissionMenu
                    embedded
                    open
              todoText={todoText}
              setTodoText={setTodoText}
              checklist={checklist}
              onChecklistTextChange={handleChecklistTextChange}
              onChecklistToggle={handleChecklistToggle}
              onAddChecklistItem={handleAddChecklistItem}
              onRemoveChecklistItem={handleRemoveChecklistItem}
              onExportJson={handleExportJson}
              onExportCsv={handleExportCsv}
              onExportRouteCsv={handleExportRouteCsv}
              routeExportAvailable={comparedRoutes.length >= 2 || routePoints.length >= 2 || Boolean(selectedCandidateId) || savedRoutes.length > 0}
              onPrint={handlePrint}
            />
        }
      />

      {notice && (
        <div className="nn-notice" role="status">
          <span>{notice}</span>
          <button type="button" onClick={() => setNotice("")} aria-label="Dismiss">
            ×
          </button>
        </div>
      )}

      {/*
       * Request errors are shown as a floating notice. As an in-flow element the
       * banner took the shell grid's flexible row and pushed the whole
       * workspace (both maps) off-screen, so one failed request blanked the app.
       */}
      {error && (
        <div
          role="alert"
          style={{
            position: "fixed",
            top: "78px",
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 4100,
            maxWidth: "min(760px, calc(100vw - 24px))",
            display: "flex",
            alignItems: "center",
            gap: "10px",
            padding: "8px 10px",
            border: "1px solid rgba(255,138,138,0.32)",
            background: "rgba(36,14,16,0.95)",
            color: "#ffb0b0",
            fontFamily: "var(--nn-font)",
            fontSize: "11px",
            boxShadow: "0 10px 30px rgba(0,0,0,0.45)",
          }}
        >
          <span>REQUEST ERROR · {error}</span>

          <button
            type="button"
            onClick={() => setError("")}
            aria-label="Dismiss error"
            style={{
              border: "1px solid rgba(255,138,138,0.4)",
              background: "transparent",
              color: "#ffb0b0",
              cursor: "pointer",
              fontSize: "11px",
              lineHeight: 1,
              padding: "2px 6px",
            }}
          >
            ×
          </button>
        </div>
      )}

      {appMode === "marswalk" ? (
        <Suspense fallback={<div className="nn-loading">Loading MARSWALK…</div>}>
          <ErrorBoundary label="MARSWALK" key={marswalkDemo.key}>
            <MarswalkView demo={marswalkDemo.demo} onNotice={setNotice} />
          </ErrorBoundary>
        </Suspense>
      ) : (
      <div className="workspace">
        <LeftColumn
          activeCustomPlace={activeCustomPlace}
          displayName={displayName}
          displayType={displayType}
          loading={loading}
          namedFeature={namedFeature}
          selectedLocation={selectedLocation}
          solar={solar}
          thermal={thermal}
          thermalPanel={thermalPanel}
        />

        <section className="site-field">
          <div className="field-header">
            <div>
              <span className="field-label-inline">MARTIAN SITE / 2D NAVIGATION</span>

              <strong>{displayName}</strong>
            </div>

            {/* Phones (< 768 px): row 2 of the HUD. Search, map switch, layers and legend; hidden on wider screens. */}
            <div className="nn-phone-mapbar">
              <SearchBar query={query} suggestions={suggestions} onQueryChange={setQuery} onSelect={handleSelectPlace} />
              <MapViewToggle is3dOpen={map3dOpen} onSet3d={setMap3dOpen} />
              <CategorizedLayersMenu compact map={map3dOpen ? "3d" : mobileUi.mapView === "usgs" ? "arcgis" : "2d"} status={contextLayers.status} onLink={handleLayerLink} />
              <DynamicMapLegend compact visibility={layerVisibility} open={legendOpen} onToggle={() => setLegendOpen((v) => !v)} />
            </div>

            <div className="map-status-inline">
              <span>{places.length.toLocaleString()} USGS FEATURES</span>

              <span>ANY COORDINATE SELECTABLE</span>
            </div>
          </div>

          <div className="maps-grid">
            <div className="map-panel">
              <div className="map-panel-title">
                <span>COLORED GLOBAL MAP</span>

                <small>USGS FEATURE + COORDINATE NAVIGATION</small>
              </div>

              <div className="map-panel-scroll" ref={mapPanelScrollRef}>
              <div className="map-panel-body map-panel-body--with-actions">
                {/* Both open shared, existing workspaces: the AI Route Designer and the 3D view. */}
                <div className="map-layer-controls map-toolbar">
                  <button
                    type="button"
                    className="mission-action map-ai-route-button"
                    onClick={() => setDesignerOpen(true)}
                    aria-label="Open AI Route Design"
                  >
                    AI ROUTE DESIGN
                  </button>

                  <button
                    type="button"
                    className={`mission-action map-3d-button${map3dOpen ? " active" : ""}`}
                    onClick={() => setMap3dOpen((value) => !value)}
                    aria-label="Open interactive 3D map"
                    aria-pressed={map3dOpen}
                  >
                    3D MAP
                  </button>
                  <CategorizedLayersMenu map="2d" status={contextLayers.status} onLink={handleLayerLink} />
                  <DynamicMapLegend visibility={layerVisibility} open={legendOpen} onToggle={() => setLegendOpen((v) => !v)} />
                </div>

                <DynamicMapLegend visibility={layerVisibility} open={legendOpen} docked />

                <MarsMap
                  showBasemap={layerVisibility.mola}
                  showFeatures={layerVisibility.features}
                  features={places}

                  selectedFeature={namedFeature}

                  selectedLocation={selectedLocation}

                  customPlaces={customPlaces}

                  safeHavens={safeHavens}

                  onSelect={handleSelectPlace}

                  onUserPlaceSelect={handleSelectCustomPlace}

                  onSafeHavenSelect={handleSelectSafeHaven}

                  onCreateUserPlace={handleCreateUserPlace}

                  onCreateSafeHaven={handleCreateSafeHaven}

                  routeMode={routeMode}

                  routePoints={routePoints}

                  routeStart={routePoints[0] ?? null}

                  routeEnd={routePoints[routePoints.length - 1] ?? null}

                  routePlan={layerVisibility.routes ? routePlan : null}

                  route={layerVisibility.routes ? routePlan : null}

                  onMapLocationSelect={handleRoutePointAdd}

                  onMapCoordinateSelect={handleSelectCoordinate}

                  interactive={true}
                >
                  <ContextLayers visibility={layerVisibility} data={contextLayers.data} thermalObs={environment?.thermal?.observations ?? []} />
                </MarsMap>
              </div>

              <RouteConsole
                sheetHead={
                  <SheetHead title="ROUTE CONSOLE">
                    <button type="button" className="mission-action nn-sheet-action" onClick={() => setDesignerOpen(true)}>
                      AI ROUTE DESIGN
                    </button>
                  </SheetHead>
                }
                routeMode={routeMode}

                routePoints={routePoints}

                routePlan={routePlan}

                loading={routeLoading}

                hasSelectedLocation={Boolean(selectedLocation)}

                selectedLocation={selectedLocation}

                savedRoutes={savedRoutes}

                compareCount={compareRouteIds.length}

                customPlacesCount={customPlaces.length}

                safeHavensCount={safeHavens.length}

                onToggle={toggleRouteMode}

                onAddSelected={handleAddSelected}

                onAnalyze={handleAnalyzeRoute}

                onClear={clearRoute}

                onRemoveLast={removeLastWaypoint}

                onSaveRoute={handleSaveRoute}

                onOpenCompare={handleOpenComparison}

                onSavePlace={handleSavePlace}

                onAddSafeHaven={handleAddSafeHaven}
              />
              </div>

              <ScrollJumpButton scrollRef={mapPanelScrollRef} watch={routePoints.length + (routePlan ? 1 : 0)} />
            </div>

            <div className="map-panel" id="panel-usgs-map">
              <div className="map-panel-title nn-usgs-title">
                <span>USGS SCIENTIFIC MAP</span>

                <div className="nn-usgs-tools">
                  <div className="nn-seg" role="radiogroup" aria-label="USGS panel view">
                    <button type="button" role="radio" aria-checked={usgsView === "layered"} className={usgsView === "layered" ? "is-active" : undefined} onClick={() => setUsgsView("layered")} title="NeuroNexus ArcGIS view: USGS SIM 3292 geology plus the shared layers">
                      LAYERED
                    </button>
                    <button type="button" role="radio" aria-checked={usgsView === "app"} className={usgsView === "app" ? "is-active" : undefined} onClick={() => setUsgsView("app")} title="The USGS geologic map web application (separate site, synced to the selection)">
                      USGS APP
                    </button>
                  </div>
                  {usgsView === "layered" && <CategorizedLayersMenu map="arcgis" status={contextLayers.status} onLink={handleLayerLink} />}
                </div>
              </div>

              <div className="map-panel-body">
                {usgsView === "layered" ? (
                  <ArcgisLayeredMap
                    center={selectedLocation}
                    halfWidthKm={USGS_SYNC_HALF_WIDTH_KM}
                    features={layerVisibility.features ? places : []}
                    contextData={contextLayers.data}
                    thermalObs={environment?.thermal?.observations ?? []}
                    routePoints={routePoints}
                    safeHavens={safeHavens}
                    onSelectCoordinate={handleSelectCoordinate}
                  />
                ) : (
                  <MarsTopographicMap
                    syncTarget={selectedLocation}
                    syncUrl={usgsSync.key && !usgsSync.error ? usgsSync.url : null}
                    syncStatus={usgsSyncStatus}
                    syncError={usgsSync.error}
                    halfWidthKm={USGS_SYNC_HALF_WIDTH_KM}
                    snapshotAvailable={comparedRoutes.length >= 2 || routePoints.length >= 2 || Boolean(selectedCandidateId)}
                    onOpenSnapshot={handleOpenSnapshot}
                    onRequestSync={requestUsgsSync}
                  />
                )}
              </div>
            </div>
          </div>

          <div className="map-legend">
            <div>
              <span className="legend-mark crater" />
              Crater
            </div>

            <div>
              <span className="legend-mark valley" />
              Vallis / Chasma
            </div>

            <div>
              <span className="legend-mark mountain" />
              Mons / highland
            </div>

            <div>
              <span className="legend-mark feature" />
              Other USGS feature
            </div>

            <div>
              <span
                className="legend-mark"
                style={{
                  background: "#8cf0b1",
                }}
              />
              Safe Haven
            </div>
          </div>
        </section>

        <RightColumn
          dust={dust}
          dustPlaying={dustPlaying}
          environment={environment}
          handleOpenOrbital={handleOpenOrbital}
          handleSelectCoordinate={handleSelectCoordinate}
          missionConsoleState={missionConsoleState}
          missionProfile={missionProfile}
          selectedLocation={selectedLocation}
          setDustPlaying={setDustPlaying}
          setMissionProfile={setMissionProfile}
          setSol={setSol}
          siteScience={siteScience}
          sol={sol}
          terrain={terrain}
        />
      </div>
      )}

      <EvidenceBar
        TEAM_URL={TEAM_URL}
        setSourcesDrawer={setSourcesDrawer}
      />

      {map3dOpen && (
      <Suspense fallback={<div className="nn-loading">Loading the 3D globe…</div>}>
      <Mars3DView
        sol={sol}
        open={map3dOpen}
        onClose={() => setMap3dOpen(false)}
        selectedLocation={selectedLocation}
        selectedFeature={namedFeature}
        displayName={displayName}
        environment={environment}
        features={places}
        routePoints={routePoints}
        routeMode={routeMode}
        candidateRoutes={candidateRoutes}
        selectedCandidateId={selectedCandidateId}
        safeHavens={safeHavens}
        customPlaces={customPlaces}
        onSelectCoordinate={handleSelectCoordinate}
        onSelectFeature={handleSelectPlace}
        onRoutePointAdd={handleRoutePointAdd}
        onSelectCandidate={setSelectedCandidateId}
        onApplyCandidate={handleApplyCandidate}
        onOpenDesigner={() => setDesignerOpen(true)}
        onOpenSnapshot={handleOpenSnapshot}
        snapshotAvailable={comparedRoutes.length >= 2 || routePoints.length >= 2 || Boolean(selectedCandidateId)}
        onOpenCompare={handleOpenComparison}
        compareAvailable={savedRoutes.length >= 2 || compareRouteIds.length >= 2}
        savedRoutes={savedWithColour}
        compareRouteIds={compareRouteIds}
        onToggleCompareRoute={handleToggleCompareRoute}
        onSnapshotRoute={handleSnapshotSavedRoute}
        onRenameRoute={handleRenameRoute}
        routeStatsFor={routeStats}
        requestedPanel={requested3dPanel}
      />
      </Suspense>
      )}

      <AiRouteDesigner
        open={designerOpen}
        onClose={() => setDesignerOpen(false)}
        start={designStart}
        destination={designDestination}
        selectedLocation={selectedLocation}
        safeHavens={safeHavens}
        result={routeCandidates}
        loading={candidatesLoading}
        error={candidatesError}
        analysis={routeAnalysis}
        analysisLoading={analysisLoading}
        aiStatus={aiStatus}
        selectedCandidateId={selectedCandidateId}
        weights={objectiveWeights}
        evaPace={evaPaceKmh}
        ascentAllowance={ascentAllowance}
        includeScience={includeScience}
        onSetStart={() => setDesignStart(locationForDesign("START"))}
        onSetDestination={() => setDesignDestination(locationForDesign("DESTINATION"))}
        onWeightsChange={setObjectiveWeights}
        onEvaPaceChange={setEvaPaceKmh}
        onAscentAllowanceChange={setAscentAllowance}
        onIncludeScienceChange={setIncludeScience}
        onGenerate={handleGenerateCandidates}
        onSelectCandidate={setSelectedCandidateId}
        onApplyCandidate={handleApplyCandidate}
        onSaveCandidate={(candidate) => handleSaveCandidate(candidate)}
        onSaveAllCandidates={handleSaveAllCandidates}
        savedCandidateKeys={savedRoutes
          .filter((route) => route.generation?.request_key && route.generation.request_key === routeCandidates?.requestKey)
          .map((route) => route.generation.candidate_id)}
        onRequestAnalysis={handleRequestRouteAnalysis}
      />

      <UsgsRouteSnapshot
        open={snapshotOpen}
        onClose={() => setSnapshotOpen(false)}
        snapshot={snapshot}
        loading={snapshotLoading}
        error={snapshotError}
        onExport={handleExportSnapshot}
      />

      <OrbitalTrackingPanel
        open={orbitalOpen}
        onClose={() => setOrbitalOpen(false)}
        data={orbitalData}
        loading={orbitalLoading}
        error={orbitalError}
        onRefresh={() => loadOrbitalTracking()}
        horizonDays={orbitalHorizon}
        onHorizonChange={handleOrbitalHorizonChange}
      />

      <MarsIntelligence
        open={intelligenceOpen}
        onClose={() => setIntelligenceOpen(false)}
        status={aiStatus}
        onAsk={handleAskIntelligence}
        missionSummary={[
          { label: "SITE", value: displayName },
          { label: "SOL", value: String(sol) },
          { label: "ROUTE", value: routePoints.length ? `${routePoints.length} waypoints` : "none" },
          { label: "CANDIDATES", value: String(candidateRoutes.length) },
          { label: "SAVED", value: String(savedRoutes.length) },
          { label: "TRACKING", value: orbitalData?.tracking_status ?? "not queried" },
        ]}
      />

      {comparisonOpen && (
        <RouteComparisonWorkspace
          routes={savedRoutes}
          compareRouteIds={compareRouteIds}
          onToggleRoute={handleToggleCompareRoute}
          onClose={() => setComparisonOpen(false)}
          onDeleteRoute={handleDeleteSavedRoute}
          onReevaluate={(id) => reevaluateRoutes([id])}
          onRename={handleRenameRoute}
          onVerify={verifyRouteReproducibility}
          onShowIn3D={() => {
            setComparisonOpen(false);
            open3dPanel("routes");
          }}
          onExportFile={(base, extension, content, mime) => downloadTextFile(exportFilename(base, extension), content, mime)}
        />
      )}

      {manualOpen && (
      <Suspense fallback={null}>
      <MissionManualDrawer
        optimizationPanel={<BrowserOptimizationPanel />}
        open={manualOpen}
        onClose={() => setManualOpen(false)}
        onQuickStart={startDemo}
        onOpenSources={(focusId) => setSourcesDrawer({ open: true, focusId })}
        onOpenCommands={() => {
          setManualOpen(false);
          setCommandIndex({ open: true, tab: "commands" });
        }}
      />
      </Suspense>
      )}

      <SourcesDrawer open={sourcesDrawer.open} focusId={sourcesDrawer.focusId} onClose={() => setSourcesDrawer({ open: false, focusId: null })} />
      <RadialFeatureWheel onAction={runCommand} availability={commandAvailable} />
      <MobileDock appMode={appMode} />
    </main>
    </SourcesContext.Provider>
    </SolProvider>
  );
}
