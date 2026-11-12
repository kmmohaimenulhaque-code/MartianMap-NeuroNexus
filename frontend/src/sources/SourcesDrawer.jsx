/* Browsable canonical ledger: search, filter, where each source is used, export JSON or CSV. */

import { useEffect, useMemo, useRef, useState } from "react";

import { classKey, filterEntries, ledgerToCsv } from "./ledgerStore";
import { useSourceLedger } from "./useSourceLedger";
import "./sources.css";

function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function SourcesDrawer({ open, focusId, onClose }) {
  const ledger = useSourceLedger();
  const [filters, setFilters] = useState({ q: "", org: "", cls: "", status: "" });
  const focusRef = useRef(null);
  const focusEntry = ledger.resolve(focusId);
  const entries = useMemo(() => filterEntries(ledger.entries, filters), [ledger.entries, filters]);
  const orgs = useMemo(() => [...new Set(ledger.entries.map((e) => e.organization))].sort(), [ledger.entries]);
  const classes = useMemo(() => [...new Set(ledger.entries.map((e) => e.evidence_class))].sort(), [ledger.entries]);

  useEffect(() => {
    if (open && focusRef.current) focusRef.current.scrollIntoView({ block: "center" });
  }, [open, focusId, entries.length]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="nn-drawer-backdrop" onMouseDown={onClose}>
      <aside className="nn-drawer nn-sources" role="dialog" aria-modal="true" aria-label="Source ledger" onMouseDown={(e) => e.stopPropagation()}>
        <header className="nn-drawer-head">
          <div>
            <span className="nn-drawer-kicker">🏷️ CANONICAL SOURCE LEDGER · neuronexus.source-ledger.v3</span>
            <h2>Sources ({ledger.entries.length})</h2>
          </div>
          <button type="button" className="nn-drawer-close" onClick={onClose} aria-label="Close source ledger">
            ×
          </button>
        </header>
        <div className="nn-sources-filters">
          <input
            type="search"
            placeholder="Search id, product, mission…"
            aria-label="Search sources"
            value={filters.q}
            onChange={(e) => setFilters({ ...filters, q: e.target.value })}
          />
          <select aria-label="Organization" value={filters.org} onChange={(e) => setFilters({ ...filters, org: e.target.value })}>
            <option value="">All organizations</option>
            {orgs.map((o) => (
              <option key={o}>{o}</option>
            ))}
          </select>
          <select aria-label="Evidence class" value={filters.cls} onChange={(e) => setFilters({ ...filters, cls: e.target.value })}>
            <option value="">All evidence classes</option>
            {classes.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
          <select aria-label="Ingestion status" value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })}>
            <option value="">All statuses</option>
            {["INGESTED", "QUERIED LIVE", "REFERENCE ONLY", "CATALOGED NOT INGESTED", "UNAVAILABLE"].map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
          <button type="button" onClick={() => download("neuronexus_source_ledger.json", JSON.stringify(ledger.entries, null, 2), "application/json")}>
            EXPORT JSON
          </button>
          <button type="button" onClick={() => download("neuronexus_source_ledger.csv", ledgerToCsv(ledger.entries), "text/csv")}>
            EXPORT CSV
          </button>
        </div>
        {ledger.status !== "ready" && <p className="nn-drawer-note">Ledger {ledger.status}{ledger.error ? `: ${ledger.error}` : "…"}</p>}
        <ol className="nn-sources-list">
          {entries.map((e) => {
            const focused = focusEntry?.id === e.id;
            return (
              <li key={e.id} ref={focused ? focusRef : null} className={focused ? "focused" : undefined}>
                <div className="nn-sources-row">
                  <span className={`nn-tag nn-tag--${classKey(e.evidence_class)} nn-tag--static`}>🏷️ {e.evidence_class}</span>
                  <code>{e.id}</code>
                  <span className="nn-sources-status">{e.ingestion_status}</span>
                </div>
                <strong>{e.product_title}</strong>
                <span>{e.organization}{e.mission ? ` · ${e.mission}` : ""}{e.instrument ? ` · ${e.instrument}` : ""}</span>
                {(e.landing_page || e.url) && (
                  <a href={e.landing_page || e.url} target="_blank" rel="noreferrer">
                    {e.landing_page || e.url}
                  </a>
                )}
                {e.used_by?.length > 0 && <span>Used by: {e.used_by.join(" · ")}</span>}
                {e.aliases?.length > 0 && <span>Aliases: {e.aliases.join(", ")}</span>}
                {e.caveats?.length > 0 && <span className="nn-tag-caveat">Caveats: {e.caveats.join(" · ")}</span>}
                <small>
                  {e.license ? `License ${e.license} · ` : ""}
                  {e.verified_on ? `Verified ${e.verified_on}: ` : "Not re-verified: "}
                  {e.verification_note}
                </small>
              </li>
            );
          })}
        </ol>
      </aside>
    </div>
  );
}
