/*
 * Smart loading pop-up: a glass, search-bar shaped status card over the console while backend data is in
 * flight (state/fetchTracker.js). It appears only after a request has been pending for SHOW_AFTER_MS, so quick
 * calls never flash it, and hides on its own GRACE_MS after the burst settles. CLOSE, Esc or a click on the
 * backdrop dismisses it for the current burst only; dismissing never aborts a request.
 */

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { fetchTracker } from "../state/fetchTracker";
import Icon from "./Icon";
import "./loadingOverlay.css";

const SHOW_AFTER_MS = 700;
const TICK_MS = 150;

function overdue(snapshot, t) {
  return snapshot.active && snapshot.entries.some((e) => e.status === "pending" && t - e.startedAt >= SHOW_AFTER_MS);
}

function elapsedSeconds(entry, t) {
  const end = entry.finishedAt ?? t;
  return `${Math.max(0, (end - entry.startedAt) / 1000).toFixed(1)} s`;
}

function statusLine(s) {
  const finished = s.total - s.pending;
  const failed = s.failed ? ` · ${s.failed} failed` : "";
  if (s.pending > 0) return `Fetching backend data · ${finished} of ${s.total} done${failed}`;
  return `Backend requests settled · ${finished} of ${s.total} done${failed}`;
}

function EntryStatus({ entry }) {
  if (entry.status === "pending") return <span className="nn-loading-state is-pending">pending</span>;
  if (entry.status === "failed") return <span className="nn-loading-state is-failed">failed</span>;
  return <span className="nn-loading-state is-done">done</span>;
}

/* Pending first (oldest at the top: the one holding things up), then failed, then done (newest first). */
const RANK = { pending: 0, failed: 1, done: 2 };
function ordered(entries) {
  return [...entries].sort((a, b) => RANK[a.status] - RANK[b.status] || (a.status === "pending" ? a.startedAt - b.startedAt : (b.finishedAt ?? 0) - (a.finishedAt ?? 0)));
}

export default function LoadingOverlay({ tracker = fetchTracker }) {
  const snap = useSyncExternalStore(tracker.subscribe, tracker.getSnapshot, tracker.getSnapshot);
  const [now, setNow] = useState(0);
  const [revealed, setRevealed] = useState(-1);
  const [dismissed, setDismissed] = useState(-1);

  // While a burst is open, tick the clock (elapsed seconds) and reveal the card once a request is overdue.
  useEffect(() => {
    if (!snap.active) return undefined;
    const tick = () => {
      const t = Date.now();
      setNow(t);
      const current = tracker.getSnapshot();
      if (overdue(current, t)) setRevealed((b) => (b === current.burst ? b : current.burst));
    };
    const id = setInterval(tick, TICK_MS);
    return () => clearInterval(id);
  }, [snap.active, snap.burst, tracker]);

  const visible = snap.active && snap.total > 0 && revealed === snap.burst && dismissed !== snap.burst;
  const burst = snap.burst;
  const dismiss = useCallback(() => setDismissed(burst), [burst]);

  useEffect(() => {
    if (!visible) return undefined;
    const onKey = (event) => {
      if (event.key !== "Escape") return;
      // The radial wheel sits above this pop-up and closes on Esc itself.
      if (document.querySelector(".nn-wheel-overlay")) return;
      event.preventDefault();
      event.stopPropagation();
      dismiss();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [visible, dismiss]);

  if (!visible) return null;

  const finished = snap.total - snap.pending;
  const progress = snap.total > 0 ? Math.round((finished / snap.total) * 100) : 0;
  const entries = ordered(snap.entries);

  return (
    <div
      className="nn-loading-backdrop"
      data-testid="loading-overlay"
      role="status"
      aria-live="polite"
      onClick={(event) => event.target === event.currentTarget && dismiss()}
    >
      <div className="nn-loading-card">
        <div className="nn-loading-bar">
          <span className={`nn-loading-spinner${snap.pending === 0 ? " is-idle" : ""}`} aria-hidden="true" />
          <span className="nn-loading-status">{statusLine(snap)}</span>
          <button type="button" className="nn-loading-close" aria-label="Close loading status (requests keep running)" title="Close (Esc)" onClick={dismiss}>
            <Icon name="close" size={16} />
          </button>
        </div>
        <div
          className="nn-loading-progress"
          role="progressbar"
          aria-label="Backend requests finished"
          aria-valuemin={0}
          aria-valuemax={snap.total}
          aria-valuenow={finished}
        >
          <span style={{ width: `${progress}%` }} />
        </div>
        <ul className="nn-loading-list">
          {entries.map((entry) => (
            <li key={entry.id} className={`nn-loading-item is-${entry.status}`}>
              <div className="nn-loading-row">
                <span className="nn-loading-label" title={entry.path}>
                  {entry.label}
                </span>
                <span className="nn-loading-elapsed" aria-hidden="true">
                  {elapsedSeconds(entry, now)}
                </span>
                <EntryStatus entry={entry} />
              </div>
              {entry.status === "failed" && entry.error ? <p className="nn-loading-error">{entry.error}</p> : null}
            </li>
          ))}
        </ul>
        <p className="nn-loading-hint">Close or Esc hides this; requests keep running.</p>
      </div>
    </div>
  );
}
