"""Run the validation suite: python -m science.validation.run --site gale|jezero|all

Writes validation/reports/<site>/<run_id>/{report.json, report.md, figures/} and validation/reports/latest.json.
The README table and the console read only latest.json.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import sys
import time
from datetime import UTC, datetime
from pathlib import Path

from science import settings
from science.hires import catalog, ladder
from science.marswalk import planner
from science.validation import elevation, radiation, routes, sampling, seams, slope

SCHEMA = "neuronexus.validation.v1"
REPORTS = settings.PROJECT_ROOT / "validation" / "reports"
SITE_ROVER = {"gale": "msl", "jezero": "m2020"}
SOURCE_IDS = ["HIRISE_STAC_DTM", "CTX_STAC_DTM", "CTX_MOLA_SHOTS", "MOLA_MEGDR", "MMGIS_MSL_WAYPOINTS", "MMGIS_MSL_TRAVERSE",
              "MMGIS_M2020_WAYPOINTS", "MMGIS_M2020_TRAVERSE", "NEURONEXUS_VALIDATION_SUITE", "NEURONEXUS_TERRAIN_LADDER",
              "NEURONEXUS_MARSWALK_PLANNER"]


def _fmt_ci(ci, digits):
    return [round(ci[0], digits), round(ci[1], digits)] if ci and all(v == v for v in ci) else None


def headline(site_report: dict) -> list[dict]:
    v1, v3, v4, v6 = (site_report.get(k, {}) for k in ("V1", "V3", "V4", "V6"))
    out = []
    s3 = slope.series(v3, "HIRISE", 3)
    if s3.get("n", 0) >= 10:
        out.append({"id": "V3", "label": "Rover tilt vs HiRISE slope @3 m", "value": f"ρ = {s3['spearman_rho']:.2f}",
                    "number": s3["spearman_rho"], "ci95": _fmt_ci(s3["spearman_ci95"], 2), "n": s3["n"],
                    "meaning": "rank correlation between the rover's IMU tilt and the DTM slope at the vehicle's scale"})
        out.append({"id": "V3", "label": "HiRISE @3 m p90 ratio (tilt / slope)", "value": f"{s3['p90_ratio']:.2f}×",
                    "number": s3["p90_ratio"], "ci95": _fmt_ci(s3["p90_ratio_ci95"], 2), "n": s3["n"],
                    "meaning": "1.00× means the meter-scale map reproduces the steep tail the rover felt"})
    sm = slope.series(v3, "MOLA", 463)
    if sm.get("n", 0) >= 10:
        out.append({"id": "V3", "label": "MOLA-only p90 underestimate", "value": f"{sm['p90_ratio']:.2f}×",
                    "number": sm["p90_ratio"], "ci95": _fmt_ci(sm["p90_ratio_ci95"], 2), "n": sm["n"],
                    "meaning": "the rover's 90th-percentile tilt is this many times the MOLA 463 m slope"})
    hi = v1.get("hirise", {})
    if hi.get("n", 0) >= 3:
        out.append({"id": "V1", "label": "Rover vs HiRISE elevation NMAD", "value": f"{hi['nmad_m']:.1f} m",
                    "number": hi["nmad_m"], "ci95": _fmt_ci(hi["nmad_ci95"], 1), "n": hi["n"],
                    "meaning": f"consistency check (bias {hi['bias_m']:.1f} m); localization is tied to HiRISE"})
    lad = v4.get("methods", {}).get("ladder", {})
    mol = v4.get("methods", {}).get("mola", {})
    if lad.get("n"):
        out.append({"id": "V4", "label": "Ladder plan within 10 m of the real drive", "value": f"{100 * lad['within_10m']['median']:.0f}%",
                    "number": lad["within_10m"]["median"], "ci95": _fmt_ci([100 * c for c in lad["within_10m"]["ci95"]], 0),
                    "n": lad["n"], "meaning": f"median share per leg; MOLA-only {100 * mol['within_10m']['median']:.0f}%"
                    if mol.get("n") else "median share of the planned route within 10 m of the drive"})
    v7 = site_report.get("V7", {})
    if v7.get("n", 0) >= 10:
        out.append({"id": "V7", "label": "RAD dose rate vs surface pressure", "value": f"ρ = {v7['spearman_rho']:.2f}",
                    "number": v7["spearman_rho"], "ci95": _fmt_ci(v7["spearman_ci95"], 2), "n": v7["n"],
                    "meaning": v7["verdict"]})
    hc = v6.get("hirise_minus_ctx_20m", {})
    if hc.get("n", 0) >= 3:
        out.append({"id": "V6", "label": "HiRISE − CTX vertical step (median)", "value": f"{hc['median_m']:.1f} m",
                    "number": hc["median_m"], "ci95": _fmt_ci(hc["bias_ci95"], 1), "n": hc["n"],
                    "meaning": f"{100 * hc['share_flagged']:.0f}% of waypoint windows exceed the 2 m seam flag"})
    return out


def run_site(site: str, log) -> tuple[dict, list[dict]]:
    t0 = time.time()
    s = sampling.samples(site)
    log(f"{site}: sampled {len(s['rows'])} waypoints ({time.time() - t0:.0f} s)")
    rows = s["rows"]
    hirise = [p for p in catalog.products_in_bbox(_bbox(rows), ("HIRISE",)) if p.product_id in s["hirise_products"]]
    for p in hirise:
        ladder._probe_and_check(p)
    ctx = None
    if s["ctx_product"]:
        ctx = next(p for p in catalog.products_in_bbox(_bbox(rows), ("CTX",)) if p.product_id == s["ctx_product"])
        ladder._probe_and_check(ctx)
    report = {"V1": elevation.v1(rows), "V3": slope.v3(rows), "V6": seams.v6(rows)}
    report["V2"] = elevation.v2(rows, hirise, ctx)
    log(f"{site}: V1-V3, V6 done ({time.time() - t0:.0f} s)")
    if site == "gale":
        report["V7"] = radiation.v7()
    report["V4"] = routes.v4(SITE_ROVER[site], log=log)
    log(f"{site}: V4 done ({time.time() - t0:.0f} s)")
    report["data_versions"] = {k: s[k] for k in ("rover_retrieved_at", "rover_origin", "hirise_products", "ctx_product",
                                                  "excluded", "datum_checks")}
    report["headline"] = headline(report)
    legs, _ = routes.legs(SITE_ROVER[site])
    return report, legs


def _bbox(rows):
    lats = [r["lat"] for r in rows]
    lons = [r["lon"] for r in rows]
    return [min(lons) - 0.02, min(lats) - 0.02, max(lons) + 0.02, max(lats) + 0.02]


def figures(site: str, report: dict, out_dir: Path) -> list[str]:
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    out_dir.mkdir(parents=True, exist_ok=True)
    names = []
    series = [s for s in report["V3"]["series"] if s.get("n", 0) >= 10]
    if series:
        fig, ax = plt.subplots(figsize=(6.4, 3.6), dpi=130)
        fig.patch.set_facecolor("#091115")
        ax.set_facecolor("#081014")
        colors = {"HIRISE": "#75e6ff", "CTX": "#4ea8de", "MOLA": "#6f858d"}  # tokens.css --nn-src-*
        for fam in ("HIRISE", "CTX", "MOLA"):
            pts = [s for s in series if s["family"] == fam]
            if pts:
                ax.errorbar([p["baseline_m"] for p in pts], [p["p90_ratio"] for p in pts],
                            yerr=[[p["p90_ratio"] - p["p90_ratio_ci95"][0] for p in pts], [p["p90_ratio_ci95"][1] - p["p90_ratio"] for p in pts]],
                            fmt="o-", color=colors[fam], label=fam, capsize=3)
        ax.axhline(1.0, color="#a8bbc1", lw=0.8, ls="--")
        ax.set_xscale("log")
        ax.set_xlabel("DTM slope baseline (m)", color="#d8e6ea")
        ax.set_ylabel("p90 rover tilt / p90 slope", color="#d8e6ea")
        ax.set_title(f"V3 {site}: where the map underestimates the steep tail", color="#75e6ff", fontsize=10)
        ax.tick_params(colors="#a8bbc1")
        for spine in ax.spines.values():
            spine.set_color("#29414b")
        ax.legend(facecolor="#091115", edgecolor="#29414b", labelcolor="#d8e6ea")
        fig.tight_layout()
        fig.savefig(out_dir / "v3_p90_ratio.png", facecolor=fig.get_facecolor())
        plt.close(fig)
        names.append("v3_p90_ratio.png")
    return names


def markdown(site: str, report: dict, run_id: str) -> str:
    lines = [f"# Validation report: {site} ({run_id})", "", "Generated by `python -m science.validation.run`. See docs/VALIDATION.md.", "",
             "| id | metric | value | 95% CI | n | meaning |", "| --- | --- | --- | --- | --- | --- |"]
    for h in report["headline"]:
        lines.append(f"| {h['id']} | {h['label']} | {h['value']} | {h['ci95']} | {h['n']} | {h['meaning']} |")
    lines += ["", "## V3 series", "", "| family | baseline (m) | n | Spearman ρ | p90 ratio | bias (deg) |", "| --- | --- | --- | --- | --- | --- |"]
    for s in report["V3"]["series"]:
        if s.get("n", 0) >= 10:
            lines.append(f"| {s['family']} | {s['baseline_m']} | {s['n']} | {s['spearman_rho']:.3f} {_fmt_ci(s['spearman_ci95'], 3)} | "
                         f"{s['p90_ratio']:.2f} {_fmt_ci(s['p90_ratio_ci95'], 2)} | {s['bias_deg']:.2f} |")
    lines += ["", "## Raw JSON", "", "See report.json for V1, V2, V4 and V6 in full, with caveats."]
    return "\n".join(lines) + "\n"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--site", choices=["gale", "jezero", "all"], default="all")
    args = parser.parse_args(argv)
    sites = ["gale", "jezero"] if args.site == "all" else [args.site]

    def log(msg):
        print(msg, flush=True)

    latest_path = REPORTS / "latest.json"
    latest = json.loads(latest_path.read_text()) if latest_path.exists() else {"sites": {}}
    results, legs = {}, {}
    for site in sites:
        results[site], legs[site] = run_site(site, log)
    v5 = routes.v5(legs)
    log(f"V5: {v5['identical']}/{v5['ran']} identical")
    stamp = datetime.now(UTC)
    digest = hashlib.sha256(json.dumps(results, sort_keys=True, default=str).encode()).hexdigest()[:8]
    run_id = f"{stamp:%Y%m%d}-{digest}"
    for site, report in results.items():
        report["V5"] = v5
        out = REPORTS / site / run_id
        out.mkdir(parents=True, exist_ok=True)
        report["figures"] = figures(site, report, out / "figures")
        (out / "report.json").write_text(json.dumps({"schema_version": SCHEMA, "run_id": run_id, "site": site, **report},
                                                    indent=1, default=str), encoding="utf-8")
        (out / "report.md").write_text(markdown(site, report, run_id), encoding="utf-8")
        latest["sites"][site] = {"run_id": run_id, "report": f"validation/reports/{site}/{run_id}/report.json",
                                 "headline": report["headline"], "V5": {k: v5[k] for k in ("plans", "ran", "identical", "all_identical")},
                                 "figures": [f"validation/reports/{site}/{run_id}/figures/{f}" for f in report["figures"]]}
    latest.update({"schema_version": SCHEMA, "run_id": run_id, "generated_at": stamp.isoformat(timespec="seconds"),
                   "engine_versions": {"ladder": ladder.ENGINE_VERSION, "planner": planner.ENGINE_VERSION,
                                       "sampler": sampling.SAMPLER_VERSION},
                   "source_ids": SOURCE_IDS,
                   "caveats": ["Rover localization is tied to HiRISE base maps (V1 is a consistency check).",
                               "Rovers are not astronauts; drivers avoided hazards, so drivable ground is over-sampled.",
                               "Hazards below DTM resolution are not represented."]})
    latest_path.parent.mkdir(parents=True, exist_ok=True)
    latest_path.write_text(json.dumps(latest, indent=1, default=str) + "\n", encoding="utf-8")
    for site in sites:
        for h in latest["sites"][site]["headline"]:
            log(f"{site} {h['id']} {h['label']}: {h['value']} {h['ci95']} (n={h['n']})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
