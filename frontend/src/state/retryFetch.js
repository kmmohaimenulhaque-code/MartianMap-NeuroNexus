/*
 * Retry idempotent API reads that hit a cold or busy server. On free hosting a service wakes in 30-90 s and a
 * busy terrain part answers 503 BUSY (Retry-After); the proxy turns a slow answer into 502/504. A GET /api
 * request that comes back 502, 503 or 504 is retried up to twice (Retry-After, else 3 s then 8 s) unless the
 * caller aborted it. Writes (POST) are never retried. Installed after apiOrigin.js and before the fetch tracker,
 * so the loading pop-up shows one request, not each attempt.
 */
export const RETRY_STATUSES = new Set([502, 503, 504]);
const DELAYS_MS = [3000, 8000];

export function retryDelayMs(attempt, retryAfter) {
  const seconds = retryAfter == null || String(retryAfter).trim() === "" ? NaN : Number(retryAfter);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds, 20) * 1000;
  return DELAYS_MS[Math.min(attempt, DELAYS_MS.length - 1)];
}

function isApiRead(input, init) {
  const method = String(init?.method ?? input?.method ?? "GET").toUpperCase();
  if (method !== "GET") return false;
  const raw = typeof input === "string" ? input : input?.url ?? String(input ?? "");
  try {
    const base = typeof window !== "undefined" ? window.location.href : "http://localhost/";
    return new URL(raw, base).pathname.startsWith("/api/");
  } catch {
    return false;
  }
}

const sleep = (ms, signal) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
    }, { once: true });
  });

export function withRetry(fetchImpl) {
  return async (input, init) => {
    let response = await fetchImpl(input, init);
    if (!isApiRead(input, init)) return response;
    const signal = init?.signal ?? input?.signal;
    for (let attempt = 0; attempt < DELAYS_MS.length && RETRY_STATUSES.has(response.status); attempt += 1) {
      if (signal?.aborted) return response;
      await sleep(retryDelayMs(attempt, response.headers?.get?.("retry-after")), signal);
      response = await fetchImpl(input, init);
    }
    return response;
  };
}

if (typeof window !== "undefined" && typeof window.fetch === "function" && !window.__nnRetryFetch) {
  window.__nnRetryFetch = true;
  window.fetch = withRetry(window.fetch.bind(window));
}
