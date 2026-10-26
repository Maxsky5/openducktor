import { createContext, use, useLayoutEffect } from "react";

/** Lets the full-screen connection state hide the connection banner of its screen. */
export const ConnectionStatusSlot = createContext<{ claim: () => () => void } | null>(null);

/** Hides the connection banner of the screen while the caller is mounted. */
export const useClaimConnectionStatus = (): void => {
  const slot = use(ConnectionStatusSlot);
  // A layout effect hides the banner before the first paint, so it never flashes.
  useLayoutEffect(() => slot?.claim(), [slot]);
};
