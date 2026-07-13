import type { AppUpdater, ProgressInfo } from "electron-updater";
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
): void => {
  updater.allowPrerelease = options.allowPrerelease;
  updater.autoDownload = options.autoDownload;
  updater.autoInstallOnAppQuit = options.autoInstallOnAppQuit;
  updater.channel = options.channel;
  updater.logger = options.logger;
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
  const listeners = createEventListeners();

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
    requireConfiguration();
    updaterPromise ??= loadUpdater().then((updater) => {
      configureNativeUpdater(updater, requireConfiguration());
      attachNativeListeners(updater);
      loadedUpdater = updater;
      return updater;
    });
    return updaterPromise;
  };

  return {
    checkForUpdates: async () => {
      const { channel } = requireConfiguration();
      resolvedRelease = await releaseSource.resolve(channel);
      const updateInfo = { version: resolvedRelease.version };
      return {
        isUpdateAvailable: compareReleaseVersions(resolvedRelease.version, currentVersion) > 0,
        updateInfo,
      } satisfies ElectronUpdaterCheckResult;
    },
    configure: (options) => {
      configuration = options;
      if (loadedUpdater) {
        configureNativeUpdater(loadedUpdater, options);
      }
    },
    dispose: async () => {
      if (loadedUpdater) {
        detachNativeListeners(loadedUpdater);
      }
      for (const eventListeners of Object.values(listeners)) {
        eventListeners.clear();
      }
    },
    downloadUpdate: async () => {
      if (!resolvedRelease) {
        throw new ElectronOperationError({
          operation: "electron.updater.prepare-download",
          message: "Check for an OpenDucktor update before downloading it.",
          platform,
        });
      }
      const updater = await getUpdater();
      const nativeResult = await updater.checkForUpdates();
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
      return { version: resolvedRelease.version };
    },
    on: (eventName, listener) => {
      listeners[eventName].add(listener);
      return () => {
        listeners[eventName].delete(listener);
      };
    },
    prepareInstall: async (): Promise<ElectronInstallHandoff> => {
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
