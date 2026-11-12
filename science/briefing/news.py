"""Aggregated, up-to-date Mars news from NASA and partner organisations.

Every item is a real article from a public RSS feed, with its original link.
Feeds are fetched in parallel, filtered for Mars relevance, de-duplicated,
sorted newest-first and restricted to a recent window (30 days by default,
widened only if fewer than the requested number of items exist; the window
actually used is reported). Some NASA feeds ship slightly malformed XML, so
items are extracted tolerantly rather than rejecting the whole feed.
"""

from __future__ import annotations

import html
import re
import threading
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from typing import Any

USER_AGENT = "Mozilla/5.0 (compatible; NeuroNexus-MarsMap/2.0; +https://science.nasa.gov/mars/)"
CACHE_SECONDS = 1800
FETCH_TIMEOUT_S = 10

# (organisation, feed title, feed URL, mars_only)
# mars_only=True: every item in the feed is about Mars.
# mars_only=False: general feed, filtered by Mars keywords.
FEEDS: list[dict[str, Any]] = [
    {"organisation": "NASA", "name": "NASA — Mars", "url": "https://www.nasa.gov/solar-system/planets/mars/feed/", "mars_only": True},
    {"organisation": "NASA", "name": "NASA — Mars 2020 Perseverance", "url": "https://www.nasa.gov/missions/mars-2020-perseverance/feed/", "mars_only": True},
    {"organisation": "NASA", "name": "NASA — Mars Reconnaissance Orbiter", "url": "https://www.nasa.gov/missions/mars-reconnaissance-orbiter/feed/", "mars_only": True},
    {"organisation": "NASA", "name": "NASA — MAVEN", "url": "https://www.nasa.gov/missions/maven/feed/", "mars_only": True},
    {"organisation": "NASA Science", "name": "NASA Science — Mars Photojournal", "url": "https://science.nasa.gov/feed/photojournal/gallery/mars/", "mars_only": True},
    {"organisation": "NASA", "name": "NASA — News", "url": "https://www.nasa.gov/feed/", "mars_only": False},
    {"organisation": "ESA", "name": "ESA — Mars Express", "url": "https://www.esa.int/rssfeed/Science_Exploration/Space_Science/Mars_Express", "mars_only": True},
    {"organisation": "ESA", "name": "ESA — ExoMars", "url": "https://www.esa.int/rssfeed/Science_Exploration/Human_and_Robotic_Exploration/Exploration/ExoMars", "mars_only": True},
    {"organisation": "The Planetary Society", "name": "The Planetary Society — Articles", "url": "https://www.planetary.org/rss/articles", "mars_only": False},
]

MARS_PATTERN = re.compile(
    r"\b(mars|martian|red planet|perseverance|curiosity rover|ingenuity|jezero|gale crater|phobos|deimos|"
    r"olympus mons|valles marineris|maven|mars express|exomars|rosalind franklin|insight lander)\b",
    re.IGNORECASE,
)

_ITEM = re.compile(r"<item\b[^>]*>(.*?)</item>", re.IGNORECASE | re.DOTALL)
_TAG = {name: re.compile(rf"<{name}\b[^>]*>(.*?)</{name}>", re.IGNORECASE | re.DOTALL)
        for name in ("title", "link", "pubDate", "description", "guid")}
_CDATA = re.compile(r"<!\[CDATA\[(.*?)\]\]>", re.DOTALL)
_TAGS = re.compile(r"<[^>]+>")

_lock = threading.Lock()
_cache: dict[str, Any] = {"at": 0.0, "items": None, "sources": None}


def _text(raw: str | None, limit: int | None = None) -> str:
    if not raw:
        return ""
    value = _CDATA.sub(lambda m: m.group(1), raw)
    value = html.unescape(_TAGS.sub(" ", value))
    value = re.sub(r"\s+", " ", value).strip()
    if limit and len(value) > limit:
        value = value[: limit - 1].rsplit(" ", 1)[0] + "…"
    return value


# Agency programme names that mention Mars without being about Mars.
_PROGRAMME_PHRASES = re.compile(r"\b(moon to mars|moon-to-mars|to the moon and mars|moon and mars|artemis to mars)\b", re.IGNORECASE)


def is_mars_article(title: str, description: str, link: str, mars_only_feed: bool) -> bool:
    """Relevance rule: the article itself must be about Mars.

    General feeds need Mars in the title. Mars-specific feeds need Mars in the
    title, the summary or the article path. Programme slogans such as
    "Moon to Mars" do not count on their own.
    """
    title_hit = bool(MARS_PATTERN.search(_PROGRAMME_PHRASES.sub(" ", title)))
    if not mars_only_feed:
        return title_hit
    summary_hit = bool(MARS_PATTERN.search(_PROGRAMME_PHRASES.sub(" ", description)))
    path_hit = "/mars" in link.lower() or "mars-" in link.lower() or "perseverance" in link.lower()
    return title_hit or summary_hit or path_hit


def _field(block: str, name: str) -> str:
    match = _TAG[name].search(block)
    return match.group(1) if match else ""


def _parse_date(raw: str) -> datetime | None:
    try:
        value = parsedate_to_datetime(raw.strip())
    except (TypeError, ValueError, IndexError):
        return None
    if value is None:
        return None
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def parse_feed(xml_text: str, feed: dict[str, Any]) -> list[dict[str, Any]]:
    """Tolerant RSS item extraction (works on the malformed NASA Science feeds)."""
    items = []
    for block in _ITEM.findall(xml_text):
        title = _text(_field(block, "title"))
        link = _text(_field(block, "link")) or _text(_field(block, "guid"))
        if not title or not link.startswith("http"):
            continue
        description = _text(_field(block, "description"), 280)
        if not is_mars_article(title, description, link, feed["mars_only"]):
            continue
        published = _parse_date(_text(_field(block, "pubDate")))
        items.append({
            "title": title,
            "url": link,
            "published": published.isoformat() if published else None,
            "published_ts": published.timestamp() if published else None,
            "description": description,
            "source": feed["name"],
            "organisation": feed["organisation"],
            "feed_url": feed["url"],
        })
    return items


def _fetch(feed: dict[str, Any]) -> tuple[dict[str, Any], list[dict[str, Any]], str | None]:
    request = urllib.request.Request(feed["url"], headers={"User-Agent": USER_AGENT, "Accept": "application/rss+xml, application/xml, text/xml"})
    try:
        with urllib.request.urlopen(request, timeout=FETCH_TIMEOUT_S) as response:
            text = response.read().decode("utf-8", errors="replace")
        return feed, parse_feed(text, feed), None
    except Exception as exc:  # one failing feed never breaks the briefing
        return feed, [], str(exc)[:160]


def _normalise_url(url: str) -> str:
    return url.split("?")[0].split("#")[0].rstrip("/").lower()


def collect_items(fetch=_fetch, use_cache: bool = True) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    with _lock:
        if use_cache and _cache["items"] is not None and time.time() - _cache["at"] < CACHE_SECONDS:
            return list(_cache["items"]), list(_cache["sources"])
    with ThreadPoolExecutor(max_workers=len(FEEDS)) as pool:
        results = list(pool.map(fetch, FEEDS))
    seen: dict[str, dict[str, Any]] = {}
    sources = []
    for feed, items, error in results:
        sources.append({"organisation": feed["organisation"], "name": feed["name"], "feed_url": feed["url"],
                        "status": "ok" if error is None else "unavailable", "items": len(items), "error": error})
        for item in items:
            key = _normalise_url(item["url"])
            previous = seen.get(key)
            # keep the dedicated Mars feed's copy when the same article appears twice
            if previous is None or (not previous.get("_mars_feed") and feed["mars_only"]):
                seen[key] = {**item, "_mars_feed": feed["mars_only"]}
    items = sorted(seen.values(), key=lambda item: item["published_ts"] or 0.0, reverse=True)
    for item in items:
        item.pop("_mars_feed", None)
    with _lock:
        _cache.update(at=time.time(), items=items, sources=sources)
    return items, sources


def latest_mars_news(limit: int = 8, days: int = 30, *, now: datetime | None = None, fetch=_fetch,
                     use_cache: bool = True) -> dict[str, Any]:
    now = now or datetime.now(timezone.utc)
    items, sources = collect_items(fetch=fetch, use_cache=use_cache)
    dated = [item for item in items if item["published_ts"] is not None]

    window_days = days
    recent = [item for item in dated if item["published_ts"] >= (now - timedelta(days=window_days)).timestamp()]
    # Widen the window only when the recent month is too thin, and say so.
    for wider in (60, 90):
        if len(recent) >= limit:
            break
        window_days = max(days, wider)
        recent = [item for item in dated if item["published_ts"] >= (now - timedelta(days=window_days)).timestamp()]

    # Keep at most two consecutive items per source so one feed cannot dominate.
    chosen: list[dict[str, Any]] = []
    per_source: dict[str, int] = {}
    for item in recent:
        if per_source.get(item["source"], 0) >= max(2, limit // 3):
            continue
        per_source[item["source"]] = per_source.get(item["source"], 0) + 1
        chosen.append(item)
        if len(chosen) >= limit:
            break
    if len(chosen) < limit:
        extras = [item for item in recent if item not in chosen]
        chosen.extend(extras[: limit - len(chosen)])
        chosen.sort(key=lambda item: item["published_ts"] or 0.0, reverse=True)

    for item in chosen:
        item.pop("published_ts", None)
        age = (now - datetime.fromisoformat(item["published"])).days if item["published"] else None
        item["age_days"] = age

    ok = [s for s in sources if s["status"] == "ok"]
    return {
        "status": "ok" if chosen else ("unavailable" if not ok else "empty"),
        "source": "NASA and partner organisations (NASA, NASA Science, ESA, The Planetary Society)",
        "feed_url": FEEDS[0]["url"],
        "window_days": window_days,
        "window_widened": window_days > days,
        "generated_at": now.isoformat(),
        "count": len(chosen),
        "items": chosen,
        "sources": sources,
        "note": "Public news feeds for reference; not spacecraft telemetry.",
    }
