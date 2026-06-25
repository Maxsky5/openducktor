import { afterEach, describe, expect, mock, test } from "bun:test";
import { ElectronValidationError } from "../effect/electron-errors";
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

    const error = (() => {
      try {
        createElectronShellBridge();
      } catch (caught) {
        return caught;
      }
      throw new Error("Expected createElectronShellBridge to fail.");
    })();

    expect(error).toBeInstanceOf(ElectronValidationError);
    expect(error).toMatchObject({
      _tag: "ElectronValidationError",
      operation: "electron.renderer.get-preload-bridge",
    });
    expect((error as Error).message).toContain(
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
