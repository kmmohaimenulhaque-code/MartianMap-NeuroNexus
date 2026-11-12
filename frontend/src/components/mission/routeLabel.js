/** Which model answered and why, from the AI router (science/ai/router.py). */
export function routeLabel(reply) {
  if (!reply?.provider || reply.provider === "none") return null;
  const who = reply.provider === "qwen" ? "NeuroNexus Qwen (fine-tuned)" : `Gemini${reply.model ? ` ${reply.model}` : ""}`;
  const parts = [`Answered by ${who}`];
  if (reply.route_reason) parts.push(`reason: ${reply.route_reason}`);
  if (reply.fallback_from) parts.push(`fallback from ${reply.fallback_from.split(":")[0]}`);
  return { text: parts.join(" · "), title: reply.fallback_from ?? reply.route_reason ?? "" };
}
