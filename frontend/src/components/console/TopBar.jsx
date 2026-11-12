import SearchBar from "./SearchBar";
import { TelemetryPill } from "../BrowserOptimizationPanel";
import Icon from "../../ui/Icon";
import SolScrubber from "../SolScrubber";

/* Extracted from App.jsx (T7.8); state stays in App and arrives as props. */
export default function TopBar({ appMode, backendConnected, commandIndex, comparedRoutes, handleOpenOrbital, handleOpenSnapshot, handleSelectPlace, manualOpen, places, query, routePoints, selectedCandidateId, setCommandIndex, setDesignerOpen, setIntelligenceOpen, setManualOpen, setQuery, suggestions, switchMode }) {
  return (
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
          <SolScrubber />

          <div className="topbar-features">
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
          <div className="topbar-row">
            <TelemetryPill onOpen={() => setManualOpen(true)} />

            <div className="mode-switch" role="radiogroup" aria-label="Console mode (M)">
              {[
                ["global", "GLOBAL", " CONSOLE"],
                ["marswalk", "MARSWALK", ""],
              ].map(([key, label, rest]) => (
                <button key={key} type="button" role="radio" aria-checked={appMode === key} className={appMode === key ? "active" : undefined} onClick={() => switchMode(key)} title="Switch mode (M)">
                  {label}
                  {rest && <span className="mode-word">{rest}</span>}
                </button>
              ))}
            </div>
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

              <b className="status-label">
                <i className="status-word">SYSTEM </i>
                {backendConnected ? "ONLINE" : "DEGRADED"}
              </b>
            </div>
          </div>

          <div className="topbar-row">
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
              title="Mission Command Index (Ctrl/Cmd+K)"
              onClick={() => setCommandIndex((state) => ({ open: !state.open, tab: "commands" }))}
              style={{
                minWidth: "42px",

                minHeight: "32px",

                border: "1px solid #29414b",

                background: "#091115",

                color: "#75e6ff",

                fontFamily: "var(--nn-font)",

                fontSize: "20px",

                lineHeight: 1,

                cursor: "pointer",

                boxShadow: "0 0 16px rgba(117,230,255,0.06)",
              }}
            >
              <Icon name="index" size={18} title="Command index" />
            </button>

            <button type="button" className="burger-button" aria-label="Open Mission Operations Manual" aria-expanded={manualOpen} title="Mission Operations Manual" onClick={() => setManualOpen(true)}>
              <Icon name="menu" size={20} title="Mission Operations Manual" />
            </button>
          </div>
        </div>
      </div>
    </header>
  );
}
