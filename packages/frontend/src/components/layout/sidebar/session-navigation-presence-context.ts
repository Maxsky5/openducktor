import { createContext, useContext } from "react";

/** Portal content must also close when a containing section leaves. */
export const SessionPresentContext = createContext(true);

export function useSessionPresent(): boolean {
  return useContext(SessionPresentContext);
}
