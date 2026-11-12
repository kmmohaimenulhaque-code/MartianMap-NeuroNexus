import { useEffect, useState, useSyncExternalStore } from "react";

import { effectiveToggles, perfStore } from "./perfStore";
import { heapInfo, startFpsMeter, workerInfo } from "./telemetry";
import { tileCache } from "./tileCache";

export function usePerfSettings() {
  const state = useSyncExternalStore(perfStore.subscribe, perfStore.get, perfStore.get);
  return { state, toggles: effectiveToggles(state) };
}

/* Samples FPS every second (rAF) and heap, worker and cache stats every 2 s while mounted. */
export function useTelemetry(active = true) {
  const [t, setT] = useState({ fps: null, heap: heapInfo(), worker: workerInfo(), cache: null });
  useEffect(() => {
    if (!active) return undefined;
    const stop = startFpsMeter((fps) => {
      perfStore.fps(fps);
      setT((prev) => ({ ...prev, fps }));
    });
    const timer = setInterval(() => {
      tileCache()
        .stats()
        .then((cache) => setT((prev) => ({ ...prev, heap: heapInfo(), worker: workerInfo(), cache })));
    }, 2000);
    return () => {
      stop();
      clearInterval(timer);
    };
  }, [active]);
  return t;
}
