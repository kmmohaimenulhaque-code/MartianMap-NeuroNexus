/*
 * Sticky API shard for split hosting. frontend/vercel.json routes /api by the nn_shard cookie, so each
 * browser keeps one shard for 7 days: its terrain frames, images and route plans stay on the same servers
 * (their caches, and the stored plan the brief reads). Hosts without shard rewrites simply ignore it.
 */
export const SHARD_COUNT = Math.max(1, Number(import.meta.env.VITE_API_SHARDS ?? 6) || 1);
const NAME = "nn_shard";

/* The shard in `cookie` when it is valid for `count`, otherwise a new random one (1..count). */
export function pickShard(cookie, count, random = Math.random) {
  const match = /(?:^|;\s*)nn_shard=(\d+)/.exec(cookie ?? "");
  const current = match ? Number(match[1]) : 0;
  if (current >= 1 && current <= count) return { shard: current, fresh: false };
  return { shard: 1 + Math.min(count - 1, Math.floor(random() * count)), fresh: true };
}

if (typeof document !== "undefined" && SHARD_COUNT > 1) {
  const { shard, fresh } = pickShard(document.cookie, SHARD_COUNT);
  if (fresh) {
    const secure = window.location.protocol === "https:" ? "; Secure" : "";
    document.cookie = `${NAME}=${shard}; Max-Age=604800; Path=/; SameSite=Lax${secure}`;
  }
}
