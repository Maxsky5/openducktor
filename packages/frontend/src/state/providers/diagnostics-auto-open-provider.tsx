import { createContext, type PropsWithChildren, type ReactElement, use, useState } from "react";
import {
  createDiagnosticsAutoOpenOwner,
  type DiagnosticsAutoOpenOwner,
} from "@/state/diagnostics/diagnostics-auto-open";

const DiagnosticsAutoOpenContext = createContext<DiagnosticsAutoOpenOwner | null>(null);

/** Shares one automatic-opening owner with every diagnostics trigger in the app session. */
export function DiagnosticsAutoOpenProvider({ children }: PropsWithChildren): ReactElement {
  const [owner] = useState(createDiagnosticsAutoOpenOwner);
  return (
    <DiagnosticsAutoOpenContext.Provider value={owner}>
      {children}
    </DiagnosticsAutoOpenContext.Provider>
  );
}

export const useDiagnosticsAutoOpenOwner = (): DiagnosticsAutoOpenOwner => {
  const owner = use(DiagnosticsAutoOpenContext);
  if (!owner) {
    throw new Error("useDiagnosticsAutoOpenOwner must be used inside AppStateProvider");
  }
  return owner;
};
