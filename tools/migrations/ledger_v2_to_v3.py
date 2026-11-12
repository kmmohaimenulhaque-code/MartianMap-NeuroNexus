"""One-time migration (2026-10-20): merge the three drifting ledgers into one canonical v3 ledger.

Inputs (as they were at commit 71d7fe8): data/manifests/updated_source_ledger.json (39 sources +
8 team outputs), data/manifests/source_ledger.json (17 ids), science/provenance.py ENTRIES (14).
Output: data/manifests/source_ledger.json (schema neuronexus.source-ledger.v3). After this ran, the
canonical file is edited directly and tools/build_ledger.py regenerates the legacy files.
"""
from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
TODAY = "2026-10-20"
OLD_STATUS = {"USED_AND_INGESTED": "INGESTED", "USED": "QUERIED LIVE", "USED_AS_REFERENCE": "REFERENCE ONLY",
              "USED_AS_REFERENCE_ONLY": "REFERENCE ONLY", "CATALOGUED_NOT_INGESTED": "CATALOGED NOT INGESTED"}
# legacy uppercase id -> (canonical id, evidence class)
CANON = {
    "NASA_PDS": ("NASA_PDS", "NASA REFERENCE"), "MOLA": ("MOLA_MEGDR", "OBSERVED"), "THEMIS": ("THEMIS", "OBSERVED"),
    "NASA_AMES_MGCM": ("NASA_AMES_MGCM", "MODELED"), "USGS_IAU_GAZETTEER": ("USGS_IAU_GAZETTEER", "NASA REFERENCE"),
    "USGS_SIM_3292": ("USGS_SIM_3292", "NASA REFERENCE"), "USGS_SIM_3292_ARCGIS": ("USGS_SIM_3292_ARCGIS", "NASA REFERENCE"),
    "NASA_MMGIS": ("NASA_MMGIS", "OBSERVED"), "NASA_RAD": ("MSL_RAD_RDR", "OBSERVED"),
    "NASA_JPL_CAD": ("NASA_JPL_CAD", "OBSERVED"),
}
PROV_ALIAS = {"usgs_nomenclature": "USGS_IAU_GAZETTEER", "usgs_sim3292": "USGS_SIM_3292", "nasa_mola": "MOLA_MEGDR",
              "nasa_themis": "THEMIS", "nasa_ames_mgcm": "NASA_AMES_MGCM", "nasa_rad": "MSL_RAD_RDR",
              "nasa_image_library": "NASA_IMAGE_LIBRARY", "nasa_photojournal": "NASA_MARS", "jpl_cad": "NASA_JPL_CAD",
              "nn_route_engine": "NN_ROUTE_ENGINE", "nn_risk_proxy": "NN_TERRAIN_RISK_PROXY",
              "nn_eva_model": "NN_EVA_MODEL", "nn_mission_sim": "NN_MISSION_SIM", "gemini": "GEMINI"}
TEAM_CLASS = {"TEAM_METHOD": "COMPUTED", "DERIVED_OUTPUT": "DERIVED", "TEAM_EXPERIMENT": "SIMULATED",
              "AI_INTERPRETATION": "AI INTERPRETATION"}


def entry(id_, **kw):
    base = {"id": id_, "aliases": [], "organization": "", "mission": None, "instrument": None, "product_title": "",
            "product_id_pattern": None, "doi": None, "url": None, "landing_page": None, "license": None,
            "citation": None, "evidence_class": "NASA REFERENCE", "ingestion_status": "REFERENCE ONLY",
            "access_method": None, "used_by": [], "retrieved_at": None, "version": None, "archive_lag_days": None,
            "caveats": [], "verified_on": None, "verification_note": "Carried over from the v2 ledgers; not re-verified."}
    base.update(kw)
    return base


NEW = [
    entry("USGS_ASTROGEOLOGY_STAC", organization="USGS Astrogeology Science Center", product_title="Astrogeology STAC API (analysis-ready planetary data)",
          url="https://stac.astrogeology.usgs.gov/api", landing_page="https://stac.astrogeology.usgs.gov/docs/", license="public domain (USGS)",
          evidence_class="NASA REFERENCE", ingestion_status="QUERIED LIVE", access_method="POST /api/search, 24 h disk cache",
          used_by=["GET /terrain/sources", "science/hires/stac.py"], verified_on=TODAY,
          verification_note="Live search over Gale bbox [137.0,-5.2,137.8,-4.3]: 16 HiRISE DTM items; next links point at an API Gateway host and are rewritten to the allowlisted host."),
    entry("HIRISE_STAC_DTM", aliases=["HIRISE_DTM"], organization="NASA / MRO / HiRISE (University of Arizona); USGS Astrogeology", mission="Mars Reconnaissance Orbiter",
          instrument="HiRISE", product_title="MRO HiRISE SOCET DTMs (collection mro_hirise_socet_dtms)", product_id_pattern="DTEEC_*",
          url="https://stac.astrogeology.usgs.gov/api/collections/mro_hirise_socet_dtms", landing_page="https://www.uahirise.org/dtm/", license="CC0-1.0",
          citation="McEwen et al. (2007), JGR 112, E05S02; DTMs produced with BAE SOCET Set/GXP", evidence_class="OBSERVED", ingestion_status="INGESTED",
          access_method="COG range reads (/vsicurl/) into LocalGrid; corridor COGs when present", used_by=["/terrain/hires/*", "/marswalk/*", "validation V1-V6"],
          caveats=["About 1.01 m posting; features below 1-2 m (rocks, ripples) are not represented", "Some STAC dtm links return HTTP 404; they are marked UNAVAILABLE"],
          verified_on=TODAY, verification_note="Gale: 13 of 16 DTMs read via HTTP range reads; DTEEC_040770_1755_039280_1755_A01, DTEEC_018788_1755_018287_1755_A01 and DTEEC_008147_1750_007356_1750_H01 returned HTTP 404. All 13 passed the datum check (|median vs MOLA| <= 21 m)."),
    entry("HIRISE_STAC_ORTHO", organization="NASA / MRO / HiRISE; USGS Astrogeology", mission="Mars Reconnaissance Orbiter", instrument="HiRISE",
          product_title="HiRISE orthoimages paired with the SOCET DTMs", product_id_pattern="*_ORTHO / ortho_*", url="https://stac.astrogeology.usgs.gov/api/collections/mro_hirise_socet_dtms",
          license="CC0-1.0", evidence_class="OBSERVED", ingestion_status="INGESTED", access_method="COG range reads, percentile-stretched for display",
          used_by=["GET /terrain/hires/image?layer=ortho"], verified_on=TODAY, verification_note="Ortho and DTM share CRS and bounds within 2 m; registration vs DTM hillshade within 1-2 px at 2 m."),
    entry("CTX_STAC_DTM", aliases=["CTX_DTM"], organization="NASA / MRO / CTX (MSSS); USGS Astrogeology", mission="Mars Reconnaissance Orbiter", instrument="CTX",
          product_title="MRO CTX controlled USGS DTMs (collection mro_ctx_controlled_usgs_dtms, Ames Stereo Pipeline, pc_align to MOLA)",
          url="https://stac.astrogeology.usgs.gov/api/collections/mro_ctx_controlled_usgs_dtms", landing_page="https://stac.astrogeology.usgs.gov/docs/data/mars/ctxdtms/",
          license="CC0-1.0", evidence_class="OBSERVED", ingestion_status="INGESTED", access_method="COG range reads; geoid_adjusted_dem preferred",
          used_by=["/terrain/hires/*", "/marswalk/*"], caveats=["The collection notes some DTMs are jittery or gappy and not an improvement over MOLA: every product is QA-gated", "2024 items' qa_metrics assets returned 404; QA uses the empirical MOLA comparison"],
          verified_on=TODAY, verification_note="3,698 CTX items' geometries contain Curiosity's area (137.42E, -4.7N); 20 m posting, nodata -32767, eqc lat_ts=0 R=3396190."),
    entry("CTX_MOLA_SHOTS", organization="NASA MGS MOLA via USGS Astrogeology", mission="Mars Global Surveyor", instrument="MOLA",
          product_title="mola_csv assets of 2023 CTX DTM items (latitude, longitude, radius in m)", url="https://stac.astrogeology.usgs.gov/api/collections/mro_ctx_controlled_usgs_dtms",
          license="CC0-1.0", evidence_class="OBSERVED", ingestion_status="INGESTED", access_method="CSV per item", used_by=["validation V2"], verified_on=TODAY,
          verification_note="Format confirmed on P18_008002_1748_XN_05S222W__B01_009927_1752_XN_04S222W: header latitude,longitude,radius."),
    entry("MSL_GALE_DEM_1M", organization="USGS Astrogeology", mission="Mars Science Laboratory", product_title="MSL Gale Merged DEM 1m (Parker & Calef, 2016)",
          url="https://planetarymaps.usgs.gov/mosaic/Mars/MSL/MSL_Gale_DEM_Mosaic_1m_v3.tif", landing_page="https://astrogeology.usgs.gov/search/map/mars_msl_gale_merged_dem_1m",
          license="public domain (USGS)", evidence_class="OBSERVED", ingestion_status="CATALOGED NOT INGESTED", access_method="offline corridor COGs only (tools/build_corridors.py); never read in a request handler",
          caveats=["7.6 GB striped GeoTIFF with no overviews"], verification_note="Facts from the prompt's 2026-10-20 check; not re-read in this session."),
    entry("M2020_TRN_DTM_MOSAIC", organization="USGS Astrogeology", mission="Mars 2020", product_title="Mars 2020 TRN HiRISE DTM Mosaic (Fergason et al., 2020)", doi="10.5066/P9REJ9JN",
          url="https://planetarymaps.usgs.gov/mosaic/mars2020_trn/HiRISE/JEZ_hirise_soc_006_DTM_MOLAtopography_DeltaGeoid_1m_Eqc_latTs0_lon0_blend40.tif",
          landing_page="https://astrogeology.usgs.gov/search/map/mars_2020_terrain_relative_navigation_hirise_dtm_mosaic", license="CC0-1.0", evidence_class="OBSERVED",
          ingestion_status="CATALOGED NOT INGESTED", access_method="offline corridor COGs only", verification_note="Facts from the prompt's 2026-10-20 check; not re-read in this session."),
    entry("M2020_TRN_ORTHO_MOSAIC", organization="USGS Astrogeology", mission="Mars 2020", product_title="Mars 2020 TRN HiRISE orthomosaic", license="CC0-1.0",
          landing_page="https://astrogeology.usgs.gov/search/map/mars_2020_terrain_relative_navigation_hirise_dtm_mosaic", evidence_class="OBSERVED", ingestion_status="CATALOGED NOT INGESTED"),
    entry("MMGIS_MSL_TRAVERSE", organization="NASA / JPL MMGIS", mission="Mars Science Laboratory", product_title="Curiosity traverse (MSL_traverse.json)",
          url="https://mars.nasa.gov/mmgis-maps/MSL/Layers/json/MSL_traverse.json", evidence_class="OBSERVED", ingestion_status="QUERIED LIVE",
          access_method="live GeoJSON with dated snapshot fallback", caveats=["Operations localization, not the archival PDS product"]),
    entry("MMGIS_MSL_WAYPOINTS", organization="NASA / JPL MMGIS", mission="Mars Science Laboratory", product_title="Curiosity end-of-drive waypoints (MSL_waypoints.json) with rover attitude",
          url="https://mars.nasa.gov/mmgis-maps/MSL/Layers/json/MSL_waypoints.json", evidence_class="OBSERVED", ingestion_status="QUERIED LIVE",
          access_method="live GeoJSON with dated snapshot fallback", caveats=["-9999 is a missing-value sentinel", "Operations localization registered to HiRISE base maps"]),
    entry("MMGIS_M2020_TRAVERSE", organization="NASA / JPL MMGIS", mission="Mars 2020", product_title="Perseverance traverse (M20_traverse.json)",
          url="https://mars.nasa.gov/mmgis-maps/M20/Layers/json/M20_traverse.json", evidence_class="OBSERVED", ingestion_status="QUERIED LIVE",
          access_method="live GeoJSON with dated snapshot fallback", caveats=["Operations localization, not the archival PDS product"]),
    entry("MMGIS_M2020_WAYPOINTS", organization="NASA / JPL MMGIS", mission="Mars 2020", product_title="Perseverance waypoints (M20_waypoints.json) with rover attitude",
          url="https://mars.nasa.gov/mmgis-maps/M20/Layers/json/M20_waypoints.json", evidence_class="OBSERVED", ingestion_status="QUERIED LIVE",
          access_method="live GeoJSON with dated snapshot fallback", caveats=["-9999 is a missing-value sentinel"]),
    entry("PDS_PLACES_MSL", organization="NASA PDS Imaging Node", mission="Mars Science Laboratory", product_title="MSL PLACES localization bundle",
          url="https://pds.nasa.gov/data/pds4/releases/img/msl_places-20260317/", evidence_class="OBSERVED", ingestion_status="CATALOGED NOT INGESTED"),
    entry("PDS_PLACES_M2020", organization="NASA PDS Geosciences Node", mission="Mars 2020", product_title="Mars 2020 rover PLACES bundle",
          url="https://pds.nasa.gov/data/pds4/releases/geo/mars2020_rover_places-20260811/", landing_page="https://pds-geosciences.wustl.edu/missions/mars2020/places.htm",
          evidence_class="OBSERVED", ingestion_status="CATALOGED NOT INGESTED"),
    entry("MSL_REMS_OUTREACH", organization="NASA / JPL / CAB (Centro de Astrobiologia)", mission="Mars Science Laboratory", instrument="REMS",
          product_title="REMS weather outreach feed", url="https://mars.nasa.gov/rss/api/?feed=weather&category=msl&feedtype=json", evidence_class="OBSERVED",
          ingestion_status="CATALOGED NOT INGESTED", caveats=["OUTREACH FEED (CAB/NASA), not for operations"]),
    entry("M2020_MEDA_OUTREACH", organization="NASA / JPL", mission="Mars 2020", instrument="MEDA", product_title="MEDA weather outreach feed",
          url="https://mars.nasa.gov/rss/api/?feed=weather&category=mars2020&feedtype=json", evidence_class="OBSERVED", ingestion_status="CATALOGED NOT INGESTED",
          caveats=["Latest entry 2024-04 at prompt time: NO RECENT DATA"]),
]
METHODS = [
    ("NEURONEXUS_TERRAIN_LADDER", "Terrain resolution ladder (HiRISE -> CTX -> MOLA per-pixel priority mosaic)", ["science/hires/ladder.py", "/terrain/hires/*"]),
    ("NEURONEXUS_SLOPE_MULTI_BASELINE", "Multi-baseline Horn slope and detrended roughness", ["science/hires/derivatives.py"]),
    ("NEURONEXUS_WALKABILITY", "Meter-scale walkability index and planning classes (Appendix A5)", ["science/hires/layers.py", "/marswalk/*"]),
    ("NEURONEXUS_MARSWALK_PARAMETERS", "Marswalk planning limits and parameters (science/marswalk/config.py)", ["GET /marswalk/config"]),
    ("NEURONEXUS_PACE_MODEL", "Tobler pace normalized to the flat pace; Naismith option (Appendix A6)", ["/marswalk/*"]),
    ("NEURONEXUS_METABOLIC_PROXY", "Gravity-scaled Pandolf-type metabolic and consumables screening proxy (Appendix A6b)", ["/marswalk/*"]),
    ("NEURONEXUS_PNR_MODEL", "Turnaround point (Point of No Return, Appendix A7)", ["/marswalk/*"]),
    ("NEURONEXUS_MARSWALK_PLANNER", "Multi-resolution corridor planner on the terrain ladder", ["POST /marswalk/plan"]),
    ("NEURONEXUS_DOSE_SCREENING", "EVA dose screening from archived RAD dose rates (Appendix A8)", ["GET /conditions"]),
    ("NEURONEXUS_VALIDATION_SUITE", "Rover ground-truth validation suite V1-V6", ["GET /validation/latest"]),
    ("NEURONEXUS_CLIENT_MATH", "Browser Optimization client math (worker parity with the backend formulas)", ["frontend/src/workers/marswalkMath.worker.js"]),
]


def main():
    upd = json.loads((ROOT / "data/manifests/updated_source_ledger.json").read_text())
    import sys
    sys.path.insert(0, str(ROOT))
    from science.provenance import ENTRIES, EVIDENCE_STATUSES
    prov = {PROV_ALIAS[e["id"]]: e for e in ENTRIES}
    entries = []
    for src in upd["sources"]:
        cid, cls = CANON.get(src["id"], (src["id"], "NASA REFERENCE"))
        p = prov.get(cid)
        aliases = sorted({src["id"]} - {cid} | ({p["id"]} if p else set()))
        e = entry(cid, aliases=aliases, organization=src["organization"], product_title=(p or {}).get("title") or src["id"].replace("_", " ").title(),
                  url=src.get("url"), evidence_class=cls, ingestion_status=OLD_STATUS[src["status"]], used_by=[],
                  legacy={"id": src["id"], "role": src["role"], "status": src["status"], "used_for": src.get("used_for", []),
                          **({"note": src["note"]} if "note" in src else {}),
                          **({"extra": extra} if (extra := {k: v for k, v in src.items() if k not in
                              ("id", "organization", "role", "status", "url", "used_for", "note")}) else {})},
                  caveats=[src["note"]] if "note" in src else [])
        if p:
            e["provenance"] = {"class": p["class"], "use": p["use"]}
        entries.append(e)
    for t in upd["team_outputs"]:
        p = prov.get(t["id"])
        e = entry(t["id"], aliases=sorted({p["id"]}) if p else [], organization="Google" if t["id"] == "GEMINI" else "NeuroNexus",
                  product_title=t["title"], url=(p or {}).get("url"), evidence_class=TEAM_CLASS[t["type"]], ingestion_status="INGESTED",
                  access_method="computed in this application", verified_on=TODAY, verification_note="Team method or output in this repository.",
                  legacy_team_output={"type": t["type"], "status": t["status"], "description": t["description"]})
        if p:
            e["provenance"] = {"class": p["class"], "use": p["use"]}
        entries.append(e)
    entries += NEW
    for mid, title, used in METHODS:
        entries.append(entry(mid, organization="NeuroNexus", product_title=title, evidence_class="DERIVED" if "WALK" in mid or "LADDER" in mid else "COMPUTED",
                             ingestion_status="INGESTED", access_method="computed in this application", used_by=used,
                             verified_on=TODAY, verification_note="Implemented and unit-tested in this repository; formulas in docs/METHODOLOGY.md."))
    # Status changes made by this work (T8.1).
    by_id = {e["id"]: e for e in entries}
    for cid in ("CTX", "HIRISE"):
        by_id[cid]["ingestion_status"] = "INGESTED"
        by_id[cid]["legacy"]["status"] = "USED_AND_INGESTED"
        by_id[cid]["verified_on"] = TODAY
        by_id[cid]["verification_note"] = "Ingested through the USGS STAC DTM collections (see HIRISE_STAC_DTM / CTX_STAC_DTM)."
    by_id["MOLA_MEGDR"].update(url="https://pds-geosciences.wustl.edu/mgs/mgs-m-mola-5-megdr-l3-v1/mgsl_300x/meg128/",
                               landing_page="https://pds-geosciences.wustl.edu/missions/mgs/megdr.html", license="public domain (NASA PDS)",
                               mission="Mars Global Surveyor", instrument="MOLA", product_id_pattern="megt*hb.img / megr*hb.img",
                               citation="Smith et al. (2003), MGS-M-MOLA-5-MEGDR-L3-V1.0, NASA PDS", access_method="tools/fetch_mola.py (size-checked, sha256 logged); memory-mapped",
                               verified_on=TODAY, verification_note="megt00n090hb/megr00n090hb/megt44n000hb/megr44n000hb downloaded from PDS: 129,761,280 bytes each; megr label OFFSET = 3396000, SCALING_FACTOR = 1, UNIT = METER.")
    ledger = {"schema": "neuronexus.source-ledger.v3", "project": "NeuroNexus", "generated_by": "tools/migrations/ledger_v2_to_v3.py (once), then edited directly",
              "evidence_classes": {"OBSERVED": "A real instrument measurement from a mission archive.", "NASA REFERENCE": "A published NASA/USGS/partner reference value, catalog or map.",
                                   "MODELED": "Output of a physical model (e.g. NASA Ames Mars GCM).", "DERIVED": "Computed by NeuroNexus from observed or modeled inputs.",
                                   "COMPUTED": "Geometry or arithmetic computed by NeuroNexus.", "SIMULATED": "A configurable NeuroNexus simulation value, not a measurement.",
                                   "AI INTERPRETATION": "Language-model interpretation of structured results; never a NASA observation."},
              "ingestion_statuses": {"INGESTED": "Data are read and used by the pipeline.", "QUERIED LIVE": "Fetched from the provider at run time (cached).",
                                     "REFERENCE ONLY": "Linked for context; the data are not ingested.", "CATALOGED NOT INGESTED": "Registered but not ingested; nothing is inferred from it.",
                                     "UNAVAILABLE": "Known but not reachable or not usable."},
              "legacy_export": {k: upd[k] for k in ("project", "schema_version", "purpose", "provenance_boundary", "evidence_statuses", "project_boundary")},
              "legacy_provenance": {"evidence_statuses": EVIDENCE_STATUSES},
              "entries": entries}
    (ROOT / "data/manifests/source_ledger.json").write_text(json.dumps(ledger, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(len(entries), "entries")


if __name__ == "__main__":
    main()
