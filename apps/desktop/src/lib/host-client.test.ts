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

  test("fails fast when run-event subscriptions are unavailable in the current runtime", async () => {
    const { createHostBridge } = await import("./host-client");

    await expect(createHostBridge().subscribeRunEvents(() => {})).rejects.toThrow(
      "Run-event subscriptions require the desktop shell or browser live mode.",
    );
  });
});
