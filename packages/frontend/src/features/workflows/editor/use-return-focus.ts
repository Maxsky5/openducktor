import { useLayoutEffect, useRef } from "react";

/**
 * Gives the focus back when the details close. The element that had the focus when the details
 * opened, such as a list row or a state box, takes it again, so the next Tab does not start at the
 * top of the app. When that element is gone, such as a deleted state, its panel takes the focus.
 * A focus that moved elsewhere stays where it is.
 *
 * A layout effect reads the opener before the details move the focus into a field.
 */
export const useReturnFocus = (selectionKey: string | null): void => {
  const opener = useRef<{ element: HTMLElement; panel: HTMLElement | null } | null>(null);
  const previous = useRef(selectionKey);
  useLayoutEffect(() => {
    const was = previous.current;
    previous.current = selectionKey;
    if (was === null && selectionKey !== null) {
      const active = document.activeElement;
      // A row that closed with its panel leaves the focus on the body: the canvas takes it back.
      opener.current =
        active instanceof HTMLElement && active !== document.body
          ? { element: active, panel: active.closest<HTMLElement>("[data-focus-panel]") }
          : null;
      return;
    }
    if (was === null || selectionKey !== null) return;
    const target = opener.current;
    opener.current = null;
    // The details unmount in this commit, so the lost focus shows on the next frame.
    const frame = requestAnimationFrame(() => {
      const active = document.activeElement;
      if (active !== null && active !== document.body && active.isConnected) return;
      if (target?.element.isConnected) target.element.focus({ preventScroll: true });
      else
        (target?.panel?.isConnected
          ? target.panel
          : document.querySelector<HTMLElement>("[data-focus-panel]")
        )?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [selectionKey]);
};
