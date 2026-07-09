import { readFileSync } from "node:fs";
import { join } from "node:path";
import type {
  AppUpdateCheckInitiator,
  AppUpdateCommandResult,
  AppUpdateErrorCode,
  AppUpdateOperation,
  AppUpdateState,
} from "@openducktor/contracts";
import {
  createDisabledUpdateState,
  markAvailable,
  markChecking,
  markDisabledManualCheck,
  markDownloaded,
  markDownloadedInstallError,
  markDownloading,
  markDownloadProgress,
  markUpdateError,
  markUpToDate,
  updateErrorCodeForOperation,
} from "./app-update-state-machine";

type ElectronAppUpdateLogger = {
  error(message: string, error?: unknown): void;
  info(message: string): void;
  warn(message: string, details?: unknown): void;
};

export type ElectronUpdaterConfigureOptions = {
  autoDownload: false;
  autoInstallOnAppQuit: false;
  logger: ElectronAppUpdateLogger;
};

export type ElectronUpdaterUpdateInfo = {
  version?: unknown;
};

export type ElectronUpdaterCheckResult = {
  isUpdateAvailable?: boolean;
  updateInfo?: ElectronUpdaterUpdateInfo;
  versionInfo?: ElectronUpdaterUpdateInfo;
};

export type ElectronUpdaterDownloadProgress = {
  percent?: unknown;
};

export type ElectronUpdaterEventMap = {
  error: unknown;
  "update-available": ElectronUpdaterUpdateInfo;
  "update-not-available": ElectronUpdaterUpdateInfo;
  "download-progress": ElectronUpdaterDownloadProgress;
  "update-downloaded": ElectronUpdaterUpdateInfo;
};

export type ElectronAppUpdaterAdapter = {
  checkForUpdates(): Promise<ElectronUpdaterCheckResult | null>;
  configure(options: ElectronUpdaterConfigureOptions): void;
  downloadUpdate(): Promise<readonly string[]>;
  on<EventName extends keyof ElectronUpdaterEventMap>(
    eventName: EventName,
    listener: (payload: ElectronUpdaterEventMap[EventName]) => void,
  ): () => void;
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void;
};

export type ElectronAppUpdateService = {
  check(input: { initiator: AppUpdateCheckInitiator }): Promise<AppUpdateCommandResult>;
  dispose(): void;
  download(): Promise<AppUpdateCommandResult>;
  getState(): AppUpdateState;
  install(): Promise<AppUpdateCommandResult>;
  startBackgroundCheck(): void;
  subscribe(listener: (state: AppUpdateState) => void): () => void;
};

export type ElectronAppUpdateServiceOptions = {
  adapter: ElectronAppUpdaterAdapter;
  appImagePath?: string | undefined;
  appUpdateConfigPath?: string | undefined;
  currentVersion: string;
  installDownloadedUpdate(runInstall: () => void): Promise<void>;
  isPackaged: boolean;
  logger: ElectronAppUpdateLogger;
  now?: () => string;
  platform: NodeJS.Platform;
  readUpdateConfig?: (path: string) => string | null;
  resourcesPath: string;
};

const DEFAULT_APP_UPDATE_CONFIG_FILE = "app-update.yml";

const defaultReadUpdateConfig = (path: string): string | null => {
  try {
    return readFileSync(path, "utf8");
  } catch (cause) {
    if (typeof cause === "object" && cause !== null && "code" in cause && cause.code === "ENOENT") {
      return null;
    }
    throw cause;
  }
};

const defaultNow = (): string => new Date().toISOString();

const errorMessage = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);

const hasUpdateProviderConfig = (rawConfig: string | null): boolean =>
  typeof rawConfig === "string" && /^\s*provider\s*:/m.test(rawConfig);

const readUpdateVersion = (info: ElectronUpdaterUpdateInfo | undefined): string | undefined =>
  typeof info?.version === "string" && info.version.trim() ? info.version.trim() : undefined;

const readResultUpdateVersion = (result: ElectronUpdaterCheckResult): string | undefined =>
  readUpdateVersion(result.updateInfo) ?? readUpdateVersion(result.versionInfo);

export const createElectronAppUpdateService = ({
  adapter,
  appImagePath,
  appUpdateConfigPath,
  currentVersion,
  installDownloadedUpdate,
  isPackaged,
  logger,
  now = defaultNow,
  platform,
  readUpdateConfig = defaultReadUpdateConfig,
  resourcesPath,
}: ElectronAppUpdateServiceOptions): ElectronAppUpdateService => {
  const listeners = new Set<(state: AppUpdateState) => void>();
  const unsubscribeAdapterListeners: Array<() => void> = [];
  const resolvedAppUpdateConfigPath =
    appUpdateConfigPath ?? join(resourcesPath, DEFAULT_APP_UPDATE_CONFIG_FILE);
  let activeOperation: AppUpdateOperation | null = null;
  let disposed = false;
  let state: AppUpdateState = { status: "idle", currentVersion };

  const publishState = (nextState: AppUpdateState): AppUpdateState => {
    state = nextState;
    for (const listener of listeners) {
      listener(state);
    }
    return state;
  };

  const getCurrentState = (): AppUpdateState => state;

  const commandAccepted = (): AppUpdateCommandResult => ({ accepted: true, state });

  const commandRejected = ({
    code,
    message,
    operation,
  }: {
    code: AppUpdateErrorCode;
    message: string;
    operation: AppUpdateOperation;
  }): AppUpdateCommandResult => ({
    accepted: false,
    rejection: { code, message, operation },
    state,
  });

  const rejectDisabled = (operation: AppUpdateOperation): AppUpdateCommandResult =>
    commandRejected({
      code: state.disabledCode ?? "updater_unavailable",
      message: state.disabledReason ?? "OpenDucktor updates are unavailable.",
      operation,
    });

  const rejectBusy = (operation: AppUpdateOperation): AppUpdateCommandResult =>
    commandRejected({
      code: "busy",
      message: `Cannot ${operation} updates while another update action is active.`,
      operation,
    });

  const rejectInvalidState = (
    operation: AppUpdateOperation,
    message: string,
  ): AppUpdateCommandResult =>
    commandRejected({
      code: "invalid_state",
      message,
      operation,
    });

  const setErrorState = ({
    availableVersion,
    checkedAt,
    code,
    cause,
    message,
    operation,
  }: {
    availableVersion?: string;
    checkedAt?: string;
    code: AppUpdateErrorCode;
    cause?: unknown;
    message: string;
    operation: AppUpdateOperation;
  }): AppUpdateState =>
    publishState(
      markUpdateError({
        ...(availableVersion ? { availableVersion } : {}),
        ...(checkedAt ? { checkedAt } : {}),
        code,
        cause,
        currentVersion,
        message,
        operation,
        previousState: state,
      }),
    );

  const applyAvailable = (availableVersion: string, checkedAt: string = now()): AppUpdateState =>
    publishState(
      markAvailable({
        availableVersion,
        checkedAt,
        currentVersion,
        previousState: state,
      }),
    );

  const applyUpToDate = (checkedAt: string = now()): AppUpdateState =>
    publishState(
      markUpToDate({
        checkedAt,
        currentVersion,
        previousState: state,
      }),
    );

  const applyDownloadProgress = (progress: ElectronUpdaterDownloadProgress): void => {
    if (typeof progress.percent !== "number" || !Number.isFinite(progress.percent)) {
      return;
    }
    publishState(
      markDownloadProgress({
        currentVersion,
        percent: progress.percent,
        previousState: state,
      }),
    );
  };

  const applyDownloaded = (info: ElectronUpdaterUpdateInfo): void => {
    const downloadedVersion = readUpdateVersion(info) ?? state.availableVersion;
    publishState(
      markDownloaded({
        ...(downloadedVersion ? { availableVersion: downloadedVersion } : {}),
        currentVersion,
        previousState: state,
      }),
    );
  };

  const applyAdapterError = (cause: unknown): void => {
    const operation = activeOperation ?? "check";
    const previousState = state;
    const availableVersion = previousState.availableVersion;
    const checkedAt = operation === "check" ? now() : previousState.checkedAt;
    const message = errorMessage(cause);
    if (operation === "install" && previousState.status === "downloaded") {
      publishState(
        markDownloadedInstallError({
          cause,
          message,
          previousState,
        }),
      );
      return;
    }
    setErrorState({
      ...(availableVersion ? { availableVersion } : {}),
      ...(checkedAt ? { checkedAt } : {}),
      code: updateErrorCodeForOperation(operation),
      cause,
      message,
      operation,
    });
  };

  const registerAdapterEvents = (): void => {
    unsubscribeAdapterListeners.push(
      adapter.on("update-available", (info) => {
        const availableVersion = readUpdateVersion(info);
        if (!availableVersion) {
          setErrorState({
            checkedAt: now(),
            code: "check_failed",
            message: "The update feed reported an available update without a version.",
            operation: "check",
          });
          return;
        }
        applyAvailable(availableVersion);
      }),
      adapter.on("update-not-available", () => {
        applyUpToDate();
      }),
      adapter.on("download-progress", applyDownloadProgress),
      adapter.on("update-downloaded", applyDownloaded),
      adapter.on("error", applyAdapterError),
    );
  };

  const configure = (): void => {
    if (!isPackaged) {
      publishState(
        createDisabledUpdateState({
          code: "not_packaged",
          currentVersion,
          reason: "Updates are available only in packaged desktop builds.",
        }),
      );
      return;
    }
    if (platform === "linux" && !appImagePath) {
      publishState(
        createDisabledUpdateState({
          code: "unsupported_linux_target",
          currentVersion,
          reason: "OpenDucktor updates on Linux require the AppImage build.",
        }),
      );
      return;
    }

    let rawConfig: string | null;
    try {
      rawConfig = readUpdateConfig(resolvedAppUpdateConfigPath);
    } catch (cause) {
      setErrorState({
        code: "updater_unavailable",
        cause,
        message: `Failed to read Electron update configuration at ${resolvedAppUpdateConfigPath}: ${errorMessage(
          cause,
        )}`,
        operation: "initialize",
      });
      return;
    }

    if (!hasUpdateProviderConfig(rawConfig)) {
      publishState(
        createDisabledUpdateState({
          code: "missing_update_config",
          currentVersion,
          reason: `Electron update feed configuration is missing at ${resolvedAppUpdateConfigPath}.`,
        }),
      );
      return;
    }

    try {
      adapter.configure({
        autoDownload: false,
        autoInstallOnAppQuit: false,
        logger,
      });
      registerAdapterEvents();
      publishState({ status: "idle", currentVersion });
    } catch (cause) {
      setErrorState({
        code: "updater_unavailable",
        cause,
        message: `Electron updater initialization failed: ${errorMessage(cause)}`,
        operation: "initialize",
      });
    }
  };

  configure();

  const service: ElectronAppUpdateService = {
    check: async ({ initiator }) => {
      const currentState = state;
      if (currentState.status === "disabled") {
        publishState(markDisabledManualCheck(currentState, initiator, now()));
        return rejectDisabled("check");
      }
      if (
        activeOperation !== null ||
        state.status === "downloading" ||
        state.status === "downloaded"
      ) {
        return rejectBusy("check");
      }

      activeOperation = "check";
      publishState(markChecking({ currentVersion, initiator }));
      try {
        const result = await adapter.checkForUpdates();
        if (result === null) {
          setErrorState({
            checkedAt: now(),
            code: "updater_unavailable",
            message: "Electron updater returned no update result. Check packaged update metadata.",
            operation: "check",
          });
          return commandAccepted();
        }

        if (state.status === "checking") {
          const availableVersion = readResultUpdateVersion(result);
          if (result.isUpdateAvailable) {
            if (!availableVersion) {
              setErrorState({
                checkedAt: now(),
                code: "check_failed",
                message: "The update feed reported an available update without a version.",
                operation: "check",
              });
            } else {
              applyAvailable(availableVersion);
            }
          } else {
            applyUpToDate();
          }
        }
        logger.info(`OpenDucktor update check completed (${initiator})`);
        return commandAccepted();
      } catch (cause) {
        logger.error("OpenDucktor update check failed", cause);
        setErrorState({
          checkedAt: now(),
          code: "check_failed",
          cause,
          message: errorMessage(cause),
          operation: "check",
        });
        return commandAccepted();
      } finally {
        activeOperation = null;
      }
    },
    dispose: () => {
      disposed = true;
      listeners.clear();
      for (const unsubscribe of unsubscribeAdapterListeners.splice(0)) {
        unsubscribe();
      }
    },
    download: async () => {
      if (state.status === "disabled") {
        return rejectDisabled("download");
      }
      if (activeOperation !== null) {
        return rejectBusy("download");
      }
      if (
        state.status !== "available" &&
        !(
          state.status === "error" &&
          state.error?.operation === "download" &&
          state.availableVersion
        )
      ) {
        return rejectInvalidState(
          "download",
          "Download is available only after OpenDucktor finds an update.",
        );
      }

      activeOperation = "download";
      const availableVersion = state.availableVersion;
      publishState(
        markDownloading({
          currentVersion,
          previousState: state,
          ...(availableVersion ? { availableVersion } : {}),
        }),
      );
      try {
        await adapter.downloadUpdate();
        if (getCurrentState().status === "downloading") {
          applyDownloaded({ version: availableVersion });
        }
        logger.info("OpenDucktor update download completed");
        return commandAccepted();
      } catch (cause) {
        logger.error("OpenDucktor update download failed", cause);
        setErrorState({
          ...(availableVersion ? { availableVersion } : {}),
          ...(state.checkedAt ? { checkedAt: state.checkedAt } : {}),
          code: "download_failed",
          cause,
          message: errorMessage(cause),
          operation: "download",
        });
        return commandAccepted();
      } finally {
        activeOperation = null;
      }
    },
    getState: () => state,
    install: async () => {
      if (state.status === "disabled") {
        return rejectDisabled("install");
      }
      if (activeOperation !== null) {
        return rejectBusy("install");
      }
      const downloadedState = state;
      if (downloadedState.status !== "downloaded") {
        return rejectInvalidState(
          "install",
          "Restart and install is available only after the update download completes.",
        );
      }

      activeOperation = "install";
      try {
        await installDownloadedUpdate(() => {
          adapter.quitAndInstall(false, true);
        });
        return commandAccepted();
      } catch (cause) {
        logger.error("OpenDucktor update install failed", cause);
        publishState(
          markDownloadedInstallError({
            cause,
            message: errorMessage(cause),
            previousState: downloadedState,
          }),
        );
        return commandAccepted();
      } finally {
        activeOperation = null;
      }
    },
    startBackgroundCheck: () => {
      if (disposed) {
        return;
      }
      void service.check({ initiator: "background" });
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };

  return service;
};
