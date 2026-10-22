import type { BrowserServerMessage } from "@openducktor/contracts";
import type { EngineTab } from "./electron-browser-engine-tab";
import type { ElectronGuestHost } from "./electron-browser-guest";

/**
 * Keeps the pages that an agent or DevTools uses drawn and unthrottled. A hidden window draws no
 * frame, so the pages in it draw none either, and a screenshot of them waits. A window keeps
 * drawing while an agent acts on one of its pages.
 */
export const createElectronBrowserWake = (input: {
  tabs: ReadonlyMap<string, EngineTab>;
  notifyRenderer(hostWebContentsId: number, message: BrowserServerMessage): void;
}) => {
  const syncWindowDrawing = (host: ElectronGuestHost): void => {
    if (host.isDestroyed()) return;
    const awake = Array.from(input.tabs.values()).some(
      (tab) => tab.wakeHolds > 0 && tab.binding?.host?.id === host.id,
    );
    host.setBackgroundThrottling(!awake);
  };

  const apply = (tab: EngineTab): void => {
    const binding = tab.binding;
    if (!binding || binding.guest.isDestroyed()) return;
    const awake = tab.wakeHolds > 0;
    binding.guest.setBackgroundThrottling(!awake);
    if (tab.surface === "panel" && binding.host !== null) {
      syncWindowDrawing(binding.host);
      input.notifyRenderer(binding.host.id, { type: "surface_wake", tabId: tab.tabId, awake });
    }
  };

  return {
    apply,
    /** Adds a hold, or removes one with a negative change. */
    change(tab: EngineTab, delta: number): void {
      const wasAwake = tab.wakeHolds > 0;
      tab.wakeHolds = Math.max(0, tab.wakeHolds + delta);
      if (wasAwake !== tab.wakeHolds > 0) apply(tab);
    },
    /** A released binding of an awake tab no longer keeps its window drawing. */
    release(tab: EngineTab, host: ElectronGuestHost | null): void {
      if (tab.wakeHolds > 0 && host !== null) syncWindowDrawing(host);
    },
  };
};
