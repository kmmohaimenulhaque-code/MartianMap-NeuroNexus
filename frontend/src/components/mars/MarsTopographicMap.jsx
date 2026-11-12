import { useMemo, useState } from "react";

/*
 * USGS SIM 3292 Geologic Map of Mars (Tanaka et al., 2014), served as an
 * ArcGIS Web AppBuilder application.
 *
 * SYNCHRONISATION MECHANISM
 * -------------------------
 * The application is cross-origin, so its DOM is never touched. Instead the
 * supported Web AppBuilder `extent` URL parameter is used. jimu.js applies
 * that extent directly (without reprojection) when the supplied WKT equals
 * the map's own spatial reference, which the backend guarantees by computing
 * Robinson_clon0_Mars_2000_Sphere coordinates server-side.
 *
 * The iframe is remounted with a new src whenever the shared mission
 * selection changes, so the left and right maps can never silently show
 * different places. If the backend sync call fails, the failure is shown
 * rather than hidden.
 */

const USGS_MARS_MAP_URL = "https://usgs.maps.arcgis.com/apps/webappviewer/index.html?id=fc004c3d21b64c398ed5458580ab7c58";

function coordinateLabel(target) {
  if (!target) {
    return null;
  }
  return `${Number(target.latitude_deg).toFixed(4)}°, ${Number(target.longitude_deg).toFixed(4)}°E`;
}

function UsgsFrame({ source }) {
  const [loaded, setLoaded] = useState(false);

  return (
    <div className="usgs-map-frame">
      {!loaded && <div className="usgs-map-loading">LOADING USGS ARCGIS APPLICATION…</div>}
      <iframe
        title="USGS Interactive Mars Scientific Map"
        src={source}
        loading="eager"
        allowFullScreen
        referrerPolicy="strict-origin-when-cross-origin"
        onLoad={() => setLoaded(true)}
      />
    </div>
  );
}

export default function MarsTopographicMap({
  syncTarget = null,
  syncUrl = null,
  syncStatus = "idle",
  syncError = "",
  halfWidthKm = 40,
  onRequestSync,
  onOpenSnapshot,
  snapshotAvailable = false,
}) {
  const source = syncUrl || USGS_MARS_MAP_URL;

  const status = useMemo(() => {
    if (syncStatus === "loading") {
      return { text: "SYNCHRONISING…", tone: "pending" };
    }
    if (syncStatus === "error") {
      return { text: "SYNC FAILED", tone: "error" };
    }
    if (syncUrl) {
      return { text: "SYNCED TO SELECTION", tone: "ok" };
    }
    return { text: "GLOBAL VIEW", tone: "idle" };
  }, [syncStatus, syncUrl]);

  return (
    <section className="usgs-scientific-map">
      <header className="usgs-map-header">
        <div className="usgs-map-heading">
          <span className="usgs-map-kicker">USGS / MARS · SIM 3292</span>
          <h2>INTERACTIVE SCIENTIFIC MAP</h2>
          <small className={`usgs-sync-state ${status.tone}`}>
            {status.text}
            {syncTarget ? ` · ${coordinateLabel(syncTarget)}` : ""}
            {syncUrl ? ` · ±${Number(halfWidthKm).toFixed(0)} km` : ""}
          </small>
        </div>
        <div className="usgs-map-actions">
          {snapshotAvailable && (
            <button type="button" className="usgs-map-open" onClick={onOpenSnapshot}>
              USGS SNAPSHOT
            </button>
          )}
          <button type="button" className="usgs-map-open" onClick={onRequestSync} disabled={!syncTarget || syncStatus === "loading"}>
            RE-SYNC
          </button>
          <a className="usgs-map-open" href={source} target="_blank" rel="noopener noreferrer">
            OPEN FULL MAP ↗
          </a>
        </div>
      </header>

      {syncStatus === "error" && (
        <div className="usgs-sync-error">
          USGS SYNCHRONISATION FAILED — {syncError || "the sync service did not respond."} The scientific map is showing its default extent.
        </div>
      )}

      {/* Keyed on the source so a new extent remounts the frame and the
          loading state resets without an effect writing state. */}
      <UsgsFrame key={source} source={source} />

      <footer className="usgs-map-footer">
        <span>TANAKA ET AL. 2014</span>
        <span>MOLA HILLSHADE</span>
        <span>GEOLOGIC UNITS</span>
        <span>ROBINSON / MARS 2000</span>
        <span>EXTENT PARAMETER SYNC</span>
      </footer>
    </section>
  );
}
