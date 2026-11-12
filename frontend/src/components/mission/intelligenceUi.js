/* Pure helpers for the Mars Intelligence panel (kept out of the component file for tests and fast refresh). */

/* Only http(s) links from search results become clickable; anything else is shown as plain text. */
export function safeHttpUrl(value) {
  try {
    const url = new URL(String(value));
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch {
    return null;
  }
}

/* Header badge text: which live model answered last, and whether the router had to fall back. */
export function modelBadge(messages, status) {
  const last = [...messages].reverse().find((m) => m.role === "assistant" && !m.error && m.model);
  const model = last?.model ?? status?.model ?? null;
  return {
    text: `MODEL: AUTO (${model ? model : status?.configured === false ? "NOT CONFIGURED" : "RESOLVING"})`,
    fallback: Boolean(last?.fallback?.length),
    title: last?.fallback?.length
      ? `Fell back after: ${last.fallback.map((f) => `${f.model} (${f.reason})`).join("; ")}`
      : "The server discovers the models this API key can use and falls back automatically.",
  };
}
