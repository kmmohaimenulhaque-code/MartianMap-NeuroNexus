/*
 * Install as app (PWA). Registers the app service worker in normal production builds (the static demo has its
 * own) and keeps the browser's deferred install prompt so the menu, wheel and Command Index can offer INSTALL.
 * iOS has no prompt: there the action explains Share -> Add to Home Screen.
 */
import { useSyncExternalStore } from "react";

import { DEMO_PACK } from "../demo/demoMode";

let deferred = null;
let installed = false;
const listeners = new Set();
const emit = () => listeners.forEach((fn) => fn());

const standalone = () =>
  typeof window !== "undefined" &&
  (window.matchMedia?.("(display-mode: standalone)").matches || window.navigator.standalone === true);

export const isIos = () =>
  typeof navigator !== "undefined" &&
  (/iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1));

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferred = event;
    emit();
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    installed = true;
    emit();
  });
  if (import.meta.env.PROD && !DEMO_PACK && "serviceWorker" in navigator) {
    window.addEventListener("load", () => navigator.serviceWorker.register("/app-sw.js").catch(() => {}));
  }
}

let snap = null;
function snapshot() {
  const next = { canPrompt: Boolean(deferred), installed: installed || standalone(), ios: isIos() };
  if (!snap || snap.canPrompt !== next.canPrompt || snap.installed !== next.installed || snap.ios !== next.ios) snap = next;
  return snap;
}

export const installStore = {
  get: snapshot,
  subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  /* Returns a message for the notice line, or "" when the browser's own dialog took over. */
  async install() {
    const s = snapshot();
    if (s.installed) return "NeuroNexus is already installed as an app on this device.";
    if (deferred) {
      const event = deferred;
      deferred = null;
      emit();
      await event.prompt();
      const choice = await event.userChoice.catch(() => null);
      return choice?.outcome === "accepted" ? "" : "Install dismissed. INSTALL APP stays in the menu.";
    }
    if (s.ios) return "On iPhone or iPad: tap Share, then Add to Home Screen.";
    return "Use the browser menu: Install app (Chrome, Edge) or Add to Dock (Safari on macOS).";
  },
};

export const useInstall = () => useSyncExternalStore(installStore.subscribe, installStore.get, installStore.get);
