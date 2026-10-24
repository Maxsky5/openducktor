import { Activity, type ReactNode, useEffect, useEffectEvent } from "react";
import { useSessionViewShown } from "./session-view-context";

/**
 * Shows its content while the session view is on screen. The content stops its effects while
 * the view is hidden. Only this component renders again when the view shows or hides.
 */
export function SessionViewShownActivity({ children }: { children: ReactNode }): ReactNode {
  return <Activity mode={useSessionViewShown() ? "visible" : "hidden"}>{children}</Activity>;
}

/** Dialog portals sit outside the hidden view, so they leave as soon as the view hides. */
export function WhileSessionViewShown({ children }: { children: ReactNode }): ReactNode {
  return useSessionViewShown() ? <>{children}</> : null;
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
