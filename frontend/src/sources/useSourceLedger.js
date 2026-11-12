import { useEffect, useSyncExternalStore } from "react";

import { getLedgerState, loadLedger, resolveIn, subscribe } from "./ledgerStore";

/* Loads /api/sources once per page and keeps every SourceTag in sync with it. */
export function useSourceLedger() {
  const state = useSyncExternalStore(subscribe, getLedgerState, getLedgerState);
  useEffect(() => {
    if (state.status === "idle") loadLedger();
  }, [state.status]);
  return { ...state, resolve: (id) => resolveIn(state.index, id) };
}
