/*
 * Canonical source ledger store: GET /api/sources is fetched once and shared.
 * Ids and aliases resolve case-insensitively, exactly like science/sources/ledger.py.
 */

let state = { status: "idle", entries: [], index: new Map(), error: null };
const listeners = new Set();

export function buildIndex(entries) {
  const index = new Map();
  for (const entry of entries) {
    for (const key of [entry.id, ...(entry.aliases ?? [])]) {
      index.set(String(key).toUpperCase(), entry);
    }
  }
  return index;
}

export function resolveIn(index, ledgerId) {
  if (!ledgerId) return null;
  return index.get(String(ledgerId).toUpperCase()) ?? null;
}

function emit(next) {
  state = next;
  listeners.forEach((listener) => listener());
}

export function loadLedger(fetchImpl = globalThis.fetch) {
  if (state.status === "loading" || state.status === "ready") return;
  emit({ ...state, status: "loading" });
  fetchImpl("/api/sources")
    .then((response) => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json();
    })
    .then((body) => emit({ status: "ready", entries: body.entries ?? [], index: buildIndex(body.entries ?? []), error: null }))
    .catch((error) => emit({ status: "error", entries: [], index: new Map(), error: error.message }));
}

export function seedLedger(entries) {
  emit({ status: "ready", entries, index: buildIndex(entries), error: null });
}

export function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getLedgerState() {
  return state;
}

export function shortLabel(entry) {
  if (!entry) return "";
  const base = entry.instrument ? `${entry.mission?.includes("Reconnaissance") ? "MRO " : ""}${entry.instrument}` : entry.product_title.split("(")[0].trim();
  return base; // never truncated: chips wrap, and the full entry is in the popover
}

const CLASS_KEYS = {
  OBSERVED: "observed",
  "NASA REFERENCE": "reference",
  MODELED: "modeled",
  DERIVED: "derived",
  COMPUTED: "derived",
  SIMULATED: "simulated",
  "AI INTERPRETATION": "ai",
  UNAVAILABLE: "unavailable",
};

export function classKey(evidenceClass) {
  return CLASS_KEYS[String(evidenceClass ?? "").toUpperCase()] ?? "unavailable";
}

export const CLASS_MEANINGS = {
  OBSERVED: "A real instrument measurement from a mission archive.",
  "NASA REFERENCE": "A published NASA/USGS/partner reference value, catalog or map.",
  MODELED: "Output of a physical model (for example the NASA Ames Mars GCM).",
  DERIVED: "Computed by NeuroNexus from observed or modeled inputs.",
  COMPUTED: "Geometry or arithmetic computed by NeuroNexus.",
  SIMULATED: "A configurable NeuroNexus simulation value, not a measurement.",
  "AI INTERPRETATION": "Language-model interpretation of structured results; never a NASA observation.",
};

export function tagText({ entry, ledgerId, evidence, detail, compact, status }) {
  if (!entry) {
    if (status === "ready") return `UNREGISTERED SOURCE · ${ledgerId}`;
    return `${evidence ?? "SOURCE"} · ${ledgerId}`;
  }
  const label = shortLabel(entry);
  if (compact) return label;
  const cls = evidence ?? entry.evidence_class;
  return [cls, label, detail].filter(Boolean).join(" · ");
}

export function isToggleKey(event) {
  return event.key === "Enter" || event.key === " " || event.key === "Spacebar";
}

const CSV_FIELDS = ["id", "organization", "mission", "instrument", "product_title", "evidence_class", "ingestion_status", "license", "url", "doi", "verified_on"];

export function ledgerToCsv(entries) {
  const esc = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;
  return [CSV_FIELDS.join(","), ...entries.map((e) => CSV_FIELDS.map((f) => esc(e[f])).join(","))].join("\n");
}

export function filterEntries(entries, { q = "", org = "", cls = "", status = "" }) {
  const needle = q.trim().toLowerCase();
  return entries.filter(
    (e) =>
      (!org || e.organization === org) &&
      (!cls || e.evidence_class === cls) &&
      (!status || e.ingestion_status.startsWith(status)) &&
      (!needle || `${e.id} ${e.aliases?.join(" ")} ${e.product_title} ${e.organization} ${e.mission ?? ""} ${e.instrument ?? ""}`.toLowerCase().includes(needle)),
  );
}
