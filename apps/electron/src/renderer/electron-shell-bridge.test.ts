import { afterEach, describe, expect, mock, test } from "bun:test";
import type { OpenDucktorElectronApi } from "../shared/electron-bridge-contract";
import { createElectronShellBridge } from "./electron-shell-bridge";

const originalWindow = globalThis.window;

const setElectronApi = (electronApi: OpenDucktorElectronApi | undefined): void => {
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { openducktorElectron: electronApi },
  });
};

const createElectronApi = (): OpenDucktorElectronApi => ({
  invoke: mock(async () => ({})),
  subscribe: mock(() => () => {}),
  openExternalUrl: mock(async () => {}),
  resolveLocalAttachmentPreviewSrc: mock(async () => "file:///tmp/brief.md"),
});

describe("electron shell bridge", () => {
  afterEach(() => {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: originalWindow,
    });
  });

  test("fails fast when the preload bridge was not installed", () => {
    setElectronApi(undefined);

    expect(() => createElectronShellBridge()).toThrow(
      "OpenDucktor Electron preload bridge is unavailable.",
    );
  });

  test("uses the preload bridge for event subscriptions and shell capabilities", async () => {
    const electronApi = createElectronApi();
    setElectronApi(electronApi);

    const bridge = createElectronShellBridge();
    const listener = mock(() => {});
    const unsubscribe = await bridge.subscribeTaskEvents(listener);

    expect(bridge.capabilities).toEqual({
      canOpenExternalUrls: true,
      canPreviewLocalAttachments: true,
    });
    expect(electronApi.subscribe).toHaveBeenCalledWith("openducktor://task-event", listener);
    expect(typeof unsubscribe).toBe("function");
  });
});
