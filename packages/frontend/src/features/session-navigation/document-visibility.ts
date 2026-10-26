import type { AppVisibility } from "@openducktor/frontend-core/platform/app-visibility";

/** The visibility of the browser or Electron document. */
export const documentVisibility: AppVisibility = {
  isHidden: () => document.visibilityState === "hidden",
  subscribe: (onChange) => {
    document.addEventListener("visibilitychange", onChange);
    return () => document.removeEventListener("visibilitychange", onChange);
  },
};
