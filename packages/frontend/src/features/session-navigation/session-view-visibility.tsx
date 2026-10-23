import { Activity, type ReactNode, useEffect, useEffectEvent, useState } from "react";
import { useSessionViewActive, useSessionViewShown } from "./session-view-context";

/**
 * Shows its content while the session view is on screen. The content stops its effects while
 * the view is hidden. Only this component renders again when the view shows or hides.
 */
export function SessionViewShownActivity({ children }: { children: ReactNode }): ReactNode {
  return <Activity mode={useSessionViewShown() ? "visible" : "hidden"}>{children}</Activity>;
}

/** Dialog portals sit outside the hidden view, so they leave as soon as the view hides. */
export function WhileSessionViewShown({ children }: { children: ReactNode }): ReactNode {
  return useSessionViewShown() ? children : null;
}

/** Runs `onHide` when the session view leaves the screen, so its dialogs stay closed on return. */
export function OnSessionViewHide({ onHide }: { onHide: () => void }): null {
  const isShown = useSessionViewShown();
  const hide = useEffectEvent(onHide);
  useEffect(() => {
    if (!isShown) hide();
  }, [isShown]);
  return null;
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
