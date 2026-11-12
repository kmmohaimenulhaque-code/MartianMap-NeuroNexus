"""search_web: the assistant's live web search tool (Path B).

Used when Google Search grounding is blocked on the active model (400, 403 or quota errors) and whenever the
question needs the console tools in the same turn, where native grounding cannot be combined with them.
Queries Wikipedia, the NASA Image and Video Library and DuckDuckGo's HTML endpoint. Every request goes through
science.settings.check_url with WEB_SEARCH_HOSTS (HTTPS only, no other hosts). Only search results are read;
linked pages are never fetched. Nothing here is a NASA observation: results are tagged WEB.
"""

from __future__ import annotations

import html
import re
from typing import Any
from urllib.parse import parse_qs, quote, unquote, urlparse

import requests

from science import settings
from science.ai.knowledge_tools import tool

TIMEOUT_S = 8.0
MAX_RESULTS = 8
USER_AGENT = "NeuroNexus-MarsIntelligence/1.0 (NASA Space Apps 2026; search_web tool)"


def _get(url: str, **params: Any) -> requests.Response:
    settings.check_url(url, settings.WEB_SEARCH_HOSTS)
    response = requests.get(url, params=params, timeout=TIMEOUT_S, headers={"User-Agent": USER_AGENT})
    response.raise_for_status()
    return response


def _strip(text: str) -> str:
    return html.unescape(re.sub(r"<[^>]+>", "", text or "")).strip()


def _wikipedia(query: str) -> list[dict[str, str]]:
    data = _get("https://en.wikipedia.org/w/rest.php/v1/search/page", q=query, limit=4).json()
    return [{"title": page.get("title", ""), "url": f"https://en.wikipedia.org/wiki/{quote(str(page.get('key', '')))}",
             "snippet": _strip(page.get("excerpt") or page.get("description") or ""), "source": "Wikipedia"}
            for page in data.get("pages", []) if page.get("key")]


def _nasa(query: str) -> list[dict[str, str]]:
    data = _get("https://images-api.nasa.gov/search", q=query, media_type="image").json()
    out = []
    for item in (data.get("collection", {}).get("items") or [])[:3]:
        meta = (item.get("data") or [{}])[0]
        if meta.get("nasa_id"):
            out.append({"title": meta.get("title", ""), "url": f"https://images.nasa.gov/details/{quote(meta['nasa_id'])}",
                        "snippet": _strip(meta.get("description") or "")[:300], "source": "NASA Image and Video Library"})
    return out


def _duckduckgo(query: str) -> list[dict[str, str]]:
    page = _get("https://html.duckduckgo.com/html/", q=query).text
    out = []
    for link, title, snippet in re.findall(
            r'class="result__a"[^>]*href="([^"]+)"[^>]*>(.*?)</a>.*?class="result__snippet"[^>]*>(.*?)</a>', page, re.S):
        target = parse_qs(urlparse(html.unescape(link)).query).get("uddg", [html.unescape(link)])[0]
        target = unquote(target)
        if target.startswith("http"):
            out.append({"title": _strip(title), "url": target, "snippet": _strip(snippet)[:300], "source": "DuckDuckGo"})
        if len(out) >= 4:
            break
    return out


PROVIDERS = (("wikipedia", _wikipedia), ("nasa", _nasa), ("duckduckgo", _duckduckgo))


@tool("search_web",
      "Search the live web (Wikipedia, NASA Image and Video Library, DuckDuckGo) for recent or outside facts "
      "the local knowledge base lacks: news, current mission status, general knowledge. Returns titles, URLs and "
      "snippets. Evidence class WEB, never a NASA observation.",
      {"query": {"type": "string", "description": "Short web search query."}}, ["query"])
def search_web(state, query: str, **_) -> dict[str, Any]:
    query = str(query or "").strip()[:200]
    if not query:
        return {"status": "UNAVAILABLE", "detail": "Empty search query."}
    if settings.demo_pack_mode():
        return {"status": "UNAVAILABLE", "detail": "Live web search is off in demo-pack mode."}
    results: list[dict[str, str]] = []
    errors: list[str] = []
    for name, provider in PROVIDERS:
        try:
            results.extend(provider(query))
        except Exception as exc:  # one provider down must not stop the others
            errors.append(f"{name}: {type(exc).__name__}")
    seen: set[str] = set()
    unique = [r for r in results if not (r["url"] in seen or seen.add(r["url"]))][:MAX_RESULTS]
    if not unique:
        return {"status": "NO RESULTS", "query": query, "errors": errors,
                "detail": "No web results were retrieved. Say so and answer from general knowledge, labeled as such."}
    return {"status": "ok", "evidence_class": "WEB", "query": query, "results": unique, "errors": errors,
            "citation_rule": "Mention the source by name in words (for example 'Wikipedia says'). Web results are not NASA observations."}
