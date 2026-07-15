import { mock } from "bun:test";
import { createElectronAppUpdateService } from "./electron-app-update-service";
import type {
  ElectronAppUpdaterAdapter,
  ElectronUpdaterCheckResult,
  ElectronUpdaterConfigureOptions,
  ElectronUpdaterEventMap,
  ElectronUpdaterUpdateInfo,
} from "./electron-app-updater-adapter";

export class FakeUpdaterAdapter implements ElectronAppUpdaterAdapter {
  checkCalls = 0;
  configureError: unknown = null;
  configureOptions: ElectronUpdaterConfigureOptions | null = null;
  disposeCalls = 0;
  downloadCalls = 0;
  installCalls: Array<{ isForceRunAfter: boolean | undefined; isSilent: boolean | undefined }> = [];
  nativeInstallListeners = 0;
  nativeQuitAndInstallCalls = 0;
  onDownload: (() => void | Promise<void>) | null = null;
  onPrepareInstall: (() => void | Promise<void>) | null = null;
  prepareInstallCalls = 0;
  nextCheckResult: ElectronUpdaterCheckResult | Promise<ElectronUpdaterCheckResult> = {
    isUpdateAvailable: false,
    updateInfo: { version: "0.4.2" },
  };
  nextDownloadResult: Promise<ElectronUpdaterUpdateInfo> = Promise.resolve({ version: "0.4.3" });

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

  async downloadUpdate(): Promise<ElectronUpdaterUpdateInfo> {
    this.downloadCalls += 1;
    await this.onDownload?.();
    return this.nextDownloadResult;
  }

  async dispose(): Promise<void> {
    this.disposeCalls += 1;
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

  async prepareInstall(): Promise<() => Promise<void>> {
    this.prepareInstallCalls += 1;
    await this.onPrepareInstall?.();
    return async () => {
      this.installCalls.push({ isSilent: false, isForceRunAfter: true });
      this.nativeInstallListeners += 1;
    };
  }

  emitNativeUpdateDownloaded(): void {
    this.nativeQuitAndInstallCalls += this.nativeInstallListeners;
  }
}

export const fixedNow = "2026-07-08T22:00:00.000Z";

type FakeScheduledInterval = {
  callback: () => void;
  cleared: boolean;
  intervalMs: number;
};

type FakeScheduledTimeout = {
  callback: () => void;
  cleared: boolean;
  timeoutMs: number;
};

export const flushAsyncWork = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
};

export const createFakeScheduler = () => {
  const intervals: FakeScheduledInterval[] = [];
  const timeouts: FakeScheduledTimeout[] = [];
  const scheduler = {
    setInterval(callback: () => void, intervalMs: number): FakeScheduledInterval {
      const interval = { callback, cleared: false, intervalMs };
      intervals.push(interval);
      return interval;
    },
    clearInterval(handle: unknown): void {
      (handle as FakeScheduledInterval).cleared = true;
    },
    setTimeout(callback: () => void, timeoutMs: number): FakeScheduledTimeout {
      const timeout = { callback, cleared: false, timeoutMs };
      timeouts.push(timeout);
      return timeout;
    },
    clearTimeout(handle: unknown): void {
      (handle as FakeScheduledTimeout).cleared = true;
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
    runTimeout: async (index = 0) => {
      const timeout = timeouts[index];
      if (!timeout || timeout.cleared) {
        return;
      }
      timeout.cleared = true;
      timeout.callback();
      await flushAsyncWork();
    },
    scheduler,
    timeouts,
  };
};

export const createMissingManifestError = (): Error & { code: string } =>
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

export const createService = (
  overrides: Partial<Parameters<typeof createElectronAppUpdateService>[0]> & {
    adapter?: FakeUpdaterAdapter;
  } = {},
) => {
  const adapter = overrides.adapter ?? new FakeUpdaterAdapter();
  const installDownloadedUpdate =
    overrides.installDownloadedUpdate ??
    (async (installHandoff) => {
      await installHandoff();
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
    readUpdateConfig: async () => "provider: github\n",
    resourcesPath: "/Applications/OpenDucktor.app/Contents/Resources",
    ...overrides,
  });
  return { adapter, service };
};
