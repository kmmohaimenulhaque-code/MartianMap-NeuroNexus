/* Small helpers shared by the console (moved out of App.jsx). */

export const MAX_ROUTE_POINTS = 32;

export const MAX_TODO_WORDS = 150;
export const MAX_CHECKLIST_POINTS = 10;
export const MAX_CHECKLIST_WORDS = 150;

export function readStorage(key, fallback) {
  try {
    const raw = localStorage.getItem(key);

    if (!raw) {
      return fallback;
    }

    const parsed = JSON.parse(raw);

    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

export function writeStorage(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Local persistence is optional.
  }
}

export function createId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function normaliseLongitude(longitude) {
  return ((Number(longitude) % 360) + 360) % 360;
}

export function normaliseLocation(point, label = null) {
  return {
    latitude_deg: Number(point.latitude_deg ?? point.lat),

    longitude_deg: normaliseLongitude(point.longitude_deg ?? point.longitude ?? point.lon ?? point.lng),

    label: label ?? point.label ?? null,
  };
}

export function countWords(text = "") {
  return String(text).trim().split(/\s+/).filter(Boolean).length;
}

export function trimToWordLimit(text, maximum) {
  const words = String(text).trim().split(/\s+/).filter(Boolean);

  if (words.length <= maximum) {
    return text;
  }

  return words.slice(0, maximum).join(" ");
}

export function isNetworkFailure(error) {
  const message = String(error?.message ?? error ?? "").toLowerCase();

  return (
    message.includes("failed to fetch") ||
    message.includes("networkerror") ||
    message.includes("load failed") ||
    message.includes("econnrefused") ||
    message.includes("fetch failed")
  );
}

export function downloadTextFile(filename, content, mimeType) {
  const blob = new Blob([content], {
    type: mimeType,
  });

  const url = URL.createObjectURL(blob);

  const anchor = document.createElement("a");

  anchor.href = url;

  anchor.download = filename;

  document.body.appendChild(anchor);

  anchor.click();

  anchor.remove();

  URL.revokeObjectURL(url);
}

/*
 * SYSTEM ONLINE only when the API itself answers: GET /api/health must return {"status": "ok"} within 4 s.
 * A dev-proxy 502/504, an HTML error page, a timeout or a network error all mean SYSTEM DEGRADED.
 * The static demo replays recorded responses, so there the recorded /api/places probe stands in.
 */
export async function probeBackend(fetchImpl = globalThis.fetch, timeoutMs = 4000) {
  const ask = async (url) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetchImpl(url, { cache: "no-store", signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  };
  try {
    const r = await ask("/api/health");
    if (r.headers?.get?.("x-nn-demo") === "miss") return (await ask("/api/places?limit=1")).ok;
    if (!r.ok) return false;
    const body = await r.json();
    return body?.status === "ok";
  } catch {
    return false;
  }
}
