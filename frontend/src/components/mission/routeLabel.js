/** Which model answered, and what it fell back from, from the AI router (science/ai/router.py). */
export function routeLabel(reply) {
  if (!reply?.provider || reply.provider === "none") return null;
  const name = reply.provider === "gemini" ? "Gemini" : reply.provider;
  const parts = [`Answered by ${name}${reply.model ? ` ${reply.model}` : ""}`];
  if (reply.route_reason) parts.push(`reason: ${reply.route_reason}`);
  if (reply.fallback_from) parts.push(`fallback from ${reply.fallback_from.split(":")[0]}`);
  return { text: parts.join(" · "), title: reply.fallback_from ?? reply.route_reason ?? "" };
}
