from datetime import datetime, timezone

from science.briefing.news import FEEDS, is_mars_article, latest_mars_news, parse_feed

NOW = datetime(2026, 9, 30, 12, 0, tzinfo=timezone.utc)

# Deliberately malformed (missing space between attributes), like NASA Science's feed.
MALFORMED = """<?xml version="1.0"?><rss version="2.0" xmlns:a="x"xmlns:b="y"><channel>
<item><title>Perseverance&#8217;s View of &#8216;Turquoise Bay&#8217;</title>
<link>https://science.nasa.gov/photojournal/turquoise-bay/</link>
<pubDate>Mon, 21 Sep 2026 19:17:59 +0000</pubDate>
<description><![CDATA[<p>Mars 2020 rover image.</p>]]></description></item>
<item><title>Old Mars news</title><link>https://example.org/old-mars</link>
<pubDate>Mon, 01 Jan 2024 00:00:00 +0000</pubDate><description>Mars</description></item>
</channel></rss>"""

GENERAL = """<rss><channel>
<item><title>NASA Opens Moon to Mars Student Challenge</title><link>https://www.nasa.gov/a</link>
<pubDate>Tue, 29 Sep 2026 10:00:00 +0000</pubDate><description>Moon to Mars architecture.</description></item>
<item><title>NASA Selects Mars Telecommunications Provider</title><link>https://www.nasa.gov/b</link>
<pubDate>Tue, 01 Sep 2026 10:00:00 +0000</pubDate><description>Relay network.</description></item>
</channel></rss>"""


def _fake_fetch(feed):
    if "photojournal" in feed["url"]:
        return feed, parse_feed(MALFORMED, feed), None
    if feed["url"] == "https://www.nasa.gov/feed/":
        return feed, parse_feed(GENERAL, feed), None
    return feed, [], "offline"


def test_malformed_feed_is_parsed_and_entities_decoded():
    feed = next(f for f in FEEDS if "photojournal" in f["url"])
    items = parse_feed(MALFORMED, feed)
    assert items[0]["title"] == "Perseverance\u2019s View of \u2018Turquoise Bay\u2019"
    assert items[0]["url"].startswith("https://science.nasa.gov/")
    assert items[0]["description"] == "Mars 2020 rover image."


def test_programme_slogans_do_not_count_as_mars_articles():
    assert not is_mars_article("NASA Opens Moon to Mars Student Challenge", "", "https://x/a", False)
    assert is_mars_article("NASA Selects Mars Telecommunications Provider", "", "https://x/b", False)
    assert is_mars_article("Purple swirls on the Red Planet", "", "https://esa.int/x", True)


def test_latest_news_is_recent_sorted_linked_and_reports_failures():
    payload = latest_mars_news(limit=5, days=30, now=NOW, fetch=_fake_fetch, use_cache=False)
    titles = [item["title"] for item in payload["items"]]
    assert titles == ["Perseverance\u2019s View of \u2018Turquoise Bay\u2019", "NASA Selects Mars Telecommunications Provider"]
    assert all(item["url"].startswith("https://") for item in payload["items"])
    assert all(item["age_days"] <= 30 for item in payload["items"])
    assert "Old Mars news" not in titles  # outside every window
    assert any(source["status"] == "unavailable" for source in payload["sources"])
    assert payload["status"] == "ok"


def test_all_feeds_down_is_reported_not_faked():
    payload = latest_mars_news(limit=5, now=NOW, fetch=lambda feed: (feed, [], "offline"), use_cache=False)
    assert payload["status"] == "unavailable" and payload["items"] == []
