"""Shared physical constants for NeuroNexus.

One Mars radius for every distance computation: the IAU 2015 Mars sphere
(IAU:49910), the same sphere the HiRISE/CTX COGs and the USGS map services use.
"""
from __future__ import annotations

MARS_RADIUS_M = 3_396_190.0
MARS_RADIUS_KM = MARS_RADIUS_M / 1000.0

G_MARS_M_S2 = 3.721
G_EARTH_M_S2 = 9.81

# MOLA MEGDR products store radius as DN + this offset (megr*.lbl: OFFSET = 3396000, UNIT = METER).
MOLA_RADIUS_OFFSET_M = 3_396_000.0
