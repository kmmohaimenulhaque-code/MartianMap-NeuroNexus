import { useMemo, useState } from 'react'

import './mission-ops.css'
import HazardDefencePanel from './HazardDefencePanel'

const TABS = [
  'MISSION',
  'CREW',
  'VEHICLES',
  'EVA',
  'RADIATION',
  'LIFE SUPPORT',
  'RESOURCES',
]

const CREW = [
  {
    id: 'CREW-01',
    role: 'COMMAND',
    status: 'SIM READY',
    eva: 'STANDBY',
  },
  {
    id: 'CREW-02',
    role: 'PILOT / SYSTEMS',
    status: 'SIM READY',
    eva: 'STANDBY',
  },
  {
    id: 'CREW-03',
    role: 'GEOLOGY / SCIENCE',
    status: 'SIM READY',
    eva: 'STANDBY',
  },
  {
    id: 'CREW-04',
    role: 'MEDICAL / EVA',
    status: 'SIM READY',
    eva: 'STANDBY',
  },
]

const VEHICLES = [
  ['DEEP-SPACE TRANSIT', 'SIM-TRANSIT-01'],
  ['MARS LANDER / ASCENDER', 'SIM-LA-01'],
  ['PRESSURISED ROVER', 'SIM-PR-01'],
  ['SURFACE SCOUT', 'SIM-SCOUT-01'],
  ['SURFACE HABITAT', 'SIM-HAB-01'],
]

function Stat({ label, value, detail }) {
  return (
    <div className="mission-stat">
      <span>{label}</span>
      <strong>{value}</strong>
      {detail ? <small>{detail}</small> : null}
    </div>
  )
}

function Row({ label, value, tone = '' }) {
  return (
    <div className="mission-row">
      <span>{label}</span>
      <strong className={tone}>{value}</strong>
    </div>
  )
}

function Section({ title, children }) {
  return (
    <div className="mission-section">
      <div className="mission-section-title">{title}</div>
      {children}
    </div>
  )
}

export default function MissionOpsPanel({
  selectedFeature,
  sol,
  environment,
  routePlan,
}) {
  const [activeTab, setActiveTab] = useState('MISSION')

  const siteName =
    selectedFeature?.feature_name ??
    environment?.gazetteer?.selected_feature?.feature_name ??
    'UNSELECTED'

  const atmosphericGases = useMemo(
    () => environment?.site_science?.atmosphere?.gases ?? [],
    [environment],
  )

  const routeDistance = routePlan?.planned_route?.planned_route_km

  return (
    <PanelFrame>
      <div className="mission-ops-tabs" role="tablist" aria-label="Mission control views">
        {TABS.map((tab) => (
          <button
            key={tab}
            type="button"
            role="tab"
            aria-selected={activeTab === tab}
            className={activeTab === tab ? 'active' : ''}
            onClick={() => setActiveTab(tab)}
          >
            {tab}
          </button>
        ))}
      </div>

      <div className="mission-sim-banner">
        <span>MODE</span>
        <strong>SIMULATION / RESEARCH MODEL</strong>
        <small>NOT A LIVE CREW, VEHICLE OR MISSION CONTROL FEED</small>
      </div>

      {activeTab === 'MISSION' && (
        <>
          <div className="mission-kpi-grid">
            <Stat label="Mission" value="NN-MARS-01" />
            <Stat label="Phase" value="SURFACE OPS" />
            <Stat label="Sol" value={String(sol ?? 0)} />
            <Stat label="Site" value={siteName} />
          </div>

          <Section title="Mission definition">
            <Row label="Objective" value="Science survey + traverse + resource reconnaissance" />
            <Row label="Landing site" value={siteName} />
            <Row label="Route geometry" value={routeDistance == null ? 'NOT PLANNED' : `${Number(routeDistance).toFixed(2)} km`} />
            <Row label="Navigation model" value="Haversine waypoint geometry" />
            <Row label="Terrain search" value="NONE / LOCAL MOLA ONLY" />
            <Row label="Mission status" value="SURFACE SIMULATION ACTIVE" tone="ok" />
          </Section>

          <Section title="Mission timeline">
            <Row label="Earth departure" value="CONFIGURABLE" />
            <Row label="Mars arrival" value="CONFIGURABLE" />
            <Row label="Surface campaign" value="CONFIGURABLE" />
            <Row label="Return / ascent" value="CONFIGURABLE" />
          </Section>
        </>
      )}

      {activeTab === 'CREW' && (
        <>
          <Section title="Crew manifest">
            {CREW.map((member) => (
              <div className="mission-crew-row" key={member.id}>
                <div>
                  <strong>{member.id}</strong>
                  <small>{member.role}</small>
                </div>
                <span>{member.status}</span>
                <span>{member.eva}</span>
              </div>
            ))}
          </Section>
          <Section title="Crew monitoring">
            <Row label="Biometrics" value="NOT CONNECTED" />
            <Row label="Dosimeters" value="NOT CONNECTED" />
            <Row label="Consumables load" value="SIMULATED" />
            <Row label="Isolation / confinement" value="SIMULATION ONLY" />
          </Section>
        </>
      )}

      {activeTab === 'VEHICLES' && (
        <>
          <Section title="Spacecraft / surface assets">
            {VEHICLES.map(([name, id]) => (
              <div className="mission-vehicle-row" key={id}>
                <div>
                  <strong>{name}</strong>
                  <small>{id}</small>
                </div>
                <span>SIM NOMINAL</span>
              </div>
            ))}
          </Section>
          <Section title="Vehicle systems">
            <Row label="Power" value="100% SIM" />
            <Row label="Avionics" value="NOMINAL / SIM" />
            <Row label="Communications" value="NOMINAL / SIM" />
            <Row label="Propellant" value="100% SIM" />
            <Row label="Thermal control" value="NOMINAL / SIM" />
            <Row label="Dust protection" value="MONITORED / SIM" />
          </Section>
        </>
      )}

      {activeTab === 'EVA' && (
        <>
          <Section title="EVA console">
            <Row label="EVA state" value="STANDBY" tone="ok" />
            <Row label="Suit pressure" value="NOMINAL / SIM" />
            <Row label="Portable life support" value="NOMINAL / SIM" />
            <Row label="Suit O₂" value="100% SIM" />
            <Row label="CO₂ scrubbing" value="100% SIM" />
            <Row label="Suit battery" value="100% SIM" />
            <Row label="Thermal control" value="100% SIM" />
            <Row label="Comms" value="NOMINAL / SIM" />
            <Row label="Distance from habitat" value="0.00 km" />
          </Section>
          <Section title="Surface mobility">
            <Row label="Rover support" value="AVAILABLE / SIM" />
            <Row label="Return path" value="MANUAL REVIEW REQUIRED" />
            <Row label="Dust exposure" value="SITE / SCENARIO DEPENDENT" />
            <Row label="Slope review" value="LOCAL MOLA WAYPOINT DATA" />
          </Section>
        </>
      )}

      {activeTab === 'RADIATION' && (
        <>
          <Section title="Radiation monitor">
            <Row label="Surface reference" value="~210 µGy/day" />
            <Row label="Reference source" value="Curiosity / RAD historical data" />
            <Row label="GCR monitoring" value="REFERENCE ONLY" />
            <Row label="Solar particle events" value="NO LIVE FEED" />
            <Row label="Crew dosimeters" value="NOT CONNECTED" />
            <Row label="Shelter state" value="STANDBY" />
          </Section>
          <div className="mission-warning">
            Historical RAD measurements are context, not a live forecast or crew dose calculation. Any operational radiation limit must come from the selected mission standard and a validated radiation model.
          </div>
        </>
      )}

      {activeTab === 'LIFE SUPPORT' && (
        <>
          <Section title="ECLSS / life support">
            <Row label="Cabin pressure" value="NOMINAL / SIM" />
            <Row label="O₂ generation / reserve" value="SIMULATED" />
            <Row label="CO₂ removal" value="NOMINAL / SIM" />
            <Row label="Water recovery" value="NOMINAL / SIM" />
            <Row label="Waste processing" value="NOMINAL / SIM" />
            <Row label="Food inventory" value="SIMULATED" />
            <Row label="Surface ISRU" value="SITE / TECHNOLOGY DEPENDENT" />
            <Row label="Power availability" value="NOMINAL / SIM" />
          </Section>
          <Section title="Habitat resilience">
            <Row label="Backup life support" value="CONFIGURABLE" />
            <Row label="Emergency shelter" value="CONFIGURABLE" />
            <Row label="Safe-haven location" value={siteName} />
          </Section>
        </>
      )}

      {activeTab === 'RESOURCES' && (
        <>
          <Section title="Atmosphere">
            {atmosphericGases.length > 0 ? atmosphericGases.slice(0, 5).map((gas) => (
              <Row
                key={gas.name}
                label={gas.name}
                value={gas.volume_percent == null ? 'NO SITE VALUE' : `${gas.volume_percent}%`}
              />
            )) : <Row label="Atmosphere" value="GLOBAL REFERENCE" />}
          </Section>
          <Section title="Surface resources">
            <Row label="Regolith / soil" value={environment?.site_science?.soil?.value ?? 'CONTEXT ONLY'} />
            <Row label="Minerals" value={environment?.site_science?.minerals?.value ?? 'NOT INGESTED'} />
            <Row label="Water" value="SITE-SPECIFIC EVIDENCE REQUIRED" />
            <Row label="Bioavailability" value={environment?.site_science?.bioavailability?.value ?? 'PROXY ONLY'} />
            <Row label="Vegetation" value={environment?.site_science?.vegetation?.value ?? 'NO CONFIRMED NATIVE VEGETATION'} />
          </Section>
          <div className="mission-source-note">
            Resource fields deliberately distinguish measured, modeled, derived and simulated values. Missing site-specific evidence stays marked rather than being inferred.
          </div>
        </>
      )}
    </PanelFrame>
  )
}

function PanelFrame({ children }) {
  return <div className="mission-ops-panel">{children}</div>
}
