import { MAX_COMPARE_ROUTES } from "../../route/RouteComparisonWorkspace";
import { Metric } from "./Panel";
import { MAX_ROUTE_POINTS } from "../../utils/appHelpers";

export default function RouteConsole({
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
  sheetHead = null,
}) {
  const displacement = routePlan?.displacement?.distance_km;

  const planned = routePlan?.planned_route?.planned_route_km;

  const extension = routePlan?.planned_route?.extension_km;

  return (
    <div className="route-console">
      {sheetHead}
      <div className="route-console-main">
        <div className="route-console-heading">
          <span>NAVIGATION / USER WAYPOINTS</span>

          <strong>
            {routeMode ? "PLAN ROUTE ACTIVE" : routePoints.length ? `${routePoints.length} WAYPOINT${routePoints.length === 1 ? "" : "S"}` : "READY"}
          </strong>
        </div>

        <small>
          {routeMode
            ? "Click anywhere on the colored Mars map to add a waypoint."
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
          <Metric label="Displacement" value={displacement == null ? "n/a" : `${Number(displacement).toFixed(2)} km`} />

          <Metric label="Planned route" value={planned == null ? "n/a" : `${Number(planned).toFixed(2)} km`} />

          <Metric label="Extension" value={extension == null ? "n/a" : `${Number(extension).toFixed(2)} km`} />
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

            fontFamily: "var(--nn-font)",

            fontSize: "12px",

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

            fontFamily: "var(--nn-font)",

            fontSize: "12px",

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

          fontFamily: "var(--nn-font)",

          fontSize: "12px",
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
