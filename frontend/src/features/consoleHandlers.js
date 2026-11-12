/*
 * Handlers for the Radial Feature Wheel's actions that are not already Command Index commands
 * (mode, terrain ladder, layer, sol, validation and export shortcuts). Built from App state setters.
 */

import { exportEvaBrief, exportGeoJson, exportProfileCsv, exportValidation } from "../exports/actions";
import { planStore } from "../marswalk/planStore";
import { installStore } from "../pwa/installStore";
import { perfStore } from "../perf/perfStore";
import { solSnapshot } from "../state/solStore";

export function buildConsoleHandlers(ctx) {
  const { appMode, switchMode, setLayerVisibility, setLegendOpen, scrollToPanel, setCommandIndex, setNotice, setSol, setDustPlaying, startDemo, startTour } = ctx;

  const toMarswalk = (pending) => {
    planStore.set({ pending });
    switchMode("marswalk");
  };
  const toGlobal = (fn) => () => {
    switchMode("global");
    fn?.();
  };
  const flip = (ids) =>
    setLayerVisibility((v) => {
      const on = !ids.every((id) => v[id]);
      return { ...v, ...Object.fromEntries(ids.map((id) => [id, on])) };
    });
  const run = (fn) => async () => {
    try {
      const msg = await fn(solSnapshot());
      if (msg) setNotice(msg);
    } catch (error) {
      setNotice(error.message);
    }
  };

  return {
    "global-console": { run: () => switchMode("global"), available: () => (appMode === "global" ? "Already in the global console" : true) },
    "rover-replay": {
      run: toGlobal(() => {
        setLayerVisibility((v) => ({ ...v, mslTraverse: true }));
        setSol(1);
        setDustPlaying(true);
        setNotice("Rover replay: MY34 sol 1 onward; the Curiosity marker follows the active sol. Pause from the top bar.");
      }),
    },
    "ladder-full": { run: () => toMarswalk({ type: "mode", value: "ladder" }) },
    "ladder-ctx": { run: () => toMarswalk({ type: "mode", value: "ctx_mola" }) },
    "ladder-mola": { run: () => toMarswalk({ type: "mode", value: "mola" }) },
    "slope-baseline": { run: () => toMarswalk({ type: "overlay", value: "slope" }) },
    "layer-topography": { run: toGlobal(() => setLayerVisibility((v) => ({ ...v, mola: true, hiriseFootprints: !v.hiriseFootprints }))) },
    "layer-geology": {
      run: toGlobal(() => {
        flip(["features"]);
        setTimeout(() => scrollToPanel("panel-usgs-map"), 200);
      }),
    },
    "layer-dust": { run: toGlobal(() => flip(["dust"])) },
    "layer-ground-truth": { run: toGlobal(() => flip(["mslTraverse", "m2020Traverse", "waypoints"])) },
    "toggle-legend": { run: toGlobal(() => setLegendOpen((v) => !v)) },
    "sol-scrubber": {
      run: () => {
        const input = document.querySelector(".nn-solscrub input[type='range']");
        input?.focus();
        input?.closest(".nn-solscrub")?.classList.add("nn-flash");
        setTimeout(() => input?.closest(".nn-solscrub")?.classList.remove("nn-flash"), 1600);
      },
    },
    "rad-weather": { run: () => toMarswalk({ type: "scroll", scroll: "mw-conditions" }) },
    "validation-gale": { run: () => toMarswalk({ type: "site", value: "gale", scroll: "mw-validation" }) },
    "validation-jezero": { run: () => toMarswalk({ type: "site", value: "jezero", scroll: "mw-validation" }) },
    "multi-stop-eva": { run: () => (planStore.get().plan ? toMarswalk({ type: "multistop" }) : startDemo?.("multiStop")) },
    "parameter-sensitivity": {
      run: () => toMarswalk({ type: "sensitivity", scroll: "mw-sensitivity" }),
      available: () => (planStore.get().plan ? true : "Plan a Marswalk first"),
    },
    "judge-tour": { run: () => startTour?.() },
    "install-app": { run: run(() => installStore.install()) },
    "verify-plan": { run: () => toMarswalk({ type: "verify" }), available: () => (planStore.get().plan ? true : "Plan a Marswalk first") },
    "export-eva-brief": { run: run(exportEvaBrief), available: () => (planStore.get().plan ? true : "Plan a Marswalk first") },
    "export-geojson": { run: run(exportGeoJson), available: () => (planStore.get().plan ? true : "Plan a Marswalk first") },
    "export-csv-profile": { run: run(exportProfileCsv), available: () => (planStore.get().plan ? true : "Plan a Marswalk first") },
    "export-validation": { run: run(() => exportValidation(null)) },
    "command-index": { run: () => setCommandIndex({ open: true, tab: "commands" }) },
    "radial-wheel": { run: () => window.dispatchEvent(new CustomEvent("nn:open-wheel")) },
    "browser-optimization": {
      run: () => {
        perfStore.toggle();
        setNotice(perfStore.isOn() ? "Browser Optimization ON (low-RAM mode). Numbers are unchanged." : "Browser Optimization OFF (max fidelity).");
      },
    },
  };
}
