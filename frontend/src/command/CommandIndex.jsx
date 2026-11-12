import { useEffect, useMemo, useRef, useState } from "react";

import { CATEGORIES, TEAM_URL, searchCommands } from "../features/registry";

/*
 * ☰ MISSION COMMAND INDEX — every capability of the console, by category.
 * Search, arrow keys + Enter, Esc to close. Unavailable commands say why.
 * Tabs: COMMANDS · FIELD NOTES & CHECKLIST · TEAM.
 */

export default function CommandIndex({ open, onClose, registry, initialTab = "commands", notesPanel, appVersion }) {
  const [tab, setTab] = useState(initialTab);
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const [collapsed, setCollapsed] = useState(() => new Set());
  const inputRef = useRef(null);
  const dialogRef = useRef(null);

  // The parent remounts this component (via `key`) each time it opens, so state starts fresh.
  useEffect(() => {
    if (open) window.setTimeout(() => inputRef.current?.focus(), 30);
  }, [open]);

  const results = useMemo(() => searchCommands(registry, query), [registry, query]);
  const flat = useMemo(() => CATEGORIES.flatMap((cat) => (collapsed.has(cat.id) && !query ? [] : results.filter((c) => c.category === cat.id))), [results, collapsed, query]);

  if (!open) return null;

  function run(command) {
    if (!command?.ok) return;
    onClose();
    window.setTimeout(() => command.run(), 0);
  }

  function onKeyDown(event) {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
    } else if (tab === "commands" && event.key === "ArrowDown") {
      event.preventDefault();
      setCursor((c) => Math.min(flat.length - 1, c + 1));
    } else if (tab === "commands" && event.key === "ArrowUp") {
      event.preventDefault();
      setCursor((c) => Math.max(0, c - 1));
    } else if (tab === "commands" && event.key === "Enter" && event.target === inputRef.current) {
      event.preventDefault();
      run(flat[cursor]);
    } else if (event.key === "Tab") {
      // Keep focus inside the dialog.
      const focusable = dialogRef.current?.querySelectorAll("button, input, textarea, a[href]");
      if (!focusable?.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  }

  return (
    <div className="cix-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside ref={dialogRef} className="cix" role="dialog" aria-modal="true" aria-label="Mission Command Index" onKeyDown={onKeyDown}>
        <header className="cix-header">
          <div className="cix-brand">
            <img src="/team-neuronexus-logo.png" alt="" width="34" height="34" />
            <div>
              <span className="eyebrow">NEURONEXUS / MISSION COMMAND INDEX</span>
              <h2>{tab === "notes" ? "FIELD NOTES + CHECKLIST" : tab === "team" ? "TEAM NEURONEXUS" : "ALL CONSOLE FEATURES"}</h2>
            </div>
          </div>
          <button type="button" className="ai-close" onClick={onClose} aria-label="Close command index">
            ×
          </button>
        </header>

        <nav className="cix-tabs" role="tablist">
          {[
            ["commands", "COMMANDS"],
            ["notes", "FIELD NOTES & CHECKLIST"],
            ["team", "TEAM"],
          ].map(([id, label]) => (
            <button key={id} type="button" role="tab" aria-selected={tab === id} className={tab === id ? "active" : ""} onClick={() => setTab(id)}>
              {label}
            </button>
          ))}
        </nav>

        {tab === "commands" && (
          <>
            <div className="cix-search">
              <span>⌕</span>
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setCursor(0);
                }}
                placeholder="Search features… (↑↓ Enter)"
                aria-label="Search commands"
              />
              <kbd>Ctrl/⌘ K</kbd>
            </div>
            <div className="cix-list">
              {CATEGORIES.map((cat) => {
                const items = results.filter((c) => c.category === cat.id);
                if (!items.length) return null;
                const isCollapsed = collapsed.has(cat.id) && !query;
                return (
                  <section key={cat.id} className="cix-group">
                    <button
                      type="button"
                      className="cix-group-head"
                      aria-expanded={!isCollapsed}
                      onClick={() =>
                        setCollapsed((s) => {
                          const next = new Set(s);
                          if (next.has(cat.id)) next.delete(cat.id);
                          else next.add(cat.id);
                          return next;
                        })
                      }
                    >
                      <span>{cat.icon}</span> {cat.label.toUpperCase()} <small>{items.length}</small>
                      <i>{isCollapsed ? "+" : "−"}</i>
                    </button>
                    {!isCollapsed &&
                      items.map((command) => {
                        const index = flat.indexOf(command);
                        return (
                          <button
                            key={command.id}
                            type="button"
                            data-feature-id={command.id}
                            className={`cix-item${index === cursor ? " cursor" : ""}${command.ok ? "" : " disabled"}`}
                            onMouseEnter={() => setCursor(index)}
                            onClick={() => run(command)}
                            aria-disabled={!command.ok}
                            title={command.ok ? command.where : command.reason}
                          >
                            <span className="cix-item-main">
                              <strong>
                                {command.label}
                                {command.url ? " ↗" : ""}
                              </strong>
                              <small>{command.ok ? command.description ?? command.where : `UNAVAILABLE — ${command.reason}`}</small>
                            </span>
                            {command.shortcut && <kbd>{command.shortcut}</kbd>}
                          </button>
                        );
                      })}
                  </section>
                );
              })}
              {!results.length && <div className="cix-empty">No feature matches “{query}”.</div>}
            </div>
          </>
        )}

        {tab === "notes" && <div className="cix-notes">{notesPanel}</div>}

        {tab === "team" && (
          <div className="cix-team">
            <img src="/team-neuronexus-logo.png" alt="Team NeuroNexus logo" width="132" height="132" />
            <h3>TEAM NEURONEXUS</h3>
            <p>Interplanetary Survival Guide: Martian Map. Built for the NASA International Space Apps Challenge 2026.</p>
            <a className="cix-team-link" href={TEAM_URL} target="_blank" rel="noreferrer">
              MEET THE TEAM ↗
            </a>
            <dl>
              <dt>Project</dt>
              <dd>NeuroNexus Mission Console v{appVersion}</dd>
              <dt>Challenge</dt>
              <dd>NASA Space Apps 2026 · Mars mapping for the first human explorers</dd>
              <dt>Data</dt>
              <dd>NASA MOLA · NASA THEMIS · NASA Ames Mars GCM · USGS / IAU · NASA/JPL SBDB</dd>
            </dl>
            <small>
              © {new Date().getFullYear()} Team NeuroNexus. All rights reserved. NASA does not endorse any non-U.S. Government entity and is not responsible for information
              contained on non-U.S. Government websites.
            </small>
          </div>
        )}
      </aside>
    </div>
  );
}
