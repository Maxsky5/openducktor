import { describe, expect, mock, test } from "bun:test";
import type { AppUpdateState } from "@openducktor/contracts";
import {
  createElectronAppUpdateService,
  type ElectronAppUpdaterAdapter,
  type ElectronUpdaterConfigureOptions,
  type ElectronUpdaterEventMap,
} from "./electron-app-update-service";

class FakeUpdaterAdapter implements ElectronAppUpdaterAdapter {
  checkCalls = 0;
  configureOptions: ElectronUpdaterConfigureOptions | null = null;
  downloadCalls = 0;
  installCalls: Array<{ isForceRunAfter: boolean | undefined; isSilent: boolean | undefined }> = [];
  onDownload: (() => void | Promise<void>) | null = null;
  nextCheckResult = {
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
  }
}

const fixedNow = "2026-07-08T22:00:00.000Z";

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

  test("configures the updater for explicit download and install control", () => {
    const { adapter, service } = createService();

    expect(service.getState()).toEqual({ status: "idle", currentVersion: "0.4.2" });
    expect(adapter.configureOptions).toMatchObject({
      autoDownload: false,
      autoInstallOnAppQuit: false,
    });
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

  test("install failures keep downloaded state retryable with an install error", async () => {
    const adapter = new FakeUpdaterAdapter();
    adapter.nextCheckResult = {
      isUpdateAvailable: true,
      updateInfo: { version: "0.4.3" },
    };
    const { service } = createService({
      adapter,
      installDownloadedUpdate: async () => {
        throw new Error("shutdown failed");
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
        error: {
          code: "install_failed",
          message: "shutdown failed",
          operation: "install",
        },
      },
    });
    expect(adapter.installCalls).toEqual([]);
  });
});
