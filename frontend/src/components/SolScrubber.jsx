/* Global activeSol control (top bar): one slider drives every panel and view. */

import { useSol } from "../state/solStore";
import Icon from "../ui/Icon";

const MAX_SCENARIO_SOL = 668;

export default function SolScrubber() {
  const { sol, setSol, seasonLs, playing, setPlaying } = useSol();
  if (sol == null) return null;
  return (
    <div className="nn-solscrub" role="group" aria-label="Active sol">
      <span className="nn-solscrub-label">ACTIVE SOL</span>
      <button type="button" aria-label="Previous sol" onClick={() => setSol((s) => s - 1)}>
        <Icon name="play" size={12} className="nn-flip" />
      </button>
      <input
        type="range"
        min={1}
        max={MAX_SCENARIO_SOL}
        value={sol}
        aria-label="MY34 scenario sol"
        aria-valuetext={`sol ${sol}${seasonLs != null ? `, Ls ${seasonLs.toFixed(0)} degrees` : ""}`}
        onChange={(e) => setSol(Number(e.target.value))}
      />
      <button type="button" aria-label="Next sol" onClick={() => setSol((s) => s + 1)}>
        <Icon name="play" size={12} />
      </button>
      {setPlaying && (
        <button type="button" aria-pressed={playing} aria-label={playing ? "Pause" : "Play"} onClick={() => setPlaying(!playing)}>
          <Icon name={playing ? "pause" : "play"} size={12} />
        </button>
      )}
      <strong className="nn-solscrub-value">
        {sol}
        <small>{seasonLs != null ? ` · LS ${seasonLs.toFixed(0)}°` : ""}</small>
      </strong>
    </div>
  );
}
