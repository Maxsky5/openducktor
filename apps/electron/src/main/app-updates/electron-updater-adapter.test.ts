import { describe, expect, mock, test } from "bun:test";
import type { ElectronUpdaterConfigureOptions } from "./electron-app-updater-adapter";
import { createElectronUpdaterAdapter } from "./electron-updater-adapter";
import type { GitHubReleaseSource } from "./github-release-source";

class FakeNativeUpdater {
  allowPrerelease = false;
  autoDownload = true;
  autoInstallOnAppQuit = true;
  channel: string | null = null;
  logger: ElectronUpdaterConfigureOptions["logger"] | null = null;

  checkForUpdates = mock(async () => ({
    isUpdateAvailable: true,
    updateInfo: { version: "0.5.0" },
    versionInfo: { version: "0.5.0" },
  }));
  downloadUpdate = mock(async (): Promise<string[]> => ["/tmp/OpenDucktor-update"]);
  private readonly listeners = new Map<string, Set<(payload: never) => void>>();

  on = mock((eventName: string, listener: (payload: never) => void) => {
    const listeners = this.listeners.get(eventName) ?? new Set();
    listeners.add(listener);
    this.listeners.set(eventName, listeners);
    return this;
  });
  quitAndInstall = mock(() => {});
  removeListener = mock((eventName: string, listener: (payload: never) => void) => {
    this.listeners.get(eventName)?.delete(listener);
    return this;
  });

  emit(eventName: string, payload: unknown): void {
    for (const listener of this.listeners.get(eventName) ?? []) {
      listener(payload as never);
    }
  }
}

const githubRelease = {
  prerelease: false,
  tagName: "v0.5.0",
  version: "0.5.0",
};

const createReleaseSource = (): GitHubReleaseSource => ({
  resolve: mock(async () => githubRelease),
});

const configure = (adapter: ReturnType<typeof createElectronUpdaterAdapter>): void => {
  adapter.configure({
    allowPrerelease: false,
    autoDownload: false,
    autoInstallOnAppQuit: false,
    channel: null,
    logger: {
      error: mock(() => {}),
      info: mock(() => {}),
      warn: mock(() => {}),
    },
    onLogFailure: mock(() => {}),
  });
};

describe("electron updater adapter", () => {
  test.each(["darwin", "win32", "linux"] as const)(
    "keeps electron-updater unloaded during %s background checks",
    async (platform) => {
      const nativeUpdater = new FakeNativeUpdater();
      const loadUpdater = mock(async () => nativeUpdater);
      const adapter = createElectronUpdaterAdapter({
        currentVersion: "0.4.4",
        loadUpdater,
        platform,
        releaseSource: createReleaseSource(),
      });
      configure(adapter);

      await expect(adapter.checkForUpdates()).resolves.toMatchObject({
        isUpdateAvailable: true,
        updateInfo: { version: "0.5.0" },
      });

      expect(loadUpdater).not.toHaveBeenCalled();
      expect(nativeUpdater.checkForUpdates).not.toHaveBeenCalled();
    },
  );

  test("loads the native updater only for download and applies the complete configuration", async () => {
    const nativeUpdater = new FakeNativeUpdater();
    const loadUpdater = mock(async () => nativeUpdater);
    const adapter = createElectronUpdaterAdapter({
      currentVersion: "0.4.4",
      loadUpdater,
      platform: "win32",
      releaseSource: createReleaseSource(),
    });
    const logger = {
      error: mock(() => {}),
      info: mock(() => {}),
      warn: mock(() => {}),
    };
    adapter.configure({
      allowPrerelease: true,
      autoDownload: false,
      autoInstallOnAppQuit: false,
      channel: "beta",
      logger,
      onLogFailure: mock(() => {}),
    });

    await adapter.checkForUpdates();
    expect(loadUpdater).not.toHaveBeenCalled();

    await expect(adapter.downloadUpdate()).resolves.toEqual({ version: "0.5.0" });

    expect(loadUpdater).toHaveBeenCalledTimes(1);
    expect(nativeUpdater.allowPrerelease).toBe(true);
    expect(nativeUpdater.autoDownload).toBe(false);
    expect(nativeUpdater.autoInstallOnAppQuit).toBe(false);
    expect(nativeUpdater.channel).toBe("beta");
    expect(nativeUpdater.logger).not.toBe(logger);
  });

  test("owns native updater logger promises and drains failures on disposal", async () => {
    const nativeUpdater = new FakeNativeUpdater();
    const persistenceError = new Error("openducktor.logs.append failed");
    const fatalErrors: unknown[] = [];
    const adapter = createElectronUpdaterAdapter({
      currentVersion: "0.4.4",
      loadUpdater: async () => nativeUpdater,
      platform: "win32",
      releaseSource: createReleaseSource(),
    });
    adapter.configure({
      allowPrerelease: false,
      autoDownload: false,
      autoInstallOnAppQuit: false,
      channel: null,
      logger: {
        error() {},
        info: async () => {
          throw persistenceError;
        },
        warn() {},
      },
      onLogFailure: (cause) => {
        fatalErrors.push(cause);
      },
    });

    await adapter.checkForUpdates();
    await adapter.downloadUpdate();
    nativeUpdater.logger?.info("native updater event");

    await expect(adapter.dispose()).rejects.toBe(persistenceError);
    expect(fatalErrors).toEqual([persistenceError]);
    expect(nativeUpdater.logger).toBeNull();
  });

  test("does not finish pending native updater initialization after disposal", async () => {
    const nativeUpdater = new FakeNativeUpdater();
    let finishLoading: (updater: FakeNativeUpdater) => void = () => {};
    const loadUpdater = mock(
      () =>
        new Promise<FakeNativeUpdater>((resolve) => {
          finishLoading = resolve;
        }),
    );
    const adapter = createElectronUpdaterAdapter({
      currentVersion: "0.4.4",
      loadUpdater,
      platform: "win32",
      releaseSource: createReleaseSource(),
    });
    configure(adapter);
    await adapter.checkForUpdates();

    const downloadResult = adapter.downloadUpdate();
    const settledDownload = downloadResult.then(
      () => ({ error: null }),
      (error: unknown) => ({ error }),
    );
    await adapter.dispose();
    finishLoading(nativeUpdater);

    const { error } = await settledDownload;
    expect(error).toMatchObject({ operation: "electron.updater.initialize" });
    expect(nativeUpdater.on).not.toHaveBeenCalled();
    expect(nativeUpdater.checkForUpdates).not.toHaveBeenCalled();
  });

  test("rejects download when native metadata disagrees with the GitHub release", async () => {
    const nativeUpdater = new FakeNativeUpdater();
    nativeUpdater.checkForUpdates.mockImplementation(async () => ({
      isUpdateAvailable: true,
      updateInfo: { version: "0.4.9" },
      versionInfo: { version: "0.4.9" },
    }));
    const adapter = createElectronUpdaterAdapter({
      currentVersion: "0.4.4",
      loadUpdater: async () => nativeUpdater,
      platform: "linux",
      releaseSource: createReleaseSource(),
    });
    configure(adapter);
    await adapter.checkForUpdates();

    await expect(adapter.downloadUpdate()).rejects.toMatchObject({
      operation: "electron.updater.validate-download-release",
    });
    expect(nativeUpdater.downloadUpdate).not.toHaveBeenCalled();
  });

  test("returns a prepared install handoff that owns native quitAndInstall", async () => {
    const nativeUpdater = new FakeNativeUpdater();
    const adapter = createElectronUpdaterAdapter({
      currentVersion: "0.4.4",
      loadUpdater: async () => nativeUpdater,
      platform: "win32",
      releaseSource: createReleaseSource(),
    });
    configure(adapter);
    await adapter.checkForUpdates();
    await adapter.downloadUpdate();

    const installHandoff = await adapter.prepareInstall();
    expect(nativeUpdater.quitAndInstall).not.toHaveBeenCalled();

    await installHandoff();
    expect(nativeUpdater.quitAndInstall).toHaveBeenCalledWith(false, true);
  });

  test("normalizes native progress and error events before exposing them to the service", async () => {
    const nativeUpdater = new FakeNativeUpdater();
    const adapter = createElectronUpdaterAdapter({
      currentVersion: "0.4.4",
      loadUpdater: async () => nativeUpdater,
      platform: "win32",
      releaseSource: createReleaseSource(),
    });
    const progress = mock(() => {});
    const errors = mock(() => {});
    adapter.on("download-progress", progress);
    adapter.on("error", errors);
    configure(adapter);
    await adapter.checkForUpdates();
    await adapter.downloadUpdate();

    nativeUpdater.emit("download-progress", { percent: 42.5 });
    nativeUpdater.emit("download-progress", { percent: Number.NaN });

    expect(progress).toHaveBeenCalledWith({ percent: 42.5 });
    expect(errors).toHaveBeenCalledWith(
      expect.objectContaining({ operation: "electron.updater.read-download-progress" }),
    );
  });
});
