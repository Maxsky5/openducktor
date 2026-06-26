import { afterEach, describe, expect, mock, test } from "bun:test";
import type { OpenDucktorElectronApi } from "../shared/electron-bridge-contract";
import {
  createElectronShellBridge,
  ElectronPreloadBridgeUnavailableError,
} from "./electron-shell-bridge";

const originalWindow = globalThis.window;

const setElectronApi = (electronApi: OpenDucktorElectronApi | undefined): void => {
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { openducktorElectron: electronApi },
  });
};

const createElectronApi = (): {
  electronApi: OpenDucktorElectronApi;
  unsubscribe: ReturnType<typeof mock>;
} => {
  const unsubscribe = mock(() => {});
  return {
    electronApi: {
      invoke: mock(async () => ({})),
      subscribe: mock(() => unsubscribe),
      openExternalUrl: mock(async () => {}),
      resolveLocalAttachmentPreviewSrc: mock(async () => "file:///tmp/brief.md"),
    },
    unsubscribe,
  };
};

describe("electron shell bridge", () => {
  afterEach(() => {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: originalWindow,
    });
  });

  test("fails fast when the preload bridge was not installed", () => {
    setElectronApi(undefined);

    const error = (() => {
      try {
        createElectronShellBridge();
      } catch (caught) {
        return caught;
      }
      throw new Error("Expected createElectronShellBridge to fail.");
    })();

    expect(error).toBeInstanceOf(ElectronPreloadBridgeUnavailableError);
    expect((error as Error).message).toContain(
      "OpenDucktor Electron preload bridge is unavailable.",
    );
  });

  test("uses the preload bridge for event subscriptions and shell capabilities", async () => {
    const { electronApi, unsubscribe: unsubscribeSpy } = createElectronApi();
    setElectronApi(electronApi);

    const bridge = createElectronShellBridge();
    const listener = mock(() => {});
    const unsubscribeRunEvents = await bridge.subscribeRunEvents(listener);
    const unsubscribeDevServerEvents = await bridge.subscribeDevServerEvents(listener);
    const unsubscribeTaskEvents = await bridge.subscribeTaskEvents(listener);
    const unsubscribeCodexAppServerEvents = await bridge.subscribeCodexAppServerEvents(listener);

    expect(bridge.capabilities).toEqual({
      canOpenExternalUrls: true,
      canPreviewLocalAttachments: true,
    });
    expect(electronApi.subscribe).toHaveBeenCalledWith("openducktor://run-event", listener);
    expect(electronApi.subscribe).toHaveBeenCalledWith("openducktor://dev-server-event", listener);
    expect(electronApi.subscribe).toHaveBeenCalledWith("openducktor://task-event", listener);
    expect(electronApi.subscribe).toHaveBeenCalledWith(
      "openducktor://codex-app-server-event",
      listener,
    );

    unsubscribeRunEvents();
    unsubscribeDevServerEvents();
    unsubscribeTaskEvents();
    unsubscribeCodexAppServerEvents();
    expect(unsubscribeSpy).toHaveBeenCalledTimes(4);
  });

  test("uses the preload bridge for shell actions", async () => {
    const { electronApi } = createElectronApi();
    setElectronApi(electronApi);

    const bridge = createElectronShellBridge();
    await bridge.openExternalUrl("https://openducktor.local/docs");
    await expect(bridge.resolveLocalAttachmentPreviewSrc("brief.md")).resolves.toBe(
      "file:///tmp/brief.md",
    );

    expect(electronApi.openExternalUrl).toHaveBeenCalledWith("https://openducktor.local/docs");
    expect(electronApi.resolveLocalAttachmentPreviewSrc).toHaveBeenCalledWith("brief.md");
  });
});
