/*
 * 🏷️ SourceTag: the visible, clickable source chip every value, layer, chart and export carries.
 *   🏷️ <EVIDENCE CLASS> · <short source> [· <product/basis>]
 * The class is always written as text (color is never the only signal). Click, Enter or Space opens
 * a popover with the ledger entry; "View in ledger" opens the Sources drawer.
 */

import { useEffect, useId, useRef, useState } from "react";

import { CLASS_MEANINGS, classKey, isToggleKey, tagText } from "./ledgerStore";
import { useSourcesDrawer } from "./SourcesContext";
import { useSourceLedger } from "./useSourceLedger";
import "./sources.css";

export default function SourceTag({ ledgerId, evidence, detail, compact = false, basis, className = "" }) {
  const ledger = useSourceLedger();
  const { openSources } = useSourcesDrawer();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);
  const popId = useId();
  const entry = ledger.resolve(ledgerId);
  const unregistered = ledger.status === "ready" && !entry;
  const cls = unregistered ? "unregistered" : classKey(evidence ?? entry?.evidence_class);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (event) => {
      if (wrapRef.current && !wrapRef.current.contains(event.target)) setOpen(false);
    };
    const onKey = (event) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const text = tagText({ entry, ledgerId, evidence, detail, compact, status: ledger.status });
  return (
    <span className={`nn-tag-wrap ${className}`} ref={wrapRef}>
      <button
        type="button"
        className={`nn-tag nn-tag--${cls}${compact ? " nn-tag--compact" : ""}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? popId : undefined}
        data-ledger-id={ledgerId}
        onClick={(event) => {
          event.stopPropagation();
          setOpen((value) => !value);
        }}
        onKeyDown={(event) => {
          if (isToggleKey(event)) {
            event.preventDefault();
            setOpen((value) => !value);
          }
        }}
      >
        {text}
      </button>
      {open && (
        <span className="nn-tag-pop" role="dialog" id={popId} aria-label={`Source ${ledgerId}`}>
          {entry ? (
            <>
              <strong>{entry.product_title}</strong>
              <span className="nn-tag-row">{entry.organization}</span>
              {(entry.mission || entry.instrument) && (
                <span className="nn-tag-row">{[entry.mission, entry.instrument].filter(Boolean).join(" · ")}</span>
              )}
              <span className="nn-tag-row">
                <b>{evidence ?? entry.evidence_class}</b> — {CLASS_MEANINGS[evidence ?? entry.evidence_class] ?? ""}
              </span>
              <span className="nn-tag-row">Ingestion: {entry.ingestion_status}</span>
              {entry.license && <span className="nn-tag-row">License: {entry.license}</span>}
              {entry.doi && <span className="nn-tag-row">DOI: {entry.doi}</span>}
              {(entry.landing_page || entry.url) && (
                <a className="nn-tag-row" href={entry.landing_page || entry.url} target="_blank" rel="noreferrer">
                  {entry.landing_page || entry.url}
                </a>
              )}
              {(entry.retrieved_at || entry.archive_lag_days != null) && (
                <span className="nn-tag-row">
                  {entry.retrieved_at ? `Retrieved ${entry.retrieved_at}` : ""}
                  {entry.archive_lag_days != null ? ` · archive lag ${entry.archive_lag_days} d` : ""}
                </span>
              )}
              {detail && <span className="nn-tag-row">Product / basis: {detail}</span>}
              {basis && <span className="nn-tag-row">Basis: {basis}</span>}
              {entry.caveats?.length > 0 && (
                <span className="nn-tag-row nn-tag-caveat">Caveats: {entry.caveats.join(" · ")}</span>
              )}
              <span className="nn-tag-row nn-tag-id">Ledger id {entry.id}</span>
            </>
          ) : (
            <span className="nn-tag-row">
              {unregistered ? `"${ledgerId}" is not in the canonical ledger.` : `Ledger ${ledger.status}: ${ledger.error ?? "loading"}.`}
            </span>
          )}
          <button
            type="button"
            className="nn-tag-link"
            onClick={() => {
              setOpen(false);
              openSources(entry?.id ?? ledgerId);
            }}
          >
            View in ledger →
          </button>
        </span>
      )}
    </span>
  );
}

export function SourceTags({ ids = [], compact = true }) {
  return (
    <span className="nn-tag-list">
      {ids.filter(Boolean).map((id) => (
        <SourceTag key={id} ledgerId={id} compact={compact} />
      ))}
    </span>
  );
}
