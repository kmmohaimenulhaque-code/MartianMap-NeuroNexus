import { createContext, useContext } from "react";

/* Lets any SourceTag open the Sources drawer at its ledger entry. */
export const SourcesContext = createContext({ openSources: () => {} });

export function useSourcesDrawer() {
  return useContext(SourcesContext);
}
