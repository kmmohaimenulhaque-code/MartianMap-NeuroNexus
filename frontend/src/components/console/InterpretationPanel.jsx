import { Panel } from "./Panel";

/* Extracted from App.jsx (T7.8); state stays in App and arrives as props. */
export default function InterpretationPanel({ environment, siteScience }) {
  return (
    <Panel eyebrow="ASSESSMENT / EVIDENCE" title="Interpretation" id="panel-interpretation" sources={["NN_TERRAIN_RISK_PROXY"]}>
      <div className="assessment-status">
        <span>STATUS</span>

        <strong>{environment?.assessment?.assessment_status ?? "n/a"}</strong>
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

            border: "1px solid rgba(117,230,255,0.08)",

            background: "#081014",

            color: "#667a82",

            fontSize: "12px",

            lineHeight: 1.45,
          }}
        >
          <span
            style={{
              color: "#75e6ff",
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
