import type { AppVisibility } from "@openducktor/frontend-core/platform/app-visibility";

/**
 * Reports each return to the app window. A return fires a window focus or a document visibility
 * change, and the document is visible after it.
 */
export const windowReturnVisibility: AppVisibility = {
  isHidden: () => document.visibilityState !== "visible",
  subscribe: (onChange) => {
    globalThis.addEventListener("focus", onChange);
    document.addEventListener("visibilitychange", onChange);
    return () => {
      globalThis.removeEventListener("focus", onChange);
      document.removeEventListener("visibilitychange", onChange);
    };
  },
};
