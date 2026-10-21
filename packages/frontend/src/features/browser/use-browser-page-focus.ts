import { type FocusEvent, useCallback, useEffect, useState } from "react";
import { useBrowserRuntime } from "./browser-runtime";

type PageSlotProps = {
  role?: "group";
  "aria-label"?: string;
  tabIndex?: number;
  onFocus?: (event: FocusEvent<HTMLElement>) => void;
};

const NO_SLOT_PROPS: PageSlotProps = {};

/**
 * The keyboard route of a web runner page. Its iframe lives in the browser layer, outside the tab
 * view, so its slot is the keyboard entry: Tab reaches the slot after the toolbar, and the slot
 * passes the focus into the page. F6 in the page increases `addressFocusRequests`, which moves the
 * focus to the address bar, and F6 in the address bar calls `onFocusPage`.
 */
export const useBrowserPageFocus = (tabId: string, showsPage: boolean) => {
  const { surface, focus } = useBrowserRuntime();
  const [addressFocusRequests, setAddressFocusRequests] = useState(0);
  useEffect(
    () => focus.registerAddressBar(tabId, () => setAddressFocusRequests((count) => count + 1)),
    [focus, tabId],
  );
  const focusPage = useCallback(
    () => focus.focusPage(tabId, { fromKeyboard: true }),
    [focus, tabId],
  );
  const takesFocus = surface === "frame" && showsPage;
  return {
    addressFocusRequests,
    onFocusPage: takesFocus ? focusPage : null,
    /** Moves the focus into the page after the address bar loads a typed address. */
    onAddressLoad: () => focus.focusPage(tabId, { fromKeyboard: false }),
    slotProps: takesFocus
      ? {
          role: "group" as const,
          "aria-label": "Page",
          tabIndex: 0,
          onFocus: (event: FocusEvent<HTMLElement>) => {
            if (event.target === event.currentTarget) focusPage();
          },
        }
      : NO_SLOT_PROPS,
  };
};
