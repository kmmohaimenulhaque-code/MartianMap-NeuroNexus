import { SheetHead } from "../mobile/MobileDock";
import { Metric, Panel } from "./Panel";
import ThermalHeatmapCard from "../ThermalHeatmapCard";
import SolConditionsCard from "../SolConditionsCard";
import RoverPhotosPanel from "../mars/RoverPhotosPanel";

/* Second column of the Selected site panel: the thermal numbers at a glance, linked to the full THEMIS panel. */
function ThermalSummary({ thermalPanel, loading }) {
  const stat = (key) => thermalPanel.stats.find((m) => m.key === key)?.value ?? "n/a";
  const rows = [
    [/outside/i.test(thermalPanel.nearest.label) ? "Nearest (ref)" : "Nearest", thermalPanel.nearest.value],
    ["Mean", stat("mean")],
    ["Min / max", `${stat("min")} / ${stat("max")}`],
    ["Evidence", thermalPanel.evidence.label],
    ["Radius", thermalPanel.coverage.searchRadius],
  ];
  const na = (v) => v == null || /^(n\/a|n\/a \/ n\/a)$/i.test(String(v));
  return (
    <aside className="site-thermal-summary" aria-label="Thermal context summary">
      <span className="site-thermal-kicker">THERMAL CONTEXT</span>
      {loading && !thermalPanel.hasHistorical ? (
        <small className="site-thermal-note">Loading…</small>
      ) : (
        <dl>
          {rows.map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd className={na(value) ? "is-na" : undefined}>{value ?? "n/a"}</dd>
            </div>
          ))}
        </dl>
      )}
      {!thermalPanel.hasHistorical && !loading && <small className="site-thermal-note">No samples in the search radius</small>}
      <button
        type="button"
        className="site-thermal-link"
        onClick={() => document.getElementById("panel-thermal")?.scrollIntoView({ behavior: "smooth", block: "start" })}
      >
        FULL DETAILS ↓
      </button>
    </aside>
  );
}

/* Extracted from App.jsx (T7.8); state stays in App and arrives as props. */
export default function LeftColumn({ activeCustomPlace, displayName, displayType, loading, namedFeature, selectedLocation, solar, thermal, thermalPanel }) {
  return (
    <aside className="left-column">
      <SheetHead title="SITE INTEL" />
      <Panel eyebrow="GEOGRAPHY / NOMENCLATURE" title="Selected site" sources={["USGS_IAU_GAZETTEER", "MOLA_MEGDR"]}>
        <div className="place-title">
          <span className="signal">●</span>

          <div>
            <h3>{loading && !selectedLocation ? "Loading" : displayName}</h3>

            <p>{displayType}</p>
          </div>
        </div>

        <div className="coordinate-block">
          <span>LATITUDE</span>

          <strong>{selectedLocation ? `${Number(selectedLocation.latitude_deg).toFixed(4)}°` : "n/a"}</strong>

          <span>LONGITUDE</span>

          <strong>{selectedLocation ? `${Number(selectedLocation.longitude_deg).toFixed(4)}°E` : "n/a"}</strong>
        </div>

        <div className="rule" />

        <div className="site-split">
          <div className="site-split-main">
            <Metric
              label="Selection source"
              value={namedFeature ? "USGS / IAU FEATURE" : activeCustomPlace ? "USER PLACE" : selectedLocation ? "COORDINATE SELECTION" : "n/a"}
            />

            {namedFeature ? (
              <>
                <Metric
                  label="Diameter"
                  value={namedFeature.diameter_km == null ? "n/a" : `${Number(namedFeature.diameter_km).toFixed(2)} km`}
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

                  fontSize: "12px",

                  lineHeight: 1.5,
                }}
              >
                Exact coordinate selected. Nearby USGS nomenclature, when available, is context only.
              </div>
            )}
          </div>

          <ThermalSummary thermalPanel={thermalPanel} loading={loading} />
        </div>
      </Panel>

      <Panel eyebrow="IMAGERY / ROVER" title="Applicable rover photos" sources={["NASA_IMAGE_LIBRARY"]}>
        <RoverPhotosPanel feature={namedFeature} />
      </Panel>

      <Panel eyebrow="THERMAL / NASA THEMIS" title="Historical evidence" id="panel-thermal" sources={["THEMIS"]}>
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

        <ThermalHeatmapCard location={selectedLocation} />
        <SolConditionsCard lat={selectedLocation?.latitude_deg} lon={selectedLocation?.longitude_deg} />

        <div className="source-note">
          <span>SOURCE</span>

          <strong>{thermal?.product_id ?? "NASA THEMIS IR-PBT"}</strong>
        </div>
      </Panel>

      <Panel eyebrow="ENVIRONMENT / SOLAR" title="Solar geometry" id="panel-solar" sources={["NEURONEXUS_SOLAR_GEOMETRY"]}>
        <Metric label="Areocentric longitude" value={solar ? `${Number(solar.areocentric_longitude_deg).toFixed(2)}°` : "n/a"} detail="Ls" />

        <Metric label="Observation local solar time" value={thermal ? `${Number(thermal.local_solar_time_hours).toFixed(2)} h` : "n/a"} />
      </Panel>
    </aside>
  );
}
