import { Panel } from "./Panel";

/* Extracted from App.jsx (T7.8); state stays in App and arrives as props. */

/* The backend reports enums such as "evidence_available"; show them as plain words ("Evidence available"). */
function humanStatus(value) {
  if (value === null || value === undefined || value === "") return "n/a";
  const text = String(value).replace(/_/g, " ").trim().toLowerCase();
  return text.charAt(0).toUpperCase() + text.slice(1);
}
export default function InterpretationPanel({ environment, siteScience }) {
  return (
    <Panel eyebrow="ASSESSMENT / EVIDENCE" title="Interpretation" id="panel-interpretation" sources={["NN_TERRAIN_RISK_PROXY"]}>
      <div className="assessment-status">
        <span>STATUS</span>

        <strong>{humanStatus(environment?.assessment?.assessment_status)}</strong>
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

            border: "1px solid rgba(1,255,255,0.08)",

            background: "#081014",

            color: "#667a82",

            fontSize: "12px",

            lineHeight: 1.45,
          }}
        >
          <span
            style={{
              color: "var(--nn-cyan)",
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
  );
}
