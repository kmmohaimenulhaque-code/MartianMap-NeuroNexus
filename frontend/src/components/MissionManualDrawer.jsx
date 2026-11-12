/* Mission Operations Manual: quick starts, guides, live data status and the source ledger. */

import { useEffect, useState } from "react";

import { installStore, useInstall } from "../pwa/installStore";
import { useSourceLedger } from "../sources/useSourceLedger";
import SourceTag from "../sources/SourceTag";
import { GUIDES, QUICK_STARTS } from "./manualContent";
import "../sources/sources.css";

export default function MissionManualDrawer({ open, onClose, onQuickStart, onOpenSources, onOpenCommands, optimizationPanel }) {
  const ledger = useSourceLedger();
  const [status, setStatus] = useState({ state: "idle" });
  const install = useInstall();
  const [installMsg, setInstallMsg] = useState("");

  useEffect(() => {
    if (!open) return undefined;
    const controller = new AbortController();
    fetch("/api/data/status", { signal: controller.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((data) => setStatus({ state: "ready", data }))
      .catch((error) => error.name !== "AbortError" && setStatus({ state: "error", error: error.message }));
    const onKey = (event) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => {
      controller.abort();
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  if (!open) return null;
  const byClass = ledger.entries.reduce((acc, e) => ({ ...acc, [e.evidence_class]: (acc[e.evidence_class] ?? 0) + 1 }), {});
  const byStatus = ledger.entries.reduce((acc, e) => {
    const k = e.ingestion_status.split(" (")[0];
    return { ...acc, [k]: (acc[k] ?? 0) + 1 };
  }, {});
  return (
    <div className="nn-drawer-backdrop" onMouseDown={onClose}>
      <aside className="nn-drawer nn-manual" role="dialog" aria-modal="true" aria-label="Mission Operations Manual" onMouseDown={(e) => e.stopPropagation()}>
        <header className="nn-drawer-head">
          <div>
            <span className="nn-drawer-kicker">[MENU] MISSION OPERATIONS MANUAL</span>
            <h2>NeuroNexus · Marswalk</h2>
          </div>
          <button type="button" className="nn-drawer-close" onClick={onClose} aria-label="Close manual">
            ×
          </button>
        </header>

        <section className="nn-manual-section">
          <h3>QUICK START</h3>
          <div className="nn-manual-quick">
            <button
              type="button"
              className="nn-manual-install"
              data-quickstart="install-app"
              disabled={install.installed}
              onClick={async () => setInstallMsg(await installStore.install())}
            >
              <strong>{install.installed ? "Installed as an app" : "Install as app"}</strong>
              <small>
                {install.installed
                  ? "Running in its own window on this device."
                  : install.ios
                    ? "iPhone and iPad: Share, then Add to Home Screen. Data still comes live from the server."
                    : "Own window and home-screen icon on desktop, phone or tablet. Data still comes live from the server."}
              </small>
              {installMsg && <small className="nn-manual-install-msg" role="status">{installMsg}</small>}
            </button>
            {QUICK_STARTS.map((q) => (
              <button key={q.id} type="button" onClick={() => onQuickStart(q.demo)} data-quickstart={q.id}>
                <strong>{q.label}</strong>
                <small>{q.note}</small>
              </button>
            ))}
          </div>
        </section>

        <section className="nn-manual-section">
          <h3>GUIDES</h3>
          {GUIDES.map((g) => (
            <details key={g.id}>
              <summary>{g.title}</summary>
              {g.body.map((p) => (
                <p key={p}>{p}</p>
              ))}
            </details>
          ))}
        </section>

        <section className="nn-manual-section">
          <h3>
            DATA STATUS <SourceTag ledgerId="NEURONEXUS_TERRAIN_LADDER" compact />
          </h3>
          {status.state === "ready" ? (
            <ul className="nn-manual-status">
              {Object.entries(status.data.checks ?? {}).map(([k, v]) => (
                <li key={k} className={v.ok ? "ok" : "bad"}>
                  <b>{v.ok ? "OK" : "UNAVAILABLE"}</b> {k}: {v.detail}
                </li>
              ))}
              {status.data.demo_pack && <li>Demo pack: {status.data.demo_pack}</li>}
            </ul>
          ) : (
            <p className="nn-drawer-note">{status.state === "error" ? `Status endpoint unavailable: ${status.error}` : "Checking…"}</p>
          )}
        </section>

        <section className="nn-manual-section">
          <h3>SOURCE LEDGER</h3>
          <p>
            {ledger.entries.length} entries ·{" "}
            {Object.entries(byClass)
              .map(([k, n]) => `${k} ${n}`)
              .join(" · ")}
          </p>
          <p>
            {Object.entries(byStatus)
              .map(([k, n]) => `${k} ${n}`)
              .join(" · ")}
          </p>
          <button type="button" className="nn-tag-link" onClick={() => onOpenSources(null)}>
            Open the Sources drawer →
          </button>
        </section>

        {optimizationPanel && (
          <section className="nn-manual-section" id="browser-optimization">
            <h3>BROWSER OPTIMIZATION</h3>
            {optimizationPanel}
          </section>
        )}

        <section className="nn-manual-section">
          <button type="button" className="nn-tag-link" onClick={onOpenCommands}>
            Open the Command Index (Ctrl/Cmd+K) →
          </button>
        </section>
      </aside>
    </div>
  );
}
