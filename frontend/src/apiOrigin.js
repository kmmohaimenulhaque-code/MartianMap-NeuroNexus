/*
 * Where the API lives. Empty (default): same origin, /api on the server that serves this page.
 * VITE_API_ORIGIN (e.g. https://martian-map-api.onrender.com) is set when the console is a separate static
 * site; every /api request is then sent to that origin. The backend allows any origin (CORS).
 */
export const API_ORIGIN = (import.meta.env.VITE_API_ORIGIN ?? "").replace(/\/+$/, "");

const native = typeof window !== "undefined" ? window.fetch?.bind(window) : null;
if (API_ORIGIN && native) {
  window.fetch = (input, init) => {
    if (typeof input === "string" && (input.startsWith("/api/") || input === "/api")) return native(API_ORIGIN + input, init);
    return native(input, init);
  };
}
