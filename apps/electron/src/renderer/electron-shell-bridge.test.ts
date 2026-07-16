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
  unsubscribeAppUpdates: ReturnType<typeof mock>;
  unsubscribe: ReturnType<typeof mock>;
} => {
  const unsubscribe = mock(() => {});
  const unsubscribeAppUpdates = mock(() => {});
  return {
    electronApi: {
      invoke: mock(async () => ({})),
      subscribe: mock(() => unsubscribe),
      appUpdates: {
        getState: mock(async () => ({ status: "idle", currentVersion: "0.4.2" })),
        check: mock(async () => ({
          accepted: true,
          state: {
            status: "upToDate",
            currentVersion: "0.4.2",
            checkedAt: "2026-07-08T22:00:00.000Z",
          },
        })),
        download: mock(async () => ({
          accepted: true,
          state: {
            status: "downloaded",
            currentVersion: "0.4.2",
            availableVersion: "0.4.3",
            progressPercent: 100,
          },
        })),
        install: mock(async () => ({
          accepted: true,
          state: {
            status: "downloaded",
            currentVersion: "0.4.2",
            availableVersion: "0.4.3",
            progressPercent: 100,
          },
        })),
        subscribe: mock(() => unsubscribeAppUpdates),
      },
      openExternalUrl: mock(async () => {}),
      resolveLocalAttachmentPreviewSrc: mock(async () => "file:///tmp/brief.md"),
    },
    unsubscribeAppUpdates,
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
    const devServerSubscription = await bridge.subscribeDevServerEvents(listener);
    const stopObservingLiveSessions = await bridge.observeAgentSessionLive(
      { repoPath: "/repo" },
      listener,
    );
    const unsubscribeTaskEvents = await bridge.subscribeTaskEvents(listener);

    expect(bridge.capabilities).toEqual({
      canOpenExternalUrls: true,
      canPreviewLocalAttachments: true,
    });
    expect(electronApi.subscribe).toHaveBeenCalledWith("openducktor://run-event", listener);
    expect(electronApi.subscribe).toHaveBeenCalledWith("openducktor://dev-server-event", listener);
    expect(electronApi.subscribe).toHaveBeenCalledWith("openducktor://task-event", listener);
    expect(electronApi.subscribe).toHaveBeenCalledWith(
      "openducktor://agent-session-live-event",
      expect.any(Function),
    );
    expect(electronApi.invoke).toHaveBeenCalledWith("agent_session_live_refresh", {
      repoPath: "/repo",
    });

    unsubscribeRunEvents();
    expect(devServerSubscription.transportEpoch).toMatch(/^electron:\d+$/);
    devServerSubscription.unsubscribe();
    stopObservingLiveSessions();
    unsubscribeTaskEvents();
    expect(unsubscribeSpy).toHaveBeenCalledTimes(4);
  });

  test("uses the preload bridge for app update state and actions", async () => {
    const { electronApi, unsubscribeAppUpdates } = createElectronApi();
    setElectronApi(electronApi);

    const bridge = createElectronShellBridge();
    const listener = mock(() => {});
    const unsubscribe = await bridge.appUpdates.subscribeState(listener);

    await expect(bridge.appUpdates.getState()).resolves.toEqual({
      status: "idle",
      currentVersion: "0.4.2",
    });
    await bridge.appUpdates.check({ initiator: "settings" });
    await bridge.appUpdates.download();
    await bridge.appUpdates.install();
    const appUpdateListener = (electronApi.appUpdates.subscribe as ReturnType<typeof mock>).mock
      .calls[0]?.[0];
    appUpdateListener?.({
      status: "available",
      currentVersion: "0.4.2",
      availableVersion: "0.4.3",
      checkedAt: "2026-07-08T22:00:00.000Z",
    });
    unsubscribe();

    expect(electronApi.appUpdates.subscribe).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith({
      status: "available",
      currentVersion: "0.4.2",
      availableVersion: "0.4.3",
      checkedAt: "2026-07-08T22:00:00.000Z",
    });
    expect(electronApi.appUpdates.check).toHaveBeenCalledWith({ initiator: "settings" });
    expect(electronApi.appUpdates.download).toHaveBeenCalled();
    expect(electronApi.appUpdates.install).toHaveBeenCalled();
    expect(unsubscribeAppUpdates).toHaveBeenCalled();
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
