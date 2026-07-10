import { describe, expect, mock, test } from "bun:test";
import {
  type AppUpdateState,
  canDownloadAppUpdate,
  canInstallAppUpdate,
} from "@openducktor/contracts";
import { ElectronLifecycleError } from "../../effect/electron-errors";
import {
  createElectronAppUpdateService,
  DEFAULT_APP_UPDATE_BACKGROUND_CHECK_INTERVAL_MS,
  type ElectronAppUpdaterAdapter,
  type ElectronUpdaterCheckResult,
  type ElectronUpdaterConfigureOptions,
  type ElectronUpdaterEventMap,
} from "./electron-app-update-service";

class FakeUpdaterAdapter implements ElectronAppUpdaterAdapter {
  checkCalls = 0;
  configureError: unknown = null;
  configureOptions: ElectronUpdaterConfigureOptions | null = null;
  downloadCalls = 0;
  installCalls: Array<{ isForceRunAfter: boolean | undefined; isSilent: boolean | undefined }> = [];
  nativeInstallListeners = 0;
  nativeQuitAndInstallCalls = 0;
  onDownload: (() => void | Promise<void>) | null = null;
  nextCheckResult: ElectronUpdaterCheckResult | null | Promise<ElectronUpdaterCheckResult | null> =
    {
      isUpdateAvailable: false,
      updateInfo: { version: "0.4.2" },
    };
  nextDownloadResult: Promise<readonly string[]> = Promise.resolve(["/tmp/OpenDucktor.dmg"]);

  private readonly listeners = new Map<string, Set<(payload: unknown) => void>>();

  async checkForUpdates() {
    this.checkCalls += 1;
    return this.nextCheckResult;
  }

  configure(options: ElectronUpdaterConfigureOptions): void {
    if (this.configureError) {
      throw this.configureError;
    }
    this.configureOptions = options;
  }

  async downloadUpdate(): Promise<readonly string[]> {
    this.downloadCalls += 1;
    await this.onDownload?.();
    return this.nextDownloadResult;
  }

  emit<EventName extends keyof ElectronUpdaterEventMap>(
    eventName: EventName,
    payload: ElectronUpdaterEventMap[EventName],
  ): void {
    for (const listener of this.listeners.get(eventName) ?? []) {
      listener(payload);
    }
  }

  on<EventName extends keyof ElectronUpdaterEventMap>(
    eventName: EventName,
    listener: (payload: ElectronUpdaterEventMap[EventName]) => void,
  ): () => void {
    const listeners = this.listeners.get(eventName) ?? new Set<(payload: unknown) => void>();
    listeners.add(listener as (payload: unknown) => void);
    this.listeners.set(eventName, listeners);
    return () => {
      listeners.delete(listener as (payload: unknown) => void);
    };
  }

  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void {
    this.installCalls.push({ isSilent, isForceRunAfter });
    this.nativeInstallListeners += 1;
  }

  emitNativeUpdateDownloaded(): void {
    this.nativeQuitAndInstallCalls += this.nativeInstallListeners;
  }
}

const fixedNow = "2026-07-08T22:00:00.000Z";

type FakeScheduledInterval = {
  callback: () => void;
  cleared: boolean;
  intervalMs: number;
};

const flushAsyncWork = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
};

const createFakeScheduler = () => {
  const intervals: FakeScheduledInterval[] = [];
  const scheduler = {
    setInterval(callback: () => void, intervalMs: number): FakeScheduledInterval {
      const interval = { callback, cleared: false, intervalMs };
      intervals.push(interval);
      return interval;
    },
    clearInterval(handle: unknown): void {
      (handle as FakeScheduledInterval).cleared = true;
    },
  };

  return {
    intervals,
    runInterval: async (index = 0) => {
      const interval = intervals[index];
      if (!interval || interval.cleared) {
        return;
      }
      interval.callback();
      await flushAsyncWork();
    },
    scheduler,
  };
};

const createMissingManifestError = (): Error & { code: string } =>
  Object.assign(
    new Error(`Cannot find latest-mac.yml in the latest release artifacts (https://github.com/Maxsky5/openducktor/releases/download/v0.4.3/latest-mac.yml): HttpError: 404 "method: GET url: https://github.com/Maxsky5/openducktor/releases/download/v0.4.3/latest-mac.yml

Please double check that your authentication token is correct. Due to security reasons, actual status maybe not reported, but 404.
"
Headers: {"content-security-policy":"default-src 'none'","x-github-request-id":"4BDD:2F6204:154326FB:1101F3BB:6A501D61"}
    at createHttpError
    at ElectronHttpExecutor.handleResponse
    at ClientRequest.<anonymous>`),
    { code: "ERR_UPDATER_CHANNEL_FILE_NOT_FOUND" },
  );

const createService = (
  overrides: Partial<Parameters<typeof createElectronAppUpdateService>[0]> & {
    adapter?: FakeUpdaterAdapter;
  } = {},
) => {
  const adapter = overrides.adapter ?? new FakeUpdaterAdapter();
  const installDownloadedUpdate =
    overrides.installDownloadedUpdate ??
    (async (runInstall) => {
      runInstall();
    });
  const service = createElectronAppUpdateService({
    adapter,
    currentVersion: "0.4.2",
    installDownloadedUpdate,
    isPackaged: true,
    logger: {
      error: mock(() => {}),
      info: mock(() => {}),
      warn: mock(() => {}),
    },
    now: () => fixedNow,
    platform: "darwin",
    readUpdateConfig: () => "provider: github\n",
    resourcesPath: "/Applications/OpenDucktor.app/Contents/Resources",
    ...overrides,
  });
  return { adapter, service };
};

describe("electron app update service", () => {
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
      readUpdateConfig: () => null,
    });

    expect(service.getState()).toMatchObject({
      status: "disabled",
      disabledCode: "missing_update_config",
    });

    const result = await service.check({ initiator: "menu" });

    expect(result.accepted).toBe(false);
    expect(result.state).toMatchObject({
      status: "disabled",
      checkInitiator: "menu",
      checkedAt: fixedNow,
    });
    expect(adapter.checkCalls).toBe(0);
  });

  test("does not accept commented update provider config as configured", () => {
    const { adapter, service } = createService({
      readUpdateConfig: () => "# provider: github\n",
    });

    expect(service.getState()).toMatchObject({
      status: "disabled",
      disabledCode: "missing_update_config",
    });
    expect(adapter.configureOptions).toBeNull();
  });

  test("reports malformed update provider config as an initialization error", () => {
    const { adapter, service } = createService({
      readUpdateConfig: () => "provider: [\n",
    });

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
          readUpdateConfig: () => {
            throw new Error("config unreadable");
          },
        },
        expectedMessage: "Failed to read Electron update configuration",
      },
      {
        configureService: {
          readUpdateConfig: () => "provider: [\n",
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

  test("configures the updater for explicit download and install control", () => {
    const { adapter, service } = createService();

    expect(service.getState()).toEqual({ status: "idle", currentVersion: "0.4.2" });
    expect(adapter.configureOptions).toMatchObject({
      autoDownload: false,
      autoInstallOnAppQuit: false,
    });
  });

  test("starts background checks immediately and repeats hourly", async () => {
    const fakeScheduler = createFakeScheduler();
    const { adapter, service } = createService({
      scheduler: fakeScheduler.scheduler,
    });

    service.startBackgroundChecks();
    await flushAsyncWork();

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

  test("does not register duplicate background check intervals", async () => {
    const fakeScheduler = createFakeScheduler();
    const { adapter, service } = createService({
      scheduler: fakeScheduler.scheduler,
    });

    service.startBackgroundChecks();
    service.startBackgroundChecks();
    await flushAsyncWork();

    expect(adapter.checkCalls).toBe(1);
    expect(fakeScheduler.intervals).toHaveLength(1);
  });

  test("clears scheduled background checks on dispose", async () => {
    const fakeScheduler = createFakeScheduler();
    const { adapter, service } = createService({
      scheduler: fakeScheduler.scheduler,
    });

    service.startBackgroundChecks();
    await flushAsyncWork();
    service.dispose();
    await fakeScheduler.runInterval();

    expect(fakeScheduler.intervals[0]?.cleared).toBe(true);
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

  test("promotes an active background check when the menu requests a manual check", async () => {
    const adapter = new FakeUpdaterAdapter();
    let resolveCheck: (result: ElectronUpdaterCheckResult) => void = () => {};
    adapter.nextCheckResult = new Promise<ElectronUpdaterCheckResult>((resolve) => {
      resolveCheck = resolve;
    });
    const { service } = createService({ adapter });
    const states: AppUpdateState[] = [];
    service.subscribe((state) => states.push(state));

    service.startBackgroundChecks();
    await Promise.resolve();
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

  test("treats a null update check result as an actionable error", async () => {
    const adapter = new FakeUpdaterAdapter();
    adapter.nextCheckResult = null as unknown as FakeUpdaterAdapter["nextCheckResult"];
    const { service } = createService({ adapter });

    const result = await service.check({ initiator: "menu" });

    expect(result).toMatchObject({
      accepted: true,
      state: {
        status: "error",
        checkedAt: fixedNow,
        error: {
          code: "updater_unavailable",
          operation: "check",
        },
      },
    });
  });

  test("treats an undefined update check result as an actionable error", async () => {
    const adapter = new FakeUpdaterAdapter();
    adapter.nextCheckResult = undefined as unknown as FakeUpdaterAdapter["nextCheckResult"];
    const { service } = createService({ adapter });

    const result = await service.check({ initiator: "settings" });

    expect(result).toMatchObject({
      accepted: true,
      state: {
        status: "error",
        checkedAt: fixedNow,
        error: {
          code: "updater_unavailable",
          operation: "check",
        },
      },
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

  test("sanitizes updater error events before publishing them to renderers", () => {
    const adapter = new FakeUpdaterAdapter();
    const { service } = createService({ adapter });

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

    adapter.nextCheckResult = null as unknown as FakeUpdaterAdapter["nextCheckResult"];
    const result = await service.check({ initiator: "menu" });

    expect(result).toMatchObject({
      accepted: true,
      state: {
        status: "error",
        availableVersion: "0.4.3",
        checkInitiator: "menu",
        checkedAt: fixedNow,
        error: {
          code: "updater_unavailable",
          operation: "check",
        },
      },
    });

    adapter.nextDownloadResult = Promise.resolve(["/tmp/OpenDucktor.dmg"]);
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

  test("ignores downloaded events unless a download is active", async () => {
    const adapter = new FakeUpdaterAdapter();
    adapter.nextCheckResult = {
      isUpdateAvailable: true,
      updateInfo: { version: "0.4.3" },
    };
    const { service } = createService({ adapter });
    await service.check({ initiator: "settings" });

    adapter.emit("update-downloaded", { version: "0.4.3" });

    expect(service.getState()).toMatchObject({
      status: "available",
      availableVersion: "0.4.3",
    });
  });

  test("downloads only after explicit action and reflects progress", async () => {
    const adapter = new FakeUpdaterAdapter();
    adapter.nextCheckResult = {
      isUpdateAvailable: true,
      updateInfo: { version: "0.4.3" },
    };
    adapter.onDownload = () => {
      adapter.emit("download-progress", { percent: 48 });
      adapter.emit("update-downloaded", { version: "0.4.3" });
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

    adapter.nextDownloadResult = Promise.resolve(["/tmp/OpenDucktor.dmg"]);
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

  test("install coordinates shutdown before invoking the updater install path", async () => {
    const adapter = new FakeUpdaterAdapter();
    adapter.nextCheckResult = {
      isUpdateAvailable: true,
      updateInfo: { version: "0.4.3" },
    };
    const order: string[] = [];
    const { service } = createService({
      adapter,
      installDownloadedUpdate: async (runInstall) => {
        order.push("shutdown");
        runInstall();
        order.push("after-install-call");
      },
    });
    await service.check({ initiator: "settings" });
    await service.download();

    const result = await service.install();

    expect(result.accepted).toBe(true);
    expect(order).toEqual(["shutdown", "after-install-call"]);
    expect(adapter.installCalls).toEqual([{ isSilent: false, isForceRunAfter: true }]);
  });

  test("publishes install requested before shutdown completes and rejects duplicate surfaces", async () => {
    const adapter = new FakeUpdaterAdapter();
    adapter.nextCheckResult = {
      isUpdateAvailable: true,
      updateInfo: { version: "0.4.3" },
    };
    let finishShutdown: () => void = () => {};
    const { service } = createService({
      adapter,
      installDownloadedUpdate: async (runInstall) => {
        await new Promise<void>((resolve) => {
          finishShutdown = resolve;
        });
        runInstall();
      },
    });
    await service.check({ initiator: "settings" });
    await service.download();
    const promptStates: AppUpdateState[] = [];
    const settingsStates: AppUpdateState[] = [];
    service.subscribe((state) => promptStates.push(state));
    service.subscribe((state) => settingsStates.push(state));

    const installResultPromise = service.install();
    await Promise.resolve();
    const duplicateResult = await service.install();

    expect(service.getState()).toMatchObject({
      status: "downloaded",
      availableVersion: "0.4.3",
      installRequested: true,
    });
    expect(canInstallAppUpdate(service.getState())).toBe(false);
    expect(promptStates.at(-1)).toMatchObject({ installRequested: true });
    expect(settingsStates.at(-1)).toMatchObject({ installRequested: true });
    expect(duplicateResult).toMatchObject({
      accepted: false,
      rejection: {
        code: "busy",
        operation: "install",
      },
      state: {
        status: "downloaded",
        installRequested: true,
      },
    });

    finishShutdown();
    await installResultPromise;

    expect(adapter.installCalls).toHaveLength(1);
  });

  test("blocks checks after install handoff starts while the app remains running", async () => {
    const adapter = new FakeUpdaterAdapter();
    adapter.nextCheckResult = {
      isUpdateAvailable: true,
      updateInfo: { version: "0.4.3" },
    };
    const { service } = createService({ adapter });
    await service.check({ initiator: "settings" });
    await service.download();
    await service.install();

    expect(service.getState()).toMatchObject({
      status: "downloaded",
      availableVersion: "0.4.3",
      installRequested: true,
    });

    adapter.nextCheckResult = {
      isUpdateAvailable: true,
      updateInfo: { version: "0.4.4" },
    };

    const checkResult = await service.check({ initiator: "settings" });

    expect(checkResult).toMatchObject({
      accepted: false,
      rejection: {
        code: "busy",
        operation: "check",
      },
      state: {
        status: "downloaded",
        availableVersion: "0.4.3",
        installRequested: true,
      },
    });
    expect(adapter.checkCalls).toBe(1);

    adapter.emit("error", new Error("native install failed"));

    expect(service.getState()).toMatchObject({
      status: "downloaded",
      availableVersion: "0.4.3",
      installRetryDisabled: true,
      error: {
        code: "install_failed",
        operation: "install",
      },
    });
  });

  test("treats delayed macOS updater handoff errors as terminal for the process", async () => {
    const adapter = new FakeUpdaterAdapter();
    adapter.nextCheckResult = {
      isUpdateAvailable: true,
      updateInfo: { version: "0.4.3" },
    };
    const { service } = createService({ adapter });
    await service.check({ initiator: "settings" });
    await service.download();

    const firstResult = await service.install();
    const duplicateResult = await service.install();

    expect(firstResult).toMatchObject({
      accepted: true,
      state: {
        status: "downloaded",
        availableVersion: "0.4.3",
        installRequested: true,
      },
    });
    expect(duplicateResult).toMatchObject({
      accepted: false,
      rejection: {
        code: "invalid_state",
        operation: "install",
      },
    });
    expect(adapter.installCalls).toHaveLength(1);

    adapter.emit("error", new Error("native install failed"));

    expect(service.getState()).toMatchObject({
      status: "downloaded",
      availableVersion: "0.4.3",
      installRetryDisabled: true,
      error: {
        code: "install_failed",
        message: "native install failed Quit and reopen OpenDucktor before trying again.",
        operation: "install",
      },
    });
    expect(canInstallAppUpdate(service.getState())).toBe(false);

    const retryResult = await service.install();

    expect(retryResult).toMatchObject({
      accepted: false,
      rejection: {
        code: "invalid_state",
        operation: "install",
      },
    });
    expect(adapter.installCalls).toHaveLength(1);
    expect(adapter.nativeInstallListeners).toBe(1);

    adapter.emitNativeUpdateDownloaded();

    expect(adapter.nativeQuitAndInstallCalls).toBe(1);
  });

  test("keeps macOS relaunch-required install state stable after later updater errors", async () => {
    const adapter = new FakeUpdaterAdapter();
    adapter.nextCheckResult = {
      isUpdateAvailable: true,
      updateInfo: { version: "0.4.3" },
    };
    const { service } = createService({ adapter });
    await service.check({ initiator: "settings" });
    await service.download();
    await service.install();

    adapter.emit("error", new Error("native install failed"));
    adapter.emit("error", new Error("native install still failed"));

    expect(service.getState()).toMatchObject({
      status: "downloaded",
      availableVersion: "0.4.3",
      installRetryDisabled: true,
      error: {
        code: "install_failed",
        message: "native install still failed Quit and reopen OpenDucktor before trying again.",
        operation: "install",
      },
    });
    expect(canInstallAppUpdate(service.getState())).toBe(false);
    expect(canDownloadAppUpdate(service.getState())).toBe(false);
  });

  test("host shutdown failures disable same-process install retry", async () => {
    const adapter = new FakeUpdaterAdapter();
    adapter.nextCheckResult = {
      isUpdateAvailable: true,
      updateInfo: { version: "0.4.3" },
    };
    const { service } = createService({
      adapter,
      installDownloadedUpdate: async () => {
        throw new ElectronLifecycleError({
          operation: "electron.main.shutdown-host-before-run",
          message: "OpenDucktor host shutdown failed before the requested shutdown action.",
          reason: "app-update-install",
        });
      },
    });
    await service.check({ initiator: "settings" });
    await service.download();

    const result = await service.install();

    expect(result).toMatchObject({
      accepted: true,
      state: {
        status: "downloaded",
        availableVersion: "0.4.3",
        installRetryDisabled: true,
        error: {
          code: "install_failed",
          message:
            "OpenDucktor host shutdown failed before the requested shutdown action. Quit and reopen OpenDucktor before trying again.",
          operation: "install",
        },
      },
    });
    expect(canInstallAppUpdate(result.state)).toBe(false);

    const retryResult = await service.install();

    expect(retryResult).toMatchObject({
      accepted: false,
      rejection: {
        code: "invalid_state",
        operation: "install",
      },
      state: {
        status: "downloaded",
        installRetryDisabled: true,
      },
    });
    expect(adapter.installCalls).toEqual([]);
  });

  test("non-mac updater handoff errors keep downloaded state retryable", async () => {
    const adapter = new FakeUpdaterAdapter();
    adapter.nextCheckResult = {
      isUpdateAvailable: true,
      updateInfo: { version: "0.4.3" },
    };
    const { service } = createService({ adapter, platform: "win32" });
    await service.check({ initiator: "settings" });
    await service.download();

    await service.install();
    adapter.emit("error", new Error("native install failed"));

    expect(service.getState()).toMatchObject({
      status: "downloaded",
      availableVersion: "0.4.3",
      error: {
        code: "install_failed",
        message: "native install failed",
        operation: "install",
      },
    });
    expect(canInstallAppUpdate(service.getState())).toBe(true);

    const retryResult = await service.install();

    expect(retryResult.accepted).toBe(true);
    expect(adapter.installCalls).toHaveLength(2);
  });
});
