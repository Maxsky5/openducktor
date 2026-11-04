import { createContext, useContext, useEffectEvent, useLayoutEffect } from "react";

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
 * Runs `onHide` when the session view leaves the screen or the content unmounts. Content stays
 * mounted with its kept view, so a component that keeps a dialog open in its own state closes it
 * here. A hidden `SessionViewShownActivity` destroys layout effects before the next paint, so the
 * hide runs in the cleanup of the shown layout effect.
 */
export function useOnSessionViewHide(onHide: () => void): void {
  const isShown = useSessionViewShown();
  const hide = useEffectEvent(onHide);
  useLayoutEffect(() => {
    if (!isShown) return;
    return () => hide();
  }, [isShown]);
}
