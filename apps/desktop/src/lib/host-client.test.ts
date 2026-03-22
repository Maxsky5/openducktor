import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";

let browserAppMode = false;
let tauriRuntime = false;

mock.module("@openducktor/adapters-tauri-host", () => ({
  createTauriHostClient: () => ({}) as object,
}));

mock.module("@/lib/browser-mode", () => ({
  isBrowserAppMode: () => browserAppMode,
  getBrowserBackendUrl: () => "http://127.0.0.1:14327",
}));

mock.module("@/lib/runtime", () => ({
  isTauriRuntime: () => tauriRuntime,
}));

describe("host-client", () => {
  beforeEach(() => {
    browserAppMode = false;
    tauriRuntime = false;
  });

  afterAll(() => {
    mock.restore();
  });

  test("fails fast when run-event subscriptions are unavailable in the current runtime", async () => {
    const { createHostBridge } = await import("./host-client");

    await expect(createHostBridge().subscribeRunEvents(() => {})).rejects.toThrow(
      "Run-event subscriptions require the desktop shell or browser live mode.",
    );
  });

  test("fails fast when dev-server event subscriptions are unavailable in the current runtime", async () => {
    const { createHostBridge } = await import("./host-client");

    await expect(createHostBridge().subscribeDevServerEvents(() => {})).rejects.toThrow(
      "Dev-server event subscriptions require the desktop shell or browser live mode.",
    );
  });
});
