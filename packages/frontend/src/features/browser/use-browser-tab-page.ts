import { type ReactNode, useLayoutEffect, useState } from "react";
import { useBrowserRuntime } from "./browser-runtime";
import { browserSurfaceKey } from "./browser-surface-registry";
import { useBrowserPageFocus } from "./use-browser-page-focus";

/** Registers the panel slot where the browser layer places the page surface of a tab. */
export const useBrowserSlot = (
  key: string,
  element: HTMLElement | null,
  visible: boolean,
): void => {
  const { slots } = useBrowserRuntime();
  useLayoutEffect(() => {
    if (element === null) return;
    return slots.register(key, { element, visible });
  }, [element, key, slots, visible]);
};

/**
 * The page slot of a tab view, and the toolbar props that move the keyboard focus between the
 * address bar and the page. The page shows while the tab shows and no view replaces it.
 */
export const useBrowserTabPage = ({
  tabId,
  isShown,
  addressFocusRequest,
  replacement,
}: {
  tabId: string;
  isShown: boolean;
  addressFocusRequest: number;
  replacement: ReactNode;
}) => {
  const surfaceKey = browserSurfaceKey(tabId);
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  const showsPage = isShown && replacement === null;
  useBrowserSlot(surfaceKey, slot, showsPage);
  const pageFocus = useBrowserPageFocus(tabId, showsPage);
  return {
    toolbar: {
      addressFocusRequest: addressFocusRequest + pageFocus.addressFocusRequests,
      onFocusPage: pageFocus.onFocusPage,
      onAddressLoad: pageFocus.onAddressLoad,
    },
    slotProps: { ref: setSlot, "data-browser-slot": surfaceKey, ...pageFocus.slotProps },
  };
};
