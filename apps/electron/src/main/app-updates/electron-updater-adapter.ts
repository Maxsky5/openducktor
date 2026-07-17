import type { AppUpdater, Logger, ProgressInfo } from "electron-updater";
import { ElectronOperationError } from "../../effect/electron-errors";
import type {
  ElectronAppUpdaterAdapter,
  ElectronInstallHandoff,
  ElectronUpdaterCheckResult,
  ElectronUpdaterConfigureOptions,
  ElectronUpdaterEventMap,
} from "./electron-app-updater-adapter";
import {
  compareReleaseVersions,
  type GitHubRelease,
  type GitHubReleaseSource,
} from "./github-release-source";

type NativeUpdaterLoader = () => Promise<AppUpdater>;

type ElectronUpdaterAdapterOptions = {
  currentVersion: string;
  loadUpdater?: NativeUpdaterLoader;
  platform?: NodeJS.Platform;
  releaseSource: GitHubReleaseSource;
};

type EventListeners = {
  [EventName in keyof ElectronUpdaterEventMap]: Set<
    (payload: ElectronUpdaterEventMap[EventName]) => void
  >;
};

const createEventListeners = (): EventListeners => ({
  error: new Set(),
  "download-progress": new Set(),
});

const loadNativeUpdater: NativeUpdaterLoader = async () => {
  const { autoUpdater } = await import("electron-updater");
  return autoUpdater;
};

const configureNativeUpdater = (
  updater: AppUpdater,
  options: ElectronUpdaterConfigureOptions,
  logger: Logger,
): void => {
  updater.allowPrerelease = options.allowPrerelease;
  updater.autoDownload = options.autoDownload;
  updater.autoInstallOnAppQuit = options.autoInstallOnAppQuit;
  updater.channel = options.channel;
  updater.logger = logger;
};

export const createElectronUpdaterAdapter = ({
  currentVersion,
  loadUpdater = loadNativeUpdater,
  platform = process.platform,
  releaseSource,
}: ElectronUpdaterAdapterOptions): ElectronAppUpdaterAdapter => {
  let configuration: ElectronUpdaterConfigureOptions | undefined;
  let loadedUpdater: AppUpdater | undefined;
  let resolvedRelease: GitHubRelease | undefined;
  let updaterPromise: Promise<AppUpdater> | undefined;
  let disposed = false;
  let firstNativeLogFailure: unknown | undefined;
  const pendingNativeLogs = new Set<Promise<void>>();
  const listeners = createEventListeners();

  const trackNativeLog = (
    options: ElectronUpdaterConfigureOptions,
    operation: () => void | Promise<void>,
  ): void => {
    const pending = Promise.resolve()
      .then(operation)
      .then(
        () => {},
        (cause: unknown) => {
          firstNativeLogFailure ??= cause;
          options.onLogFailure(cause);
        },
      );
    pendingNativeLogs.add(pending);
    void pending.then(
      () => {
        pendingNativeLogs.delete(pending);
      },
      () => {
        pendingNativeLogs.delete(pending);
      },
    );
  };

  const createNativeLogger = (options: ElectronUpdaterConfigureOptions): Logger => ({
    error: (message) => {
      trackNativeLog(options, () => options.logger.error(String(message)));
    },
    info: (message) => {
      trackNativeLog(options, () => options.logger.info(String(message)));
    },
    warn: (message) => {
      trackNativeLog(options, () => options.logger.warn(String(message)));
    },
  });

  const drainNativeLogs = async (): Promise<void> => {
    await Promise.all(pendingNativeLogs);
    if (firstNativeLogFailure !== undefined) {
      throw firstNativeLogFailure;
    }
  };

  const requireActive = (operation: string): void => {
    if (!disposed) {
      return;
    }
    throw new ElectronOperationError({
      operation,
      message: "Electron updater is no longer available because the app is shutting down.",
      platform,
    });
  };

  const emit = <EventName extends keyof ElectronUpdaterEventMap>(
    eventName: EventName,
    payload: ElectronUpdaterEventMap[EventName],
  ): void => {
    for (const listener of listeners[eventName]) {
      listener(payload);
    }
  };

  const handleNativeError = (cause: Error): void => {
    emit("error", cause);
  };

  const handleNativeProgress = (progress: ProgressInfo): void => {
    if (!Number.isFinite(progress.percent)) {
      emit(
        "error",
        new ElectronOperationError({
          operation: "electron.updater.read-download-progress",
          message: "Electron updater emitted a non-finite download percentage.",
          platform,
          details: { percent: progress.percent },
        }),
      );
      return;
    }
    emit("download-progress", { percent: progress.percent });
  };

  const attachNativeListeners = (updater: AppUpdater): void => {
    updater.on("error", handleNativeError);
    updater.on("download-progress", handleNativeProgress);
  };

  const detachNativeListeners = (updater: AppUpdater): void => {
    updater.removeListener("error", handleNativeError);
    updater.removeListener("download-progress", handleNativeProgress);
  };

  const requireConfiguration = (): ElectronUpdaterConfigureOptions => {
    if (configuration) {
      return configuration;
    }
    throw new ElectronOperationError({
      operation: "electron.updater.initialize",
      message: "Electron updater must be configured before it is used.",
      platform,
    });
  };

  const getUpdater = (): Promise<AppUpdater> => {
    requireActive("electron.updater.initialize");
    requireConfiguration();
    updaterPromise ??= loadUpdater().then((updater) => {
      requireActive("electron.updater.initialize");
      const options = requireConfiguration();
      configureNativeUpdater(updater, options, createNativeLogger(options));
      attachNativeListeners(updater);
      loadedUpdater = updater;
      return updater;
    });
    return updaterPromise;
  };

  return {
    checkForUpdates: async () => {
      requireActive("electron.updater.check");
      const { channel } = requireConfiguration();
      const release = await releaseSource.resolve(channel);
      requireActive("electron.updater.check");
      resolvedRelease = release;
      const updateInfo = { version: release.version };
      return {
        isUpdateAvailable: compareReleaseVersions(release.version, currentVersion) > 0,
        updateInfo,
      } satisfies ElectronUpdaterCheckResult;
    },
    configure: (options) => {
      requireActive("electron.updater.configure");
      configuration = options;
      if (loadedUpdater) {
        configureNativeUpdater(loadedUpdater, options, createNativeLogger(options));
      }
    },
    dispose: async () => {
      if (disposed) {
        return;
      }
      disposed = true;
      if (loadedUpdater) {
        detachNativeListeners(loadedUpdater);
        loadedUpdater.logger = null;
      }
      for (const eventListeners of Object.values(listeners)) {
        eventListeners.clear();
      }
      await drainNativeLogs();
    },
    downloadUpdate: async () => {
      requireActive("electron.updater.download");
      if (!resolvedRelease) {
        throw new ElectronOperationError({
          operation: "electron.updater.prepare-download",
          message: "Check for an OpenDucktor update before downloading it.",
          platform,
        });
      }
      const updater = await getUpdater();
      requireActive("electron.updater.download");
      const nativeResult = await updater.checkForUpdates();
      requireActive("electron.updater.download");
      const nativeVersion = nativeResult?.updateInfo.version;
      if (
        !nativeResult?.isUpdateAvailable ||
        typeof nativeVersion !== "string" ||
        nativeVersion !== resolvedRelease.version
      ) {
        throw new ElectronOperationError({
          operation: "electron.updater.validate-download-release",
          message: `The native updater resolved ${String(nativeVersion)} instead of GitHub release ${resolvedRelease.version}. Check the published updater metadata.`,
          platform,
        });
      }
      await updater.downloadUpdate();
      requireActive("electron.updater.download");
      return { version: resolvedRelease.version };
    },
    on: (eventName, listener) => {
      requireActive("electron.updater.subscribe");
      listeners[eventName].add(listener);
      return () => {
        listeners[eventName].delete(listener);
      };
    },
    prepareInstall: async (): Promise<ElectronInstallHandoff> => {
      requireActive("electron.updater.prepare-install");
      if (!loadedUpdater) {
        throw new ElectronOperationError({
          operation: "electron.updater.prepare-install",
          message: "Electron updater is not initialized. Download the update first.",
          platform,
        });
      }
      const updater = loadedUpdater;
      return async () => {
        updater.quitAndInstall(false, true);
      };
    },
  };
};
