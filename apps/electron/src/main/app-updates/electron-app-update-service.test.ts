import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { AppUpdateState } from "@openducktor/contracts";
import { Effect } from "effect";
import { runElectronEffect } from "../../effect/electron-boundary";
import { createElectronMainLogger } from "../electron-main-logger";
import { DEFAULT_APP_UPDATE_BACKGROUND_CHECK_INTERVAL_MS } from "./electron-app-update-service";
import {
  createFakeScheduler,
  createMissingManifestError,
  createService,
  FakeUpdaterAdapter,
  fixedNow,
  flushAsyncWork,
} from "./electron-app-update-service.test-support";
import type { ElectronUpdaterCheckResult } from "./electron-app-updater-adapter";

describe("electron app update service", () => {
  test("keeps packaged updater initialization off the startup call stack", async () => {
    const fakeScheduler = createFakeScheduler();
    let updateConfigReads = 0;
    const { adapter, service } = createService({
      readUpdateConfig: async () => {
        updateConfigReads += 1;
        return "provider: github\n";
      },
      scheduler: fakeScheduler.scheduler,
    });

    expect(updateConfigReads).toBe(0);
    expect(adapter.configureOptions).toBeNull();
    expect(service.getState()).toEqual({ status: "idle", currentVersion: "0.4.2" });

    service.startBackgroundChecks();

    expect(updateConfigReads).toBe(0);
    expect(adapter.configureOptions).toBeNull();

    await fakeScheduler.runTimeout();

    expect(updateConfigReads).toBe(1);
    expect(adapter.configureOptions).not.toBeNull();
    expect(adapter.checkCalls).toBe(1);
  });

  test("does not block while background updater initialization is pending", async () => {
    const fakeScheduler = createFakeScheduler();
    let resolveUpdateConfig: (config: string) => void = () => {};
    const updateConfig = new Promise<string>((resolve) => {
      resolveUpdateConfig = resolve;
    });
    const { adapter, service } = createService({
      readUpdateConfig: async () => updateConfig,
      scheduler: fakeScheduler.scheduler,
    });

    service.startBackgroundChecks();
    await fakeScheduler.runTimeout();

    expect(adapter.configureOptions).toBeNull();
    expect(adapter.checkCalls).toBe(0);
    expect(service.getState()).toMatchObject({ status: "checking" });

    resolveUpdateConfig("provider: github\n");
    await flushAsyncWork();
    await flushAsyncWork();

    expect(adapter.configureOptions).not.toBeNull();
    expect(adapter.checkCalls).toBe(1);
    expect(service.getState()).toMatchObject({ status: "upToDate" });
  });

  test("starts disabled in unpackaged builds and rejects manual checks", async () => {
    const { adapter, service } = createService({ isPackaged: false });
    const states: AppUpdateState[] = [];
    service.subscribe((state) => states.push(state));

    expect(service.getState()).toMatchObject({
      status: "disabled",
      disabledCode: "not_packaged",
      currentVersion: "0.4.2",
    });
    expect(adapter.configureOptions).toBeNull();

    const result = await service.check({ initiator: "settings" });

    expect(result).toMatchObject({
      accepted: false,
      rejection: {
        code: "not_packaged",
        operation: "check",
      },
      state: {
        status: "disabled",
        checkInitiator: "settings",
        checkedAt: fixedNow,
      },
    });
    expect(states.at(-1)).toMatchObject({
      status: "disabled",
      checkInitiator: "settings",
      checkedAt: fixedNow,
    });
    expect(adapter.checkCalls).toBe(0);
  });

  test("reports missing packaged update config as disabled instead of up-to-date", async () => {
    const { adapter, service } = createService({
      readUpdateConfig: async () => null,
    });

    expect(service.getState()).toEqual({ status: "idle", currentVersion: "0.4.2" });

    const result = await service.check({ initiator: "menu" });

    expect(result.accepted).toBe(false);
    expect(result.state).toMatchObject({
      status: "disabled",
      checkInitiator: "menu",
      checkedAt: fixedNow,
    });
    expect(adapter.checkCalls).toBe(0);
  });

  test("does not accept commented update provider config as configured", async () => {
    const { adapter, service } = createService({
      readUpdateConfig: async () => "# provider: github\n",
    });

    await service.check({ initiator: "settings" });

    expect(service.getState()).toMatchObject({
      status: "disabled",
      disabledCode: "missing_update_config",
    });
    expect(adapter.configureOptions).toBeNull();
  });

  test("reports malformed update provider config as an initialization error", async () => {
    const { adapter, service } = createService({
      readUpdateConfig: async () => "provider: [\n",
    });

    await service.check({ initiator: "settings" });

    expect(service.getState()).toMatchObject({
      status: "error",
      error: {
        code: "updater_unavailable",
        operation: "initialize",
      },
    });
    expect(service.getState().error?.message).toContain(
      "Electron update feed configuration is invalid",
    );
    expect(adapter.configureOptions).toBeNull();
  });

  test("does not run checks after initialization failures", async () => {
    const cases: Array<{
      configureAdapter?(adapter: FakeUpdaterAdapter): void;
      configureService?: Partial<Parameters<typeof createElectronAppUpdateService>[0]>;
      expectedMessage: string;
    }> = [
      {
        configureService: {
          readUpdateConfig: async () => {
            throw new Error("config unreadable");
          },
        },
        expectedMessage: "Failed to read Electron update configuration",
      },
      {
        configureService: {
          readUpdateConfig: async () => "provider: [\n",
        },
        expectedMessage: "Electron update feed configuration is invalid",
      },
      {
        configureAdapter: (adapter) => {
          adapter.configureError = new Error("configure failed");
        },
        expectedMessage: "Electron updater initialization failed",
      },
    ];

    for (const testCase of cases) {
      const adapter = new FakeUpdaterAdapter();
      testCase.configureAdapter?.(adapter);
      const { service } = createService({ adapter, ...testCase.configureService });

      service.startBackgroundChecks();
      const manualResult = await service.check({ initiator: "menu" });

      expect(adapter.checkCalls).toBe(0);
      expect(manualResult).toMatchObject({
        accepted: false,
        rejection: {
          code: "updater_unavailable",
          operation: "check",
        },
        state: {
          status: "error",
          checkInitiator: "menu",
          checkedAt: fixedNow,
          error: {
            code: "updater_unavailable",
            operation: "initialize",
          },
        },
      });
      expect(manualResult.state.error?.message).toContain(testCase.expectedMessage);
    }
  });

  test("configures the updater for explicit download and install control", async () => {
    const { adapter, service } = createService();

    await service.check({ initiator: "settings" });

    expect(adapter.configureOptions).toMatchObject({
      allowPrerelease: false,
      autoDownload: false,
      autoInstallOnAppQuit: false,
      channel: null,
    });
  });

  test("configures prerelease builds to check their update channel", async () => {
    const { adapter, service } = createService({ currentVersion: "0.4.0-beta.2" });

    await service.check({ initiator: "settings" });

    expect(adapter.configureOptions).toMatchObject({
      allowPrerelease: true,
      channel: "beta",
    });
  });

  test("defers the initial background check until after startup and repeats every twelve hours", async () => {
    const fakeScheduler = createFakeScheduler();
    const { adapter, service } = createService({
      scheduler: fakeScheduler.scheduler,
    });

    expect(DEFAULT_APP_UPDATE_BACKGROUND_CHECK_INTERVAL_MS).toBe(12 * 60 * 60 * 1000);

    service.startBackgroundChecks();

    expect(adapter.checkCalls).toBe(0);
    expect(fakeScheduler.timeouts).toEqual([
      {
        callback: expect.any(Function),
        cleared: false,
        timeoutMs: 1_000,
      },
    ]);

    await fakeScheduler.runTimeout();

    expect(adapter.checkCalls).toBe(1);
    expect(service.getState()).toMatchObject({
      status: "upToDate",
      checkInitiator: "background",
      checkedAt: fixedNow,
    });
    expect(fakeScheduler.intervals).toEqual([
      {
        callback: expect.any(Function),
        cleared: false,
        intervalMs: DEFAULT_APP_UPDATE_BACKGROUND_CHECK_INTERVAL_MS,
      },
    ]);

    await fakeScheduler.runInterval();

    expect(adapter.checkCalls).toBe(2);
  });

  test("routes background logging failures to the owning fatal boundary", async () => {
    const persistenceError = new Error("openducktor.logs.append failed");
    const fatalErrors: unknown[] = [];
    const fakeScheduler = createFakeScheduler();
    const { service } = createService({
      logger: {
        error: async () => {
          throw persistenceError;
        },
        info: async () => {
          throw persistenceError;
        },
        warn() {},
      },
      onFatalError: (cause) => {
        fatalErrors.push(cause);
      },
      scheduler: fakeScheduler.scheduler,
    });

    service.startBackgroundChecks();
    await fakeScheduler.runTimeout();
    await flushAsyncWork();

    expect(fatalErrors).toEqual([persistenceError]);
  });

  test("does not register duplicate background check intervals", async () => {
    const fakeScheduler = createFakeScheduler();
    const { adapter, service } = createService({
      scheduler: fakeScheduler.scheduler,
    });

    service.startBackgroundChecks();
    service.startBackgroundChecks();
    await fakeScheduler.runTimeout();

    expect(adapter.checkCalls).toBe(1);
    expect(fakeScheduler.intervals).toHaveLength(1);
    expect(fakeScheduler.timeouts).toHaveLength(1);
  });

  test("clears scheduled background checks on dispose", async () => {
    const fakeScheduler = createFakeScheduler();
    const { adapter, service } = createService({
      scheduler: fakeScheduler.scheduler,
    });

    service.startBackgroundChecks();
    await service.dispose();
    await fakeScheduler.runTimeout();
    await fakeScheduler.runInterval();

    expect(fakeScheduler.intervals[0]?.cleared).toBe(true);
    expect(fakeScheduler.timeouts[0]?.cleared).toBe(true);
    expect(adapter.checkCalls).toBe(0);
  });

  test("fences a pending check when disposal begins", async () => {
    const adapter = new FakeUpdaterAdapter();
    let resolveCheck: (result: ElectronUpdaterCheckResult) => void = () => {};
    adapter.nextCheckResult = new Promise((resolve) => {
      resolveCheck = resolve;
    });
    const { service } = createService({ adapter });
    const states: AppUpdateState[] = [];
    service.subscribe((state) => states.push(state));

    const checkResult = service.check({ initiator: "settings" });
    await flushAsyncWork();
    expect(adapter.checkCalls).toBe(1);

    await service.dispose();
    resolveCheck({ isUpdateAvailable: true, updateInfo: { version: "0.4.3" } });

    await expect(checkResult).resolves.toMatchObject({
      accepted: false,
      rejection: { code: "updater_unavailable", operation: "check" },
    });
    expect(states.map((state) => state.status)).toEqual(["checking"]);
    expect(adapter.disposeCalls).toBe(1);

    await expect(service.check({ initiator: "settings" })).resolves.toMatchObject({
      accepted: false,
      rejection: { code: "updater_unavailable", operation: "check" },
    });
    expect(adapter.checkCalls).toBe(1);
  });

  test("checks manually and publishes an available update state", async () => {
    const adapter = new FakeUpdaterAdapter();
    adapter.nextCheckResult = {
      isUpdateAvailable: true,
      updateInfo: { version: "0.4.3" },
    };
    const { service } = createService({ adapter });
    const states: AppUpdateState[] = [];
    service.subscribe((state) => states.push(state));

    const result = await service.check({ initiator: "settings" });

    expect(result).toMatchObject({
      accepted: true,
      state: {
        status: "available",
        currentVersion: "0.4.2",
        availableVersion: "0.4.3",
        checkInitiator: "settings",
        checkedAt: fixedNow,
      },
    });
    expect(states.map((state) => state.status)).toEqual(["checking", "available"]);
    expect(adapter.downloadCalls).toBe(0);
  });

  test("persists a real Electron update event through the main logger", async () => {
    const configDirectory = await mkdtemp(path.join(tmpdir(), "openducktor-electron-update-log-"));
    let consoleOutput = "";
    try {
      const logger = await Effect.runPromise(
        createElectronMainLogger({
          env: { NO_COLOR: "1", OPENDUCKTOR_CONFIG_DIR: configDirectory },
          now: () => new Date(2026, 6, 8, 22, 0, 0),
          stream: {
            write(chunk) {
              consoleOutput += chunk;
            },
          },
        }),
      );
      const { service } = createService({
        logger: {
          error: (message, error) => runElectronEffect(logger.error(message, error)),
          info: (message) => runElectronEffect(logger.info(message)),
          warn: (message) => runElectronEffect(logger.warn(message)),
        },
      });

      await service.check({ initiator: "settings" });
      await service.dispose();

      const persisted = await readFile(
        path.join(configDirectory, "logs", "openducktor-electron-2026-07-08.log"),
        "utf8",
      );
      expect(consoleOutput).toContain("OpenDucktor update check completed (settings)");
      expect(persisted).toContain("OpenDucktor update check completed (settings)");
    } finally {
      await rm(configDirectory, { force: true, recursive: true });
    }
  });

  test("promotes an active background check when the menu requests a manual check", async () => {
    const adapter = new FakeUpdaterAdapter();
    const fakeScheduler = createFakeScheduler();
    let resolveCheck: (result: ElectronUpdaterCheckResult) => void = () => {};
    adapter.nextCheckResult = new Promise<ElectronUpdaterCheckResult>((resolve) => {
      resolveCheck = resolve;
    });
    const { service } = createService({ adapter, scheduler: fakeScheduler.scheduler });
    const states: AppUpdateState[] = [];
    service.subscribe((state) => states.push(state));

    service.startBackgroundChecks();
    await fakeScheduler.runTimeout();
    const menuResult = await service.check({ initiator: "menu" });

    expect(menuResult).toMatchObject({
      accepted: false,
      rejection: {
        code: "busy",
        operation: "check",
      },
      state: {
        status: "checking",
        checkInitiator: "menu",
      },
    });
    expect(states.map((state) => state.status)).toEqual(["checking", "checking"]);
    expect(states.at(-1)).toMatchObject({ checkInitiator: "menu" });
    expect(adapter.checkCalls).toBe(1);

    resolveCheck({
      isUpdateAvailable: false,
      updateInfo: { version: "0.4.2" },
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(service.getState()).toMatchObject({
      status: "upToDate",
      checkInitiator: "menu",
      checkedAt: fixedNow,
    });
  });

  test("reports missing GitHub updater metadata without leaking transport internals", async () => {
    const adapter = new FakeUpdaterAdapter();
    adapter.nextCheckResult = Promise.reject(createMissingManifestError());
    const { service } = createService({ adapter });

    const result = await service.check({ initiator: "settings" });

    expect(result).toMatchObject({
      accepted: true,
      state: {
        status: "error",
        checkedAt: fixedNow,
        error: {
          code: "check_failed",
          operation: "check",
        },
      },
    });
    expect(result.state.status).toBe("error");
    if (result.state.status !== "error") return;

    expect(result.state.error.message).toBe(
      "OpenDucktor could not read latest-mac.yml for release v0.4.3. Make sure the GitHub release is published and includes the Electron updater metadata asset, then try again.",
    );
    expect(result.state.error.message).not.toContain("Headers");
    expect(result.state.error.message).not.toContain("x-github-request-id");
    expect(result.state.error.message).not.toContain("at createHttpError");
  });

  test("sanitizes updater error events before publishing them to renderers", async () => {
    const adapter = new FakeUpdaterAdapter();
    const { service } = createService({ adapter });
    await service.check({ initiator: "settings" });

    adapter.emit("error", createMissingManifestError());

    expect(service.getState().status).toBe("error");
    const state = service.getState();
    if (state.status !== "error") return;

    expect(state.error.message).toBe(
      "OpenDucktor could not read latest-mac.yml for release v0.4.3. Make sure the GitHub release is published and includes the Electron updater metadata asset, then try again.",
    );
    expect(state.error.message).not.toContain("Headers");
    expect(state.error.message).not.toContain("at ElectronHttpExecutor.handleResponse");
  });

  test("preserves an available update when a follow-up manual check fails", async () => {
    const adapter = new FakeUpdaterAdapter();
    adapter.nextCheckResult = {
      isUpdateAvailable: true,
      updateInfo: { version: "0.4.3" },
    };
    const { service } = createService({ adapter });
    await service.check({ initiator: "settings" });

    adapter.nextCheckResult = Promise.reject(new Error("GitHub update check failed"));
    const result = await service.check({ initiator: "menu" });

    expect(result).toMatchObject({
      accepted: true,
      state: {
        status: "error",
        availableVersion: "0.4.3",
        checkInitiator: "menu",
        checkedAt: fixedNow,
        error: {
          code: "check_failed",
          operation: "check",
        },
      },
    });

    adapter.nextDownloadResult = Promise.resolve({ version: "0.4.3" });
    const retryResult = await service.download();

    expect(retryResult).toMatchObject({
      accepted: true,
      state: {
        status: "downloaded",
        availableVersion: "0.4.3",
        progressPercent: 100,
      },
    });
  });

  test("rejects download before an update is available", async () => {
    const { adapter, service } = createService();

    const result = await service.download();

    expect(result).toMatchObject({
      accepted: false,
      rejection: {
        code: "invalid_state",
        operation: "download",
      },
    });
    expect(adapter.downloadCalls).toBe(0);
  });

  test("downloads only after explicit action and reflects progress", async () => {
    const adapter = new FakeUpdaterAdapter();
    adapter.nextCheckResult = {
      isUpdateAvailable: true,
      updateInfo: { version: "0.4.3" },
    };
    adapter.onDownload = () => {
      adapter.emit("download-progress", { percent: 48 });
    };
    const { service } = createService({ adapter });
    const states: AppUpdateState[] = [];
    service.subscribe((state) => states.push(state));
    await service.check({ initiator: "settings" });

    const result = await service.download();

    expect(result).toMatchObject({
      accepted: true,
      state: {
        status: "downloaded",
        availableVersion: "0.4.3",
        progressPercent: 100,
      },
    });
    expect(states.map((state) => state.status)).toEqual([
      "checking",
      "available",
      "downloading",
      "downloading",
      "downloaded",
    ]);
    expect(states.at(-2)).toMatchObject({ progressPercent: 48 });
    expect(adapter.downloadCalls).toBe(1);
  });

  test("publishes download progress at most once every 500 milliseconds", async () => {
    const adapter = new FakeUpdaterAdapter();
    const fakeScheduler = createFakeScheduler();
    let finishDownload: (() => void) | null = null;
    adapter.nextCheckResult = {
      isUpdateAvailable: true,
      updateInfo: { version: "0.4.3" },
    };
    adapter.onDownload = () =>
      new Promise<void>((resolve) => {
        finishDownload = resolve;
      });
    const { service } = createService({ adapter, scheduler: fakeScheduler.scheduler });
    const states: AppUpdateState[] = [];
    service.subscribe((state) => states.push(state));
    await service.check({ initiator: "settings" });

    const download = service.download();
    await flushAsyncWork();
    adapter.emit("download-progress", { percent: 10 });
    adapter.emit("download-progress", { percent: 20 });
    adapter.emit("download-progress", { percent: 30 });

    expect(
      states.flatMap((state) => (state.status === "downloading" ? [state.progressPercent] : [])),
    ).toEqual([0, 10]);
    expect(fakeScheduler.timeouts).toEqual([
      {
        callback: expect.any(Function),
        cleared: false,
        timeoutMs: 500,
      },
    ]);

    await fakeScheduler.runTimeout();

    expect(
      states.flatMap((state) => (state.status === "downloading" ? [state.progressPercent] : [])),
    ).toEqual([0, 10, 30]);
    adapter.emit("download-progress", { percent: 40 });
    adapter.emit("download-progress", { percent: 50 });
    expect(
      states.flatMap((state) => (state.status === "downloading" ? [state.progressPercent] : [])),
    ).toEqual([0, 10, 30]);

    if (!finishDownload) {
      throw new Error("Download did not start.");
    }
    finishDownload();
    await download;

    expect(service.getState()).toMatchObject({ status: "downloaded", progressPercent: 100 });
    expect(fakeScheduler.timeouts[1]?.cleared).toBe(true);
  });

  test("download failures preserve available version for retry", async () => {
    const adapter = new FakeUpdaterAdapter();
    adapter.nextCheckResult = {
      isUpdateAvailable: true,
      updateInfo: { version: "0.4.3" },
    };
    adapter.nextDownloadResult = Promise.reject(new Error("network unavailable"));
    const { service } = createService({ adapter });
    await service.check({ initiator: "settings" });

    const result = await service.download();

    expect(result).toMatchObject({
      accepted: true,
      state: {
        status: "error",
        availableVersion: "0.4.3",
        error: {
          code: "download_failed",
          message: "network unavailable",
          operation: "download",
        },
      },
    });

    adapter.nextDownloadResult = Promise.resolve({ version: "0.4.3" });
    const retryResult = await service.download();

    expect(retryResult).toMatchObject({
      accepted: true,
      state: {
        status: "downloaded",
        availableVersion: "0.4.3",
        progressPercent: 100,
      },
    });
    expect(adapter.downloadCalls).toBe(2);
  });
});
