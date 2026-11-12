"""Runtime configuration: cache directories, outbound host allowlist, timeouts, demo-pack mode.

Every outbound fetch added by the Marswalk work goes through ``check_url`` (anti-SSRF).
"""
from __future__ import annotations

import os
from pathlib import Path
from urllib.parse import urlparse

PROJECT_ROOT = Path(__file__).resolve().parents[1]

ALLOWED_HOSTS = frozenset({
    "stac.astrogeology.usgs.gov",
    "astrogeo-ard.s3-us-west-2.amazonaws.com",
    "astrogeo-ard.s3.us-west-2.amazonaws.com",
    "planetarymaps.usgs.gov",
    "asc-pds-services.s3.us-west-2.amazonaws.com",
    "astrogeology.usgs.gov",
    "mars.nasa.gov",
    "pds-geosciences.wustl.edu",
    "pds-ppi.igpp.ucla.edu",
    "pds.nasa.gov",
    "pds-imaging.jpl.nasa.gov",
    "pds-atmospheres.nmsu.edu",
    "hirise-pds.lpl.arizona.edu",
})

CONNECT_TIMEOUT_S = 10.0
READ_TIMEOUT_S = 30.0
STAC_CACHE_TTL_S = 24 * 3600


def cache_root() -> Path:
    return Path(os.environ.get("NEURONEXUS_CACHE_DIR", PROJECT_ROOT / "data" / "cache"))


def demo_pack_dir() -> Path:
    return Path(os.environ.get("NEURONEXUS_DEMO_PACK_DIR", PROJECT_ROOT / "data" / "demo_pack"))


def demo_pack_mode() -> bool:
    """DEMO_PACK=1: serve only pre-fetched real data from the demo pack, never the network."""
    return os.environ.get("DEMO_PACK", "").strip() in {"1", "true", "yes"}


def check_url(url: str) -> str:
    """Reject anything that is not HTTPS to an allowlisted host."""
    parsed = urlparse(url)
    if parsed.scheme != "https" or (parsed.hostname or "").lower() not in ALLOWED_HOSTS:
        raise ValueError(f"outbound host not allowed: {parsed.hostname!r}")
    return url
