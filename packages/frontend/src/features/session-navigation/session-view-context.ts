import { createContext, useContext } from "react";

/** The kept view of the content. Its content turns active after the view shows. */
export const SessionViewContext = createContext<{
  id: string;
  isActive: boolean;
} | null>(null);

/** Whether the view is on screen. Only display decisions read it, so a switch renders little. */
export const SessionViewShownContext = createContext(true);

export function useSessionViewActive(): boolean {
  return useContext(SessionViewContext)?.isActive ?? true;
}

export function useSessionViewShown(): boolean {
  return useContext(SessionViewShownContext);
}
