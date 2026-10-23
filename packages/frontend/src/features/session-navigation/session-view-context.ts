import { createContext, useContext, useState } from "react";

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

/**
 * Counts how often the content of the view turned inactive. A key with this count gives content a
 * fresh state for each visit. Under `SessionViewShownActivity`, the fresh content renders while
 * the view is hidden, so it is ready when the view shows again.
 */
export function useSessionViewVisit(): number {
  const isActive = useSessionViewActive();
  const [visit, setVisit] = useState({ isActive, count: 0 });
  if (visit.isActive === isActive) return visit.count;
  const next = { isActive, count: visit.count + (isActive ? 0 : 1) };
  setVisit(next);
  return next.count;
}
