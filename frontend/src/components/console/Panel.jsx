import { SourceTags } from "../../sources/SourceTag";

/* Console panel with optional source tags in its heading, and a labeled metric. */
export function Panel({ eyebrow, title, children, className = "", id, sources }) {
  return (
    <section className={`panel ${className}`} id={id}>
      <div className="panel-heading">
        <div>
          {eyebrow && <div className="eyebrow">{eyebrow}</div>}

          <h2>{title}</h2>

          {sources?.length > 0 && <SourceTags ids={sources} />}
        </div>

        <span className="panel-mark">+</span>
      </div>

      <div className="panel-body">{children}</div>
    </section>
  );
}

export function Metric({ label, value, detail }) {
  return (
    <div className="metric">
      <span>{label}</span>

      <strong>{value ?? "—"}</strong>

      {detail && <small>{detail}</small>}
    </div>
  );
}
