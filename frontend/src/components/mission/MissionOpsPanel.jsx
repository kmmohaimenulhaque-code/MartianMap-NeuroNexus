import { useMemo, useState } from "react";

import "./mission-ops.css";
import { NASA_LINKS, buildMissionConsoleState } from "../../utils/missionConsole.js";

/*
 * CREWED MARS CONSOLE
 *
 * Every panel is derived from the mission state owned by App.jsx. This
 * component holds no mission data of its own, so nothing can drift from the
 * single source of truth. Values that are not modelled say so, and each row
 * links to the NASA or partner reference it rests on.
 */

const TABS = ["MISSION", "CREW", "VEHICLES", "EVA", "RADIATION", "LIFE SUPPORT", "RESOURCES"];

const TONE = {
  "NASA OBSERVED": "observed",
  "NASA REFERENCE": "reference",
  MODELED: "modeled",
  DERIVED: "derived",
  COMPUTED: "derived",
  "PROJECT DATA": "project",
  SIMULATED: "sim",
  CONFIGURABLE: "config",
  "NOT MODELED": "missing",
  "NOT CONNECTED": "missing",
  "NO LIVE FEED": "missing",
  "NOT INGESTED": "missing",
  UNAVAILABLE: "missing",
  "NONE DEFINED": "missing",
};

function Row({ label, entry, link, linkLabel }) {
  const value = entry?.value ?? "UNAVAILABLE";
  const status = entry?.status ?? "UNAVAILABLE";
  const href = link ?? entry?.url;
  return (
    <div className="mission-row">
      <span>{label}</span>
      <strong className={TONE[status] ?? ""}>
        {typeof value === "number" ? value : String(value)}
        <em className={`mission-tag ${TONE[status] ?? ""}`}>{status}</em>
        {href && (
          <a href={href} target="_blank" rel="noreferrer" className="mission-src">
            {linkLabel ?? entry?.source ?? "SOURCE"} ↗
          </a>
        )}
      </strong>
      {entry?.detail && <small className="mission-detail">{entry.detail}</small>}
    </div>
  );
}

function Stat({ label, entry }) {
  return (
    <div className="mission-stat">
      <span>{label}</span>
      <strong>{String(entry?.value ?? "UNAVAILABLE")}</strong>
      <small>{entry?.status}</small>
    </div>
  );
}

function Section({ title, children, link, linkLabel }) {
  return (
    <div className="mission-section">
      <div className="mission-section-title">
        {title}
        {link && (
          <a href={link} target="_blank" rel="noreferrer">
            {linkLabel ?? "NASA reference"} ↗
          </a>
        )}
      </div>
      {children}
    </div>
  );
}

export default function MissionOpsPanel({ consoleState, missionInput, profile, onProfileChange, onOpenOrbital }) {
  const [activeTab, setActiveTab] = useState("MISSION");
  const [editing, setEditing] = useState(false);

  const state = useMemo(() => consoleState ?? buildMissionConsoleState(missionInput ?? {}), [consoleState, missionInput]);

  function updateProfile(patch) {
    onProfileChange?.({ ...profile, ...patch });
  }

  function updateLifeSupport(patch) {
    onProfileChange?.({ ...profile, lifeSupport: { ...(profile?.lifeSupport ?? {}), ...patch } });
  }

  return (
    <div className="mission-ops-panel">
      <div className="mission-ops-tabs" role="tablist" aria-label="Mission control views">
        {TABS.map((tab) => (
          <button
            key={tab}
            type="button"
            role="tab"
            aria-selected={activeTab === tab}
            className={activeTab === tab ? "active" : ""}
            onClick={() => setActiveTab(tab)}
          >
            {tab}
          </button>
        ))}
      </div>

      <div className="mission-sim-banner">
        <span>MODE</span>
        <strong>{state.mode}</strong>
        <small>{state.banner}</small>
      </div>

      {activeTab === "MISSION" && (
        <>
          <div className="mission-kpi-grid">
            <Stat label="Mission" entry={state.mission.id} />
            <Stat label="Phase" entry={state.mission.phase} />
            <Stat label="Sol" entry={state.mission.sol} />
            <Stat label="Site" entry={state.mission.site} />
          </div>

          <Section title="Mission definition" link={NASA_LINKS.moonToMars} linkLabel="NASA Moon to Mars">
            <Row label="Objective" entry={state.mission.objective} />
            <Row label="Coordinate" entry={state.mission.coordinate} link={NASA_LINKS.usgsNomenclature} linkLabel="USGS gazetteer" />
            <Row label="Route" entry={state.mission.route_name} />
            <Row label="Route distance" entry={state.mission.route_distance_km} />
            <Row label="Route status" entry={state.mission.route_status} />
            <Row label="Navigation model" entry={state.mission.navigation_model} />
            <Row label="Terrain analysis" entry={state.mission.terrain_analysis} />
            <Row label="Selected candidate" entry={state.mission.selected_candidate} />
            <Row label="Candidates generated" entry={state.mission.candidate_count} />
            <Row label="Saved routes" entry={state.mission.saved_routes} />
          </Section>

          <Section title="Mission timeline (configurable)" link={NASA_LINKS.humansToMars} linkLabel="NASA humans to Mars">
            {editing ? (
              <div className="mission-edit">
                <label>
                  Mission ID
                  <input value={profile?.missionId ?? ""} onChange={(event) => updateProfile({ missionId: event.target.value })} />
                </label>
                <label>
                  Phase
                  <input value={profile?.phase ?? ""} onChange={(event) => updateProfile({ phase: event.target.value })} />
                </label>
                <label>
                  Objective
                  <input value={profile?.objective ?? ""} onChange={(event) => updateProfile({ objective: event.target.value })} />
                </label>
                <label>
                  Earth departure
                  <input
                    value={profile?.earthDeparture ?? ""}
                    onChange={(event) => updateProfile({ earthDeparture: event.target.value })}
                    placeholder="e.g. 2033-04"
                  />
                </label>
                <label>
                  Mars arrival
                  <input value={profile?.marsArrival ?? ""} onChange={(event) => updateProfile({ marsArrival: event.target.value })} />
                </label>
                <label>
                  Surface campaign (sols)
                  <input
                    value={profile?.surfaceCampaignSols ?? ""}
                    onChange={(event) => updateProfile({ surfaceCampaignSols: event.target.value })}
                  />
                </label>
                <label>
                  Return window
                  <input value={profile?.returnWindow ?? ""} onChange={(event) => updateProfile({ returnWindow: event.target.value })} />
                </label>
              </div>
            ) : (
              <>
                <Row label="Earth departure" entry={state.mission.timeline.earth_departure} />
                <Row label="Mars arrival" entry={state.mission.timeline.mars_arrival} />
                <Row label="Surface campaign" entry={state.mission.timeline.surface_campaign_sols} />
                <Row label="Return window" entry={state.mission.timeline.return_window} />
              </>
            )}
            <button type="button" className="mission-edit-toggle" onClick={() => setEditing((value) => !value)}>
              {editing ? "DONE" : "CONFIGURE SIMULATION PROFILE"}
            </button>
          </Section>
        </>
      )}

      {activeTab === "CREW" && (
        <>
          <Section title="Crew manifest (simulation)" link={NASA_LINKS.eva} linkLabel="NASA EVA programme">
            {state.crew.manifest.map((member) => (
              <div className="mission-crew-row" key={member.id}>
                <div>
                  <strong>{member.id}</strong>
                  <small>{member.role}</small>
                </div>
                <span>{member.eva_readiness}</span>
                <span>{member.estimated_eva_hours == null ? "NO EVA ASSIGNED" : `${member.estimated_eva_hours} h est.`}</span>
                <span className={member.eva_within_shift_limit === "EXCEEDS CONFIGURED LIMIT" ? "warn" : ""}>{member.eva_within_shift_limit}</span>
              </div>
            ))}
            <Row label="Route assignment" entry={{ value: state.crew.manifest[0]?.route_assignment ?? "NONE", status: "PROJECT DATA" }} />
            <Row label="EVA shift limit" entry={state.crew.eva_shift_limit_hours} />
          </Section>

          <Section title="Crew monitoring" link={NASA_LINKS.humanHealth} linkLabel="NASA Human Research Program">
            <Row label="Biometrics" entry={state.crew.biometrics} />
            <Row label="Dosimeters" entry={state.crew.dosimeters} />
            <Row label="Consumables load" entry={state.crew.consumables} />
            <div className="mission-warning">
              Crew biometrics are never fabricated. Readiness and EVA burden are simulation values derived from the current route.
            </div>
          </Section>
        </>
      )}

      {activeTab === "VEHICLES" && (
        <Section title="Spacecraft / surface assets" link={NASA_LINKS.moonToMars} linkLabel="NASA architecture">
          {state.vehicles.map((vehicle) => (
            <div className="mission-vehicle-block" key={vehicle.id}>
              <div className="mission-vehicle-row">
                <div>
                  <strong>{vehicle.class}</strong>
                  <small>{vehicle.id}</small>
                </div>
                <span>{vehicle.route_assignment}</span>
                <a href={vehicle.link} target="_blank" rel="noreferrer">
                  NASA ↗
                </a>
              </div>
              <div className="mission-vehicle-detail">
                <span>
                  Route distance <strong>{vehicle.route_distance_km ?? "NOT ASSIGNED"}</strong>
                </span>
                <span>
                  Power <strong className="missing">{String(vehicle.power.value)}</strong>
                </span>
                <span>
                  Propellant <strong className="missing">{String(vehicle.propellant.value)}</strong>
                </span>
                <span>
                  Comms <strong className="missing">{String(vehicle.communications.value)}</strong>
                </span>
                <span>
                  Thermal <strong className="missing">{String(vehicle.thermal_control.value)}</strong>
                </span>
                <span>
                  Sim state <strong className="sim">{vehicle.simulation_state}</strong>
                </span>
              </div>
            </div>
          ))}
          <div className="mission-warning">
            Power, propellant, communications and thermal control are NOT MODELED here. No fictional percentage is displayed as though it were
            measured.
          </div>
        </Section>
      )}

      {activeTab === "EVA" && (
        <>
          <Section title="EVA console (derived from the current route)" link={NASA_LINKS.spacesuits} linkLabel="NASA spacesuits">
            <Row label="EVA state" entry={state.eva.state} />
            <Row label="Route distance" entry={state.eva.route_distance_km} />
            <Row label="Estimated EVA duration" entry={state.eva.estimated_eva_hours} />
            <Row label="EVA pace" entry={state.eva.eva_pace_kmh} />
            <Row label="Ascent allowance" entry={state.eva.ascent_allowance_m_per_h} />
            <Row label="Distance from habitat" entry={state.eva.distance_from_habitat_km} />
            <Row label="Planned return path" entry={state.eva.return_path} />
          </Section>

          <Section title="Terrain and environment context" link={NASA_LINKS.mola} linkLabel="NASA MOLA MEGDR">
            <Row label="Terrain burden" entry={state.eva.terrain_burden_score} />
            <Row label="Terrain-risk proxy" entry={state.eva.terrain_risk_proxy} />
            <Row label="Mean slope" entry={state.eva.mean_slope_deg} />
            <Row label="Max slope" entry={state.eva.max_slope_deg} />
            <Row label="Dust context" entry={state.eva.dust_context} />
          </Section>

          <Section title="Safe-haven relationship" link={NASA_LINKS.marsExploration} linkLabel="NASA Mars exploration">
            <Row label="Status" entry={{ value: state.eva.safe_haven_relationship.status, status: "COMPUTED" }} />
            <Row
              label="Nearest Safe Haven"
              entry={{
                value: state.eva.safe_haven_relationship.nearest_safe_haven
                  ? `${state.eva.safe_haven_relationship.nearest_safe_haven.name ?? "Safe Haven"} · ${state.eva.safe_haven_relationship.nearest_safe_haven.distance_km.toFixed(2)} km`
                  : "UNAVAILABLE",
                status: state.eva.safe_haven_relationship.nearest_safe_haven ? "COMPUTED" : "UNAVAILABLE",
              }}
            />
            <Row
              label="Max distance to nearest haven"
              entry={{
                value:
                  state.eva.safe_haven_relationship.max_distance_to_nearest_safe_haven_km != null
                    ? `${state.eva.safe_haven_relationship.max_distance_to_nearest_safe_haven_km.toFixed(2)} km`
                    : "UNAVAILABLE",
                status: state.eva.safe_haven_relationship.max_distance_to_nearest_safe_haven_km != null ? "COMPUTED" : "UNAVAILABLE",
              }}
            />
            <div className="mission-warning">
              {state.eva.safe_haven_relationship.note ??
                "A Safe Haven is a user-defined planning location. It is not established as physically safe."}
            </div>
          </Section>
        </>
      )}

      {activeTab === "RADIATION" && (
        <>
          <Section title="Radiation reference" link={NASA_LINKS.rad} linkLabel="NASA MSL/RAD">
            <Row label="Surface reference" entry={state.radiation.surface_reference} />
            <Row label="Instrument" entry={state.radiation.instrument} />
            <Row label="GCR context" entry={state.radiation.gcr_context} />
            <Row label="Solar particle events" entry={state.radiation.solar_particle_events} />
            <Row label="Crew dosimeters" entry={state.radiation.crew_dosimeters} />
            <Row label="Shelter configuration" entry={state.radiation.shelter_configuration} />
            <Row label="Route radiation context" entry={state.radiation.route_radiation_context} />
          </Section>
          <div className="mission-warning">
            Historical RAD measurements are context, not a live forecast or a crew dose calculation. Any operational radiation limit must come from
            the selected mission standard and a validated radiation model.
          </div>
        </>
      )}

      {activeTab === "LIFE SUPPORT" && (
        <>
          <Section title="ECLSS / life support (configurable simulation profile)" link={NASA_LINKS.eclss} linkLabel="NASA ECLSS">
            {editing ? (
              <div className="mission-edit">
                <label>
                  Cabin pressure (kPa)
                  <input
                    value={profile?.lifeSupport?.cabinPressureKpa ?? ""}
                    onChange={(event) => updateLifeSupport({ cabinPressureKpa: event.target.value })}
                  />
                </label>
                <label>
                  O₂ reserve (days)
                  <input
                    value={profile?.lifeSupport?.oxygenReserveDays ?? ""}
                    onChange={(event) => updateLifeSupport({ oxygenReserveDays: event.target.value })}
                  />
                </label>
                <label>
                  CO₂ removal capacity
                  <input
                    value={profile?.lifeSupport?.co2RemovalCapacity ?? ""}
                    onChange={(event) => updateLifeSupport({ co2RemovalCapacity: event.target.value })}
                  />
                </label>
                <label>
                  Water recovery (%)
                  <input
                    value={profile?.lifeSupport?.waterRecoveryPercent ?? ""}
                    onChange={(event) => updateLifeSupport({ waterRecoveryPercent: event.target.value })}
                  />
                </label>
                <label>
                  Food inventory (days)
                  <input
                    value={profile?.lifeSupport?.foodInventoryDays ?? ""}
                    onChange={(event) => updateLifeSupport({ foodInventoryDays: event.target.value })}
                  />
                </label>
                <label>
                  Power budget (kW)
                  <input
                    value={profile?.lifeSupport?.powerBudgetKw ?? ""}
                    onChange={(event) => updateLifeSupport({ powerBudgetKw: event.target.value })}
                  />
                </label>
                <label>
                  Backup life support
                  <input
                    value={profile?.lifeSupport?.backupLifeSupport ?? ""}
                    onChange={(event) => updateLifeSupport({ backupLifeSupport: event.target.value })}
                  />
                </label>
                <label>
                  Emergency shelter
                  <input
                    value={profile?.lifeSupport?.emergencyShelter ?? ""}
                    onChange={(event) => updateLifeSupport({ emergencyShelter: event.target.value })}
                  />
                </label>
              </div>
            ) : (
              <>
                <Row label="Cabin pressure target" entry={state.life_support.cabin_pressure_kpa} />
                <Row label="O₂ reserve" entry={state.life_support.oxygen_reserve_days} />
                <Row label="CO₂ removal capacity" entry={state.life_support.co2_removal_capacity} />
                <Row label="Water recovery" entry={state.life_support.water_recovery_percent} />
                <Row label="Food inventory" entry={state.life_support.food_inventory_days} />
                <Row label="Power budget" entry={state.life_support.power_budget_kw} />
                <Row label="Backup life support" entry={state.life_support.backup_life_support} />
                <Row label="Emergency shelter" entry={state.life_support.emergency_shelter} />
              </>
            )}
            <button type="button" className="mission-edit-toggle" onClick={() => setEditing((value) => !value)}>
              {editing ? "DONE" : "CONFIGURE LIFE-SUPPORT PROFILE"}
            </button>
          </Section>

          <Section title="Habitat resilience" link={NASA_LINKS.isru} linkLabel="NASA ISRU">
            <Row label="Safe Havens defined" entry={state.life_support.safe_havens} />
            <Row label="ISRU context" entry={state.life_support.isru_context} />
          </Section>
        </>
      )}

      {activeTab === "RESOURCES" && (
        <>
          <Section title="Atmosphere" link={NASA_LINKS.marsFacts} linkLabel="NASA Mars facts">
            {state.resources.atmosphere.map((gas) => (
              <div className="mission-row" key={gas.name}>
                <span>{gas.name}</span>
                <strong className={TONE[gas.status] ?? ""}>
                  {gas.volume_percent == null ? "NO SITE VALUE" : `${gas.volume_percent}%`}
                  <em className={`mission-tag ${TONE[gas.status] ?? ""}`}>{gas.status}</em>
                  {gas.url && (
                    <a href={gas.url} target="_blank" rel="noreferrer" className="mission-src">
                      {gas.source} ↗
                    </a>
                  )}
                </strong>
              </div>
            ))}
            <Row label="Dust opacity" entry={state.resources.dust_opacity} />
          </Section>

          <Section title="Surface resources" link={NASA_LINKS.water} linkLabel="NASA water on Mars">
            <Row label="Regolith / soil" entry={state.resources.soil} />
            <Row label="Minerals" entry={state.resources.minerals} link={NASA_LINKS.mro} linkLabel="NASA MRO" />
            <Row label="Water" entry={state.resources.water} />
            <Row label="Bioavailability" entry={state.resources.bioavailability} />
            <Row label="Vegetation" entry={state.resources.vegetation} />
            <Row label="Thermal reference" entry={state.resources.thermal_reference} link={NASA_LINKS.themis} linkLabel="NASA THEMIS" />
          </Section>

          <div className="mission-source-note">
            Resource fields distinguish observed, modelled, derived and simulated values. Missing site-specific evidence stays marked rather than
            being inferred.
          </div>
        </>
      )}

      <div className="mission-orbital-strip">
        <div>
          <span>NEAR-MARS TRACKING</span>
          <strong>{state.orbital_tracking.tracking_status}</strong>
          {state.orbital_tracking.next_approach && (
            <small>
              Next: {state.orbital_tracking.next_approach.designation} · {state.orbital_tracking.next_approach.close_approach_tdb} ·{" "}
              {Number(state.orbital_tracking.next_approach.distance_au).toFixed(5)} au
            </small>
          )}
        </div>
        <button type="button" onClick={onOpenOrbital}>
          OPEN TRACKING
        </button>
      </div>
    </div>
  );
}
