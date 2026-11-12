from __future__ import annotations

from science.site_science import build_site_science


def build_site_profile(feature: dict) -> dict:
    """
    Compatibility adapter for the hazard/evidence layer.

    The current NeuroNexus repository exposes site evidence through
    science.site_science.build_site_science(). Keep the hazard engine
    interface stable while using that canonical implementation.
    """
    return build_site_science(feature)
