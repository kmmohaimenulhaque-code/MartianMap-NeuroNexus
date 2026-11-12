
/* Extracted from App.jsx (T7.8); state stays in App and arrives as props. */
export default function EvidenceBar({ TEAM_URL, setSourcesDrawer }) {
  return (
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

        <button type="button" className="evidence-sources" onClick={() => setSourcesDrawer({ open: true, focusId: null })}>
          [SOURCE LEDGER]
        </button>
      </div>

      <div className="team-credit">
        <img src="/team-neuronexus-icon.png" alt="" width="18" height="18" />
        <span>© {new Date().getFullYear()} TEAM NEURONEXUS · NASA SPACE APPS CHALLENGE 2026</span>
        <a href={TEAM_URL} target="_blank" rel="noreferrer">
          MEET THE TEAM ↗
        </a>
      </div>
    </footer>
  );
}
