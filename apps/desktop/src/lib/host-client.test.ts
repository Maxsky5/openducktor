import { beforeEach, describe, expect, mock, test } from "bun:test";

let browserAppMode = false;
let tauriRuntime = false;

mock.module("@openducktor/adapters-tauri-host", () => ({
  createTauriHostClient: () => ({}) as object,
}));

mock.module("@/lib/browser-live-client", () => ({
  createBrowserLiveHostClient: () => ({}) as object,
  subscribeBrowserLiveRunEvents: async () => () => {},
}));

mock.module("@/lib/browser-mode", () => ({
  isBrowserAppMode: () => browserAppMode,
}));

mock.module("@/lib/runtime", () => ({
  isTauriRuntime: () => tauriRuntime,
}));

describe("host-client", () => {
  beforeEach(() => {
    browserAppMode = false;
    tauriRuntime = false;
  });

  test("warns when run-event subscriptions are unavailable in the current runtime", async () => {
    const warnCalls: unknown[][] = [];
    const originalWarn = console.warn;
    console.warn = (...args: unknown[]) => {
      warnCalls.push(args);
    };

    try {
      const { createHostBridge } = await import("./host-client");
      const unsubscribe = await createHostBridge().subscribeRunEvents(() => {});

      expect(typeof unsubscribe).toBe("function");
      expect(warnCalls).toEqual([
        ["run-event subscriptions not available in this runtime, returning no-op"],
      ]);
    } finally {
      console.warn = originalWarn;
    }
  });
});
