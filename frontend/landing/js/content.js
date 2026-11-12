/* Fills generated numbers and configured links into the static markup. Numbers come from headline.json,
   which tools/build_landing_media.py writes from validation/reports/latest.json. Nothing is typed by hand. */

export function getPath(obj, path) {
  return path.split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

export function formatValue(value, decimals) {
  if (Array.isArray(value)) return value.map((v) => formatValue(v, decimals)).join(" to ");
  if (typeof value === "number") {
    const d = decimals ?? (Number.isInteger(value) ? 0 : 2);
    return new Intl.NumberFormat("en-US", { minimumFractionDigits: d, maximumFractionDigits: d }).format(value);
  }
  return value == null ? "n/a" : String(value);
}

/* Caption tokens used by tutorials.json. */
export function captionTokens(headline) {
  const s = headline.sites || {};
  const f = (v) => formatValue(v, 2);
  return {
    GALE_MOLA: f(s.gale?.mola_ratio),
    GALE_HIRISE: f(s.gale?.hirise_ratio),
    JEZERO_MOLA: f(s.jezero?.mola_ratio),
    JEZERO_HIRISE: f(s.jezero?.hirise_ratio),
  };
}

export function fillTokens(text, tokens) {
  return text.replace(/\{([A-Z_]+)\}/g, (m, k) => (k in tokens ? tokens[k] : "n/a"));
}

export function fillNumbers(root, headline) {
  root.querySelectorAll("[data-fill]").forEach((el) => {
    const path = el.getAttribute("data-fill");
    const value = path === "run_id" ? headline.run_id : getPath(headline.sites, path);
    el.textContent = formatValue(value, el.dataset.decimals ? Number(el.dataset.decimals) : undefined);
  });
}

export function fillLinks(root, site) {
  root.querySelectorAll("[data-link]").forEach((a) => {
    const url = site[a.getAttribute("data-link")];
    if (url) {
      a.href = url;
      if (/^https?:/.test(url)) a.target = "_blank";
    }
  });
}

const TRI = '<svg class="lp-tri" viewBox="0 0 12 12" aria-hidden="true"><path d="M1 1l10 5-10 5z"/></svg>';

export function renderMarquee(track, label = "Play Reel") {
  if (!track) return;
  const item = `<span class="lp-marquee__item">${TRI}${TRI}${TRI}<span>${label}</span></span>`;
  track.innerHTML = item.repeat(12);
}

export function renderTicker(track, words, itemClass = "lp-ticker__item") {
  if (!track) return;
  const once = words.map((w) => `<span class="${itemClass}">${w}</span><span class="lp-ticker__sep" aria-hidden="true"></span>`).join("");
  track.innerHTML = once + once;
}

export function renderTeam(list, team) {
  if (!list || !Array.isArray(team) || !team.length) return;
  list.innerHTML = team
    .map((m) => `<li><strong>${escapeHtml(m.name)}</strong><span class="lp-small">${escapeHtml(m.role || "")}</span></li>`)
    .join("");
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}
