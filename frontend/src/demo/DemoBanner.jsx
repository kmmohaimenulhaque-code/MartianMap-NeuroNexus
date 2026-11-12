/* Visible on the static demo only: says plainly that responses are recorded, real and not live. */

import Popover from "../ui/Popover";

export default function DemoBanner({ recordedAt }) {
  return (
    <div className="nn-demo-banner" role="status">
      <strong>[STATIC DEMO]</strong>
      <span>Replaying real API responses recorded from the live NeuroNexus backend{recordedAt ? ` on ${recordedAt}` : ""}. Not live data.</span>
      <Popover label="WHAT WORKS" title="Static demo scope" align="right">
        The Gale and Jezero Marswalk demos, the global console at Gale, every MY34 sol on the ACTIVE SOL slider (dust,
        conditions, rover position), validation, sources and exports work from recorded responses. Requests outside the
        recorded set (other sites, new routes, Mars Intelligence) answer NOT IN DEMO PACK instead of a made-up value. Run the
        full console locally for live computation (README, Quick start).
      </Popover>
    </div>
  );
}
