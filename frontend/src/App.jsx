import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import MarsMap from "./components/mars/MarsMap";
import MarsTopographicMap from "./components/mars/MarsTopographicMap";
import MarsBriefingPanel from "./components/mars/MarsBriefingPanel";
import RoverPhotosPanel from "./components/mars/RoverPhotosPanel";
import SiteSciencePanel from "./components/mars/SiteSciencePanel";
import MissionOpsPanel from "./components/mission/MissionOpsPanel";

import AiRouteDesigner from "./components/route/AiRouteDesigner";
import Mars3DView from "./components/mars3d/Mars3DView";
import UsgsRouteSnapshot from "./components/mars/UsgsRouteSnapshot";
import OrbitalTrackingPanel from "./components/mission/OrbitalTrackingPanel";
import MarsIntelligence from "./components/mission/MarsIntelligence";

import DustScenarioPanel from "./panels/DustScenarioPanel";
import SiteMorphologyPanel from "./panels/SiteMorphologyPanel";
import RouteComparisonWorkspace, { MAX_COMPARE_ROUTES } from "./route/RouteComparisonWorkspace";
import CommandIndex from "./command/CommandIndex";
import { SHORTCUTS, TEAM_URL, buildRegistry } from "./features/registry";
import {
  STORAGE_KEY_V3,
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

import "./ui/tokens.css";
import "./App.css";
import "./ui/ui.css";

const DEFAULT_PLACE = "Gale";
const DEFAULT_SOL = 100;
const MAX_SOL = 668;

const MAX_ROUTE_POINTS = 32;

const MAX_TODO_WORDS = 150;
const MAX_CHECKLIST_POINTS = 10;
const MAX_CHECKLIST_WORDS = 150;

const STORAGE_KEYS = {
  routes: STORAGE_KEY_V3,

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


function readStorage(key, fallback) {
  try {
    const raw = localStorage.getItem(key);

    if (!raw) {
      return fallback;
    }

    const parsed = JSON.parse(raw);

    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

function writeStorage(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Local persistence is optional.
  }
}

function createId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function normaliseLongitude(longitude) {
  return ((Number(longitude) % 360) + 360) % 360;
}

function normaliseLocation(point, label = null) {
  return {
    latitude_deg: Number(point.latitude_deg ?? point.lat),

    longitude_deg: normaliseLongitude(point.longitude_deg ?? point.longitude ?? point.lon ?? point.lng),

    label: label ?? point.label ?? null,
  };
}

function countWords(text = "") {
  return String(text).trim().split(/\s+/).filter(Boolean).length;
}

function trimToWordLimit(text, maximum) {
  const words = String(text).trim().split(/\s+/).filter(Boolean);

  if (words.length <= maximum) {
    return text;
  }

  return words.slice(0, maximum).join(" ");
}

function isNetworkFailure(error) {
  const message = String(error?.message ?? error ?? "").toLowerCase();

  return (
    message.includes("failed to fetch") ||
    message.includes("networkerror") ||
    message.includes("load failed") ||
    message.includes("econnrefused") ||
    message.includes("fetch failed")
  );
}

function downloadTextFile(filename, content, mimeType) {
  const blob = new Blob([content], {
    type: mimeType,
  });

  const url = URL.createObjectURL(blob);

  const anchor = document.createElement("a");

  anchor.href = url;

  anchor.download = filename;

  document.body.appendChild(anchor);

  anchor.click();

  anchor.remove();

  URL.revokeObjectURL(url);
}

function Panel({ eyebrow, title, children, className = "", id }) {
  return (
    <section className={`panel ${className}`} id={id}>
      <div className="panel-heading">
        <div>
          {eyebrow && <div className="eyebrow">{eyebrow}</div>}

          <h2>{title}</h2>
        </div>

        <span className="panel-mark">+</span>
      </div>

      <div className="panel-body">{children}</div>
    </section>
  );
}

function Metric({ label, value, detail }) {
  return (
    <div className="metric">
      <span>{label}</span>

      <strong>{value ?? "—"}</strong>

      {detail && <small>{detail}</small>}
    </div>
  );
}

function SearchBar({ query, suggestions, onQueryChange, onSelect }) {
  return (
    <div className="search-wrapper">
      <div className="search-box">
        <span className="search-icon">⌕</span>

        <input
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="Search Mars place..."
          aria-label="Search Mars place"
        />

        <span className="search-hint">USGS</span>
      </div>

      {suggestions.length > 0 && (
        <div className="suggestions">
          <div className="suggestions-header">MARS PLACES</div>

          {suggestions.map((suggestion) => (
            <button
              key={[suggestion.feature_name, suggestion.latitude_deg, suggestion.longitude_deg].join(":")}
              type="button"
              onClick={() => onSelect(suggestion)}
            >
              <span className="suggestion-dot" />

              <span className="suggestion-main">
                <strong>{suggestion.feature_name}</strong>

                <small>{suggestion.feature_type}</small>
              </span>

              <span className="suggestion-meta">{suggestion.diameter_km == null ? "—" : `${Number(suggestion.diameter_km).toFixed(2)} km`}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const glassButtonStyle = {
  minHeight: "34px",

  padding: "0 10px",

  border: "1px solid rgba(117,230,255,0.22)",

  background: "rgba(7,15,19,0.76)",

  color: "#9ab0b8",

  fontFamily: "monospace",

  fontSize: "10px",

  letterSpacing: "0.06em",

  cursor: "pointer",
};

function MissionMenu({
  open,
  onClose,
  todoText,
  setTodoText,
  checklist,
  onChecklistTextChange,
  onChecklistToggle,
  onAddChecklistItem,
  onRemoveChecklistItem,
  onExportJson,
  onExportCsv,
  onExportRouteCsv,
  routeExportAvailable = true,
  onPrint,
  embedded = false,
}) {
  if (!open && !embedded) {
    return null;
  }

  const todoWords = countWords(todoText);

  const checklistWords = countWords(checklist.map((item) => item.text).join(" "));

  const body = (
        <div
          style={{
            display: "grid",

            gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)",

            gap: "12px",

            padding: "14px",
          }}
        >
          <section
            style={{
              minWidth: 0,

              border: "1px solid rgba(117,230,255,0.14)",

              background: "rgba(7,15,19,0.72)",
            }}
          >
            <div
              style={{
                padding: "12px",

                borderBottom: "1px solid rgba(117,230,255,0.1)",
              }}
            >
              <div
                style={{
                  color: "#75e6ff",

                  fontSize: "10px",

                  letterSpacing: "0.12em",
                }}
              >
                ✍️ TO-DO LIST MAKER
              </div>

              <strong
                style={{
                  display: "block",

                  marginTop: "5px",

                  fontSize: "13px",
                }}
              >
                Mission objective / field note
              </strong>
            </div>

            <div
              style={{
                padding: "12px",
              }}
            >
              <textarea
                value={todoText}
                onChange={(event) => setTodoText(trimToWordLimit(event.target.value, MAX_TODO_WORDS))}
                placeholder="Write what needs to be completed..."
                style={{
                  width: "100%",

                  minHeight: "280px",

                  resize: "vertical",

                  boxSizing: "border-box",

                  padding: "12px",

                  border: "1px solid #29414b",

                  background: "#071014",

                  color: "#d8e5e9",

                  fontFamily: "monospace",

                  fontSize: "10px",

                  lineHeight: 1.6,

                  outline: "none",
                }}
              />

              <div
                style={{
                  display: "flex",

                  justifyContent: "space-between",

                  gap: "10px",

                  marginTop: "7px",

                  color: todoWords >= MAX_TODO_WORDS ? "#ff8997" : "#6f828a",

                  fontFamily: "monospace",

                  fontSize: "10px",
                }}
              >
                <span>MAXIMUM 150 WORDS</span>

                <strong>
                  {todoWords} / {MAX_TODO_WORDS}
                </strong>
              </div>
            </div>
          </section>

          <section
            style={{
              minWidth: 0,

              border: "1px solid rgba(117,230,255,0.14)",

              background: "rgba(7,15,19,0.72)",
            }}
          >
            <div
              style={{
                padding: "12px",

                borderBottom: "1px solid rgba(117,230,255,0.1)",
              }}
            >
              <div
                style={{
                  color: "#75e6ff",

                  fontSize: "10px",

                  letterSpacing: "0.12em",
                }}
              >
                📋 CHECKLIST MAKER
              </div>

              <strong
                style={{
                  display: "block",

                  marginTop: "5px",

                  fontSize: "13px",
                }}
              >
                Tickable mission actions
              </strong>
            </div>

            <div
              style={{
                padding: "12px",
              }}
            >
              <div
                style={{
                  display: "flex",

                  justifyContent: "space-between",

                  gap: "10px",

                  marginBottom: "9px",

                  color: "#6f828a",

                  fontFamily: "monospace",

                  fontSize: "10px",
                }}
              >
                <span>
                  {checklist.length} / {MAX_CHECKLIST_POINTS} POINTS
                </span>

                <strong
                  style={{
                    color: checklistWords >= MAX_CHECKLIST_WORDS ? "#ff8997" : "#9bb1b8",
                  }}
                >
                  {checklistWords} / {MAX_CHECKLIST_WORDS} WORDS
                </strong>
              </div>

              <div
                style={{
                  display: "grid",

                  gap: "7px",

                  minHeight: "285px",

                  alignContent: "start",
                }}
              >
                {checklist.map((item, index) => (
                  <div
                    key={item.id}
                    style={{
                      display: "grid",

                      gridTemplateColumns: "30px minmax(0,1fr) 32px",

                      gap: "7px",

                      alignItems: "center",
                    }}
                  >
                    <button
                      type="button"
                      onClick={() => onChecklistToggle(item.id)}
                      style={{
                        width: "30px",

                        height: "30px",

                        border: item.done ? "1px solid #8cf0b1" : "1px solid #29414b",

                        background: item.done ? "rgba(80,180,120,0.12)" : "#071014",

                        color: "#8cf0b1",

                        cursor: "pointer",

                        fontSize: "15px",
                      }}
                    >
                      {item.done ? "✓" : ""}
                    </button>

                    <input
                      value={item.text}
                      onChange={(event) => onChecklistTextChange(item.id, event.target.value)}
                      placeholder={`Checklist point ${index + 1}`}
                      style={{
                        minWidth: 0,

                        width: "100%",

                        boxSizing: "border-box",

                        minHeight: "34px",

                        padding: "7px 9px",

                        border: "1px solid #29414b",

                        background: "#071014",

                        color: item.done ? "#6d858d" : "#d5e1e5",

                        textDecoration: item.done ? "line-through" : "none",

                        fontFamily: "monospace",

                        fontSize: "10px",

                        outline: "none",
                      }}
                    />

                    <button
                      type="button"
                      onClick={() => onRemoveChecklistItem(item.id)}
                      style={{
                        minHeight: "34px",

                        border: "1px solid #50333a",

                        background: "#0b1114",

                        color: "#ff9aa9",

                        cursor: "pointer",

                        fontSize: "13px",
                      }}
                    >
                      ×
                    </button>
                  </div>
                ))}

                {!checklist.length && (
                  <div
                    style={{
                      minHeight: "160px",

                      display: "grid",

                      placeItems: "center",

                      padding: "16px",

                      border: "1px dashed #29414b",

                      color: "#667980",

                      fontSize: "10px",

                      textAlign: "center",
                    }}
                  >
                    NO CHECKLIST ITEMS
                    <br />
                    ADD YOUR FIRST MISSION ACTION
                  </div>
                )}
              </div>

              <button
                type="button"
                disabled={checklist.length >= MAX_CHECKLIST_POINTS || checklistWords >= MAX_CHECKLIST_WORDS}
                onClick={onAddChecklistItem}
                style={{
                  ...glassButtonStyle,

                  width: "100%",

                  marginTop: "10px",

                  opacity: checklist.length >= MAX_CHECKLIST_POINTS || checklistWords >= MAX_CHECKLIST_WORDS ? 0.4 : 1,
                }}
              >
                + ADD CHECKLIST POINT
              </button>
            </div>
          </section>

          <section
            style={{
              gridColumn: "1 / -1",

              border: "1px solid rgba(117,230,255,0.14)",

              background: "rgba(7,15,19,0.72)",

              padding: "12px",
            }}
          >
            <div
              style={{
                display: "flex",

                flexWrap: "wrap",

                gap: "7px",

                justifyContent: "space-between",

                alignItems: "center",
              }}
            >
              <div>
                <div
                  style={{
                    color: "#75e6ff",

                    fontSize: "10px",

                    letterSpacing: "0.12em",
                  }}
                >
                  MISSION RECORD
                </div>

                <small
                  style={{
                    display: "block",

                    marginTop: "4px",

                    color: "#687b83",

                    fontSize: "10px",
                  }}
                >
                  Notes and checklist are saved locally and included in both mission exports. The complete CSV flattens every value in the mission
                  record, one row per measurement.
                </small>
              </div>

              <div
                style={{
                  display: "flex",

                  flexWrap: "wrap",

                  gap: "6px",
                }}
              >
                <button type="button" onClick={onExportJson} style={glassButtonStyle}>
                  EXPORT JSON
                </button>

                <button type="button" onClick={onExportCsv} style={glassButtonStyle}>
                  EXPORT COMPLETE CSV
                </button>

                <button
                  type="button"
                  onClick={onExportRouteCsv}
                  style={{ ...glassButtonStyle, opacity: routeExportAvailable ? 1 : 0.55 }}
                  title={routeExportAvailable ? "Per-waypoint route CSV" : "Plan, apply or save a route first"}
                >
                  EXPORT ROUTE CSV
                </button>

                <button type="button" onClick={onPrint} style={glassButtonStyle}>
                  PRINT / PDF
                </button>
              </div>
            </div>
          </section>
        </div>
  );

  if (embedded) {
    return body;
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="NeuroNexus mission workspace"
      style={{
        position: "fixed",

        inset: 0,

        zIndex: 5000,

        display: "flex",

        alignItems: "center",

        justifyContent: "center",

        padding: "24px",

        background: "rgba(2,7,10,0.72)",

        backdropFilter: "blur(22px) saturate(120%)",

        WebkitBackdropFilter: "blur(22px) saturate(120%)",
      }}
    >
      <div
        style={{
          width: "min(1180px, 100%)",

          height: "min(820px, calc(100vh - 48px))",

          overflow: "auto",

          border: "1px solid rgba(117,230,255,0.25)",

          background: "linear-gradient(180deg, rgba(11,21,27,0.9), rgba(4,10,13,0.92))",

          boxShadow: "0 30px 120px rgba(0,0,0,0.65)",

          backdropFilter: "blur(28px)",

          WebkitBackdropFilter: "blur(28px)",
        }}
      >
        <header
          style={{
            position: "sticky",

            top: 0,

            zIndex: 2,

            display: "flex",

            justifyContent: "space-between",

            alignItems: "center",

            gap: "16px",

            padding: "16px 18px",

            borderBottom: "1px solid rgba(117,230,255,0.13)",

            background: "rgba(5,12,16,0.82)",

            backdropFilter: "blur(18px)",

            WebkitBackdropFilter: "blur(18px)",
          }}
        >
          <div>
            <div
              style={{
                color: "#75e6ff",

                fontSize: "10px",

                letterSpacing: "0.16em",
              }}
            >
              NEURONEXUS / MISSION WORKSPACE
            </div>

            <h2
              style={{
                margin: "5px 0 0",

                fontSize: "18px",

                letterSpacing: "0.06em",
              }}
            >
              FIELD NOTES + CHECKLIST
            </h2>

            <small
              style={{
                display: "block",

                marginTop: "5px",

                color: "#74868e",

                fontSize: "10px",
              }}
            >
              Persistent local mission planning workspace.
            </small>
          </div>

          <button
            type="button"
            onClick={onClose}
            style={{
              minWidth: "38px",

              minHeight: "38px",

              border: "1px solid #29414b",

              background: "#091115",

              color: "#75e6ff",

              fontSize: "20px",

              cursor: "pointer",
            }}
          >
            ×
          </button>
        </header>

        {body}
      </div>
    </div>
  );
}

function RouteConsole({
  routeMode,
  routePoints,
  routePlan,
  loading,
  hasSelectedLocation,
  selectedLocation,
  savedRoutes,
  compareCount,
  customPlacesCount,
  safeHavensCount,
  onToggle,
  onAddSelected,
  onAnalyze,
  onClear,
  onRemoveLast,
  onSaveRoute,
  onOpenCompare,
  onSavePlace,
  onAddSafeHaven,
}) {
  const displacement = routePlan?.displacement?.distance_km;

  const planned = routePlan?.planned_route?.planned_route_km;

  const extension = routePlan?.planned_route?.extension_km;

  return (
    <div className="route-console">
      <div className="route-console-main">
        <div className="route-console-heading">
          <span>NAVIGATION / USER WAYPOINTS</span>

          <strong>
            {routeMode ? "PLAN ROUTE ACTIVE" : routePoints.length ? `${routePoints.length} WAYPOINT${routePoints.length === 1 ? "" : "S"}` : "READY"}
          </strong>
        </div>

        <small>
          {routeMode
            ? "Click anywhere on the coloured Mars map to add a waypoint."
            : "User-defined Haversine route geometry with local MOLA waypoint analysis."}
        </small>
      </div>

      <div className="route-console-actions">
        <button type="button" className={routeMode ? "active" : ""} onClick={onToggle}>
          {routeMode ? "STOP PLANNING" : "PLAN ROUTE"}
        </button>

        <button type="button" disabled={!hasSelectedLocation || routePoints.length >= MAX_ROUTE_POINTS} onClick={onAddSelected}>
          ADD SELECTED
        </button>

        <button type="button" disabled={!routePoints.length} onClick={onRemoveLast}>
          UNDO LAST
        </button>

        <button type="button" className="primary" disabled={routePoints.length < 2 || loading} onClick={onAnalyze}>
          {loading ? "ANALYZING…" : "ANALYZE"}
        </button>

        <button type="button" disabled={routePoints.length < 2} onClick={onSaveRoute}>
          SAVE ROUTE
        </button>

        <button type="button" disabled={savedRoutes.length < 2} onClick={onOpenCompare}>
          COMPARE
          {compareCount > 0 ? ` ${compareCount}/${MAX_COMPARE_ROUTES}` : ""}
        </button>

        <button type="button" className="danger" disabled={!routePoints.length} onClick={onClear}>
          CLEAR
        </button>
      </div>

      {routePoints.length > 0 && (
        <div className="route-console-strip">
          {routePoints.map((point, index) => (
            <span key={`${point.latitude_deg}:${point.longitude_deg}:${index}`}>
              {index === 0 ? "A" : `P${index}`}{" "}
              {point.label || `${Number(point.latitude_deg).toFixed(2)}°,${Number(point.longitude_deg).toFixed(2)}°E`}
            </span>
          ))}
        </div>
      )}

      {routePlan && (
        <div className="route-console-results">
          <Metric label="Displacement" value={displacement == null ? "—" : `${Number(displacement).toFixed(2)} km`} />

          <Metric label="Planned route" value={planned == null ? "—" : `${Number(planned).toFixed(2)} km`} />

          <Metric label="Extension" value={extension == null ? "—" : `${Number(extension).toFixed(2)} km`} />
        </div>
      )}

      <div
        style={{
          display: "grid",

          gridTemplateColumns: "1fr 1fr",

          gap: "6px",
        }}
      >
        <button
          type="button"
          disabled={!selectedLocation}
          onClick={onSavePlace}
          style={{
            minHeight: "29px",

            padding: "0 9px",

            border: "1px solid #29414b",

            background: "#0a1318",

            color: "#93a7af",

            fontFamily: "monospace",

            fontSize: "7px",

            letterSpacing: "0.08em",

            cursor: "pointer",
          }}
        >
          SAVE CURRENT PLACE
        </button>

        <button
          type="button"
          disabled={!selectedLocation}
          onClick={onAddSafeHaven}
          style={{
            minHeight: "29px",

            padding: "0 9px",

            border: "1px solid #3a6650",

            background: "#0a1318",

            color: "#8cf0b1",

            fontFamily: "monospace",

            fontSize: "7px",

            letterSpacing: "0.08em",

            cursor: "pointer",
          }}
        >
          ADD SAFE HAVEN
        </button>
      </div>

      <div
        style={{
          display: "flex",

          flexWrap: "wrap",

          gap: "8px 14px",

          paddingTop: "2px",

          color: "#65777f",

          fontFamily: "monospace",

          fontSize: "7px",
        }}
      >
        <span>
          SAVED ROUTES{" "}
          <strong
            style={{
              color: "#9bb1b8",
            }}
          >
            {savedRoutes.length}
          </strong>
        </span>

        <span>
          CUSTOM PLACES{" "}
          <strong
            style={{
              color: "#9bb1b8",
            }}
          >
            {customPlacesCount}
          </strong>
        </span>

        <span>
          SAFE HAVENS{" "}
          <strong
            style={{
              color: "#8cf0b1",
            }}
          >
            {safeHavensCount}
          </strong>
        </span>
      </div>
    </div>
  );
}

export default function App() {
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
      try {
        const response = await fetch("/api/places?limit=1", {
          cache: "no-store",
        });

        if (cancelled) {
          return;
        }

        setBackendConnected(response.ok);
      } catch {
        if (!cancelled) {
          setBackendConnected(false);
        }
      }
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

  const comparisonRoutes = useMemo(() => savedRoutes.filter((route) => compareRouteIds.includes(route.id)), [savedRoutes, compareRouteIds]);

  /*
   * TWO MAPS, ONE LOCATION
   *
   * Any selection — coordinate click, named USGS feature, custom place or
   * Safe Haven — moves the USGS scientific map to the same coordinate via the
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
      name: routePlan ? "Current analysed route" : "Route draft",
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

  function handleMapLocationSelect(point) {
    if (routeMode) {
      handleRoutePointAdd(point);

      return;
    }

    handleSelectCoordinate(point);
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
   * Every saved route — manual or AI-designed — is one schema-v3 record with
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
      setNotice(`${route.name}: reproducibility check failed — ${err.message}`);
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
   * The 120 km planning-window guard stays exactly as it is — it protects the
   * bounded MOLA sampling. Only the wording is made actionable.
   */
  function friendlyCandidateError(message) {
    const match = /window would be ([\d.]+) km/.exec(message ?? "");
    if (match) {
      return `Start and destination are ${match[1]} km apart, beyond the 120 km bounded planning window. Add an intermediate waypoint and design the legs one at a time, or choose a closer destination.`;
    }
    if (/run git lfs pull|tile/i.test(message ?? "")) {
      return `Terrain tiles for this area are not available locally — ${message}`;
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

  const commandHandlers = {
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
        setNotice("Ctrl/⌘+K command index · / search · R route mode · S save route · A route designer · C compare · I intelligence · 3 3D · O orbital · P print · N notes · [ ] sol"),
    },
    "backend-status": { run: () => setNotice(backendConnected ? "Backend online (FastAPI, port 8002)." : "Backend unreachable — start uvicorn on port 8002.") },
    about: { run: () => setCommandIndex({ open: true, tab: "team" }) },
    "meet-the-team": { run: () => window.open(TEAM_URL, "_blank", "noopener,noreferrer") },
  };

  const commandRegistry = buildRegistry(commandHandlers);
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
        project: "NeuroNexus — Interplanetary Survival Guide: Martian Map",
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
        note: "Observed, reference, modelled, derived, computed, simulated and unavailable evidence are kept explicitly distinct.",
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
   * CSV EXPORT — complete, long-form.
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
      setError("No route to export yet — plan a route, apply an AI candidate or save a route first.");
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
    <main className="mission-shell">
      <header className="topbar">
        <div className="brand-block">
          <img className="brand-logo" src="/team-neuronexus-logo.png" alt="Team NeuroNexus" width="40" height="40" />

          <div className="brand-kicker">NASA SPACE APPS 2026</div>

          <h1>NEURONEXUS</h1>

          <span>MARTIAN MAP / MISSION CONTROL</span>
        </div>

        <SearchBar query={query} suggestions={suggestions} onQueryChange={setQuery} onSelect={handleSelectPlace} />

        <div
          className="mission-state"
          style={{
            display: "flex",

            alignItems: "flex-end",

            justifyContent: "center",

            gap: "12px",
          }}
        >
          <div
            style={{
              display: "flex",

              gap: "14px",

              alignItems: "center",
            }}
          >
            <div>
              <span className="state-label">SOL</span>

              <strong>{sol}</strong>
            </div>

            <div>
              <span className="state-label">FEATURES</span>

              <strong>{places.length.toLocaleString()}</strong>
            </div>
          </div>

          <div
            style={{
              display: "flex",

              flexDirection: "column",

              alignItems: "flex-end",

              gap: "6px",
            }}
          >
            <div
              className="status-dot"
              style={
                backendConnected
                  ? undefined
                  : {
                      color: "#ff647c",

                      borderColor: "rgba(255,100,124,0.24)",
                    }
              }
              title={backendConnected ? "NeuroNexus backend reachable" : "NeuroNexus backend unavailable"}
            >
              <span
                style={
                  backendConnected
                    ? undefined
                    : {
                        background: "#ff5267",

                        boxShadow: "0 0 12px rgba(255,82,103,0.75)",
                      }
                }
              />

              {backendConnected ? "SYSTEM ONLINE" : "SYSTEM DEGRADED"}
            </div>

            <div className="mission-actions">
              <button type="button" className="mission-action" onClick={() => setDesignerOpen(true)}>
                AI ROUTE DESIGN
              </button>

              <button type="button" className="mission-action" onClick={() => setIntelligenceOpen(true)}>
                MARS INTELLIGENCE
              </button>

              <button type="button" className="mission-action" onClick={handleOpenSnapshot} disabled={comparedRoutes.length < 2 && routePoints.length < 2 && !selectedCandidateId}>
                USGS SNAPSHOT
              </button>

              <button type="button" className="mission-action" onClick={handleOpenOrbital}>
                ORBITAL TRACKING
              </button>
            </div>

            <button
              type="button"
              aria-label="Open mission command index"
              aria-expanded={commandIndex.open}
              title="Mission Command Index (Ctrl/⌘+K)"
              onClick={() => setCommandIndex((state) => ({ open: !state.open, tab: "commands" }))}
              style={{
                minWidth: "42px",

                minHeight: "32px",

                border: "1px solid #29414b",

                background: "#091115",

                color: "#75e6ff",

                fontFamily: "monospace",

                fontSize: "18px",

                lineHeight: 1,

                cursor: "pointer",

                boxShadow: "0 0 16px rgba(117,230,255,0.06)",
              }}
            >
              ☰
            </button>
          </div>
        </div>
      </header>

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

            fontFamily: "monospace",

            fontSize: "9px",

            boxShadow: "0 10px 30px rgba(0,0,0,0.45)",
          }}
        >
          <span>REQUEST ERROR — {error}</span>

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

      <div className="workspace">
        <aside className="left-column">
          <Panel eyebrow="GEOGRAPHY / NOMENCLATURE" title="Selected site">
            <div className="place-title">
              <span className="signal">●</span>

              <div>
                <h3>{loading && !selectedLocation ? "Loading" : displayName}</h3>

                <p>{displayType}</p>
              </div>
            </div>

            <div className="coordinate-block">
              <span>LATITUDE</span>

              <strong>{selectedLocation ? `${Number(selectedLocation.latitude_deg).toFixed(4)}°` : "—"}</strong>

              <span>LONGITUDE</span>

              <strong>{selectedLocation ? `${Number(selectedLocation.longitude_deg).toFixed(4)}°E` : "—"}</strong>
            </div>

            <div className="rule" />

            <Metric
              label="Selection source"
              value={namedFeature ? "USGS / IAU FEATURE" : activeCustomPlace ? "USER PLACE" : selectedLocation ? "COORDINATE SELECTION" : "—"}
            />

            {namedFeature ? (
              <>
                <Metric
                  label="Diameter"
                  value={namedFeature.diameter_km == null ? "—" : `${Number(namedFeature.diameter_km).toFixed(2)} km`}
                  detail="USGS / IAU nomenclature"
                />

                <Metric label="Approval" value={namedFeature.approval_status} />

                <Metric label="Quadrangle" value={namedFeature.quadrangle_name} detail={namedFeature.quadrangle_code} />
              </>
            ) : (
              <div
                style={{
                  marginTop: "4px",

                  padding: "9px",

                  border: "1px dashed #29414b",

                  background: "#091115",

                  color: "#71848c",

                  fontSize: "9px",

                  lineHeight: 1.5,
                }}
              >
                Exact coordinate selected. Nearby USGS nomenclature, when available, is context only.
              </div>
            )}
          </Panel>

          <Panel eyebrow="IMAGERY / ROVER" title="Applicable rover photos">
            <RoverPhotosPanel feature={namedFeature} />
          </Panel>

          <Panel eyebrow="THERMAL / NASA THEMIS" title="Historical evidence" id="panel-thermal">
            {!thermalPanel.hasHistorical && (
              <div className="thermal-note" role="status">
                <strong>THERMAL DATA UNAVAILABLE</strong>
                <div>{loading ? "Loading..." : thermalPanel.unavailableDetail}</div>
              </div>
            )}

            <Metric
              label={thermalPanel.nearest.label}
              value={thermalPanel.nearest.value}
              detail={thermalPanel.nearest.detail}
            />

            <div className="thermal-stat-grid">
              {thermalPanel.stats.map(({ key, ...metric }) => <Metric key={key} {...metric} />)}
            </div>

            <div className="evidence-grid">
              <Metric label="Evidence" value={thermalPanel.evidence.label} />

              <Metric label="Score" value={thermalPanel.evidence.score} />

              <Metric label="Evidence observations" value={thermalPanel.evidence.observationCount} />

              <Metric label="Evidence years" value={thermalPanel.evidence.years} />

              <Metric label="Historical radius samples" value={thermalPanel.coverage.sampleCount} />

              <Metric label="Valid temperature samples" value={thermalPanel.coverage.validSampleCount} />

              <Metric label="Search radius" value={thermalPanel.coverage.searchRadius} />

              <Metric label="Historical radius years" value={thermalPanel.coverage.years} />

              <Metric
                label="Seasonal coverage"
                value={thermalPanel.coverage.seasonalCoverage}
                detail={thermalPanel.coverage.seasonalBins}
              />
            </div>

            {thermalPanel.conditions.length > 0 && (
              <div className="thermal-condition-block">
                <div className="thermal-condition-title">SOURCE-CLASSIFIED CONDITIONS</div>

                {thermalPanel.conditions.map((condition) => (
                  <div key={condition.key}>
                    <div className="thermal-condition-title">{condition.label}</div>
                    <div className="thermal-stat-grid">
                      {condition.stats.map(({ key, ...metric }) => <Metric key={key} {...metric} />)}
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="thermal-note">{thermalPanel.conditionNote}</div>

            <div className="thermal-note">
              Aggregate statistics cover historical THEMIS brightness-temperature observations within the stated search radius. The nearest reference is shown separately; these are not exact-coordinate measurements or current Martian weather.
            </div>

            <div className="source-note">
              <span>SOURCE</span>

              <strong>{thermal?.product_id ?? "NASA THEMIS IR-PBT"}</strong>
            </div>
          </Panel>

          <Panel eyebrow="ENVIRONMENT / SOLAR" title="Solar geometry">
            <Metric label="Areocentric longitude" value={solar ? `${Number(solar.areocentric_longitude_deg).toFixed(2)}°` : "—"} detail="Ls" />

            <Metric label="Observation local solar time" value={thermal ? `${Number(thermal.local_solar_time_hours).toFixed(2)} h` : "—"} />
          </Panel>
        </aside>

        <section className="site-field">
          <div className="field-header">
            <div>
              <span className="field-label-inline">MARTIAN SITE / 2D NAVIGATION</span>

              <strong>{displayName}</strong>
            </div>

            <div className="map-status-inline">
              <span>{places.length.toLocaleString()} USGS FEATURES</span>

              <span>ANY COORDINATE SELECTABLE</span>
            </div>
          </div>

          <div className="maps-grid">
            <div className="map-panel">
              <div className="map-panel-title">
                <span>COLOURED GLOBAL MAP</span>

                <small>USGS FEATURE + COORDINATE NAVIGATION</small>
              </div>

              <div className="map-panel-body map-panel-body--with-actions">
                {/* Both open shared, existing workspaces: the AI Route Designer and the 3D view. */}
                <div className="map-floating-actions">
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
                </div>

                <MarsMap
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

                  routePlan={routePlan}

                  route={routePlan}

                  onMapLocationSelect={handleRoutePointAdd}

                  onMapCoordinateSelect={handleSelectCoordinate}

                  interactive={true}
                />
              </div>

              <RouteConsole
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

            <div className="map-panel" id="panel-usgs-map">
              <div className="map-panel-title">
                <span>USGS SCIENTIFIC MAP</span>

                <small>ARCGIS / TOPOGRAPHY / GEOLOGY / MEASUREMENTS</small>
              </div>

              <div className="map-panel-body">
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

        <aside className="right-column">
          <Panel eyebrow="ATMOSPHERE / NASA AMES" title="Dust scenario" id="panel-dust">
            <DustScenarioPanel
              location={selectedLocation}
              sol={sol}
              onSolChange={setSol}
              onSelectCoordinate={handleSelectCoordinate}
              fallbackDust={dust}
              playing={dustPlaying}
              onPlayingChange={setDustPlaying}
            />
          </Panel>

          <Panel eyebrow="TERRAIN / NASA MOLA" title="Site morphology" id="panel-morphology">
            <SiteMorphologyPanel location={selectedLocation} terrain={terrain} />
          </Panel>

          <Panel eyebrow="SITE SCIENCE / SURVIVAL" title="Material + habitability context" id="panel-site-science">
            <SiteSciencePanel science={siteScience} />
          </Panel>

          <Panel eyebrow="ASSESSMENT / EVIDENCE" title="Interpretation" id="panel-interpretation">
            <div className="assessment-status">
              <span>STATUS</span>

              <strong>{environment?.assessment?.assessment_status ?? "—"}</strong>
            </div>

            <div className="source-note">
              <span>THERMAL</span>

              <strong>Nearest historical observation</strong>
            </div>

            <div className="source-note">
              <span>DUST</span>

              <strong>Modeled MY34 scenario</strong>
            </div>

            <div className="source-note">
              <span>TERRAIN</span>

              <strong>NASA MOLA MEGDR</strong>
            </div>

            {environment?.assessment?.warnings?.length > 0 && (
              <div className="warning-box">
                {environment.assessment.warnings.map((warning) => (
                  <p key={warning}>{warning}</p>
                ))}
              </div>
            )}

            {siteScience?.nearest_feature_context?.feature_name && (
              <div
                style={{
                  marginTop: "9px",

                  padding: "9px 10px",

                  border: "1px solid rgba(117,230,255,0.08)",

                  background: "#081014",

                  color: "#667a82",

                  fontSize: "9px",

                  lineHeight: 1.45,
                }}
              >
                <span
                  style={{
                    color: "#75e6ff",
                  }}
                >
                  NEAREST NOMENCLATURE CONTEXT
                </span>

                <strong
                  style={{
                    display: "block",

                    marginTop: "4px",

                    color: "#a8bbc1",
                  }}
                >
                  {siteScience.nearest_feature_context.feature_name}
                </strong>

                <span>Context only. It is not the selected coordinate.</span>
              </div>
            )}
          </Panel>

          <Panel eyebrow="MISSION / OPERATIONS" title="Crewed Mars console" id="panel-crew">
            <MissionOpsPanel
              consoleState={missionConsoleState}
              profile={missionProfile}
              onProfileChange={setMissionProfile}
              onOpenOrbital={handleOpenOrbital}
            />
          </Panel>

          <Panel eyebrow="BRIEFING / NASA FEED" title="Mars reference feed" id="panel-feed">
            <MarsBriefingPanel />
          </Panel>
        </aside>
      </div>

      <footer className="evidence-bar">
        <div>
          <span>USGS</span>

          <strong>2,052 REGISTERED FEATURES</strong>
        </div>

        <div>
          <span>THEMIS</span>

          <strong>HISTORICAL IR-PBT</strong>
        </div>

        <div>
          <span>GCM</span>

          <strong>AMES MY34</strong>
        </div>

        <div>
          <span>MOLA</span>

          <strong>128 PX / DEG</strong>
        </div>

        <div>
          <span>MEDIA</span>

          <strong>NASA IMAGE LIBRARY</strong>
        </div>

        <div className="evidence-warning">
          <span>DATA MODEL</span>

          <strong>Observed · Modeled · Derived · Simulated</strong>
        </div>

        <div className="team-credit">
          <img src="/team-neuronexus-icon.png" alt="" width="18" height="18" />
          <span>© {new Date().getFullYear()} TEAM NEURONEXUS · NASA SPACE APPS CHALLENGE 2026</span>
          <a href={TEAM_URL} target="_blank" rel="noreferrer">
            MEET THE TEAM ↗
          </a>
        </div>
      </footer>

      <Mars3DView
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
    </main>
  );
}
