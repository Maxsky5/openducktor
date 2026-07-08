import { readFileSync } from "node:fs";
import { join } from "node:path";
import type {
  AppUpdateCheckInitiator,
  AppUpdateCommandResult,
  AppUpdateError,
  AppUpdateErrorCode,
  AppUpdateOperation,
  AppUpdateState,
} from "@openducktor/contracts";

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

const errorCauseName = (cause: unknown): string | undefined =>
  cause instanceof Error ? cause.name : undefined;

const hasUpdateProviderConfig = (rawConfig: string | null): boolean =>
  typeof rawConfig === "string" && /^\s*provider\s*:/m.test(rawConfig);

const readUpdateVersion = (info: ElectronUpdaterUpdateInfo | undefined): string | undefined =>
  typeof info?.version === "string" && info.version.trim() ? info.version.trim() : undefined;

const readResultUpdateVersion = (result: ElectronUpdaterCheckResult): string | undefined =>
  readUpdateVersion(result.updateInfo) ?? readUpdateVersion(result.versionInfo);

const createError = ({
  cause,
  code,
  details,
  message,
  operation,
}: {
  cause?: unknown;
  code: AppUpdateErrorCode;
  details?: Record<string, unknown>;
  message: string;
  operation: AppUpdateOperation;
}): AppUpdateError => ({
  code,
  message,
  operation,
  ...(cause === undefined ? {} : { causeName: errorCauseName(cause) }),
  ...(details === undefined ? {} : { details }),
});

const createDisabledState = ({
  code,
  currentVersion,
  reason,
}: {
  code: AppUpdateErrorCode;
  currentVersion: string;
  reason: string;
}): AppUpdateState => ({
  status: "disabled",
  currentVersion,
  disabledCode: code,
  disabledReason: reason,
});

const clampProgressPercent = (percent: number): number => Math.max(0, Math.min(100, percent));

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
    publishState({
      status: "error",
      currentVersion,
      ...(availableVersion ? { availableVersion } : {}),
      ...(state.checkInitiator ? { checkInitiator: state.checkInitiator } : {}),
      ...(checkedAt ? { checkedAt } : {}),
      error: createError({ cause, code, message, operation }),
    });

  const applyAvailable = (availableVersion: string, checkedAt: string = now()): AppUpdateState =>
    publishState({
      status: "available",
      currentVersion,
      availableVersion,
      ...(state.checkInitiator ? { checkInitiator: state.checkInitiator } : {}),
      checkedAt,
    });

  const applyUpToDate = (checkedAt: string = now()): AppUpdateState =>
    publishState({
      status: "upToDate",
      currentVersion,
      ...(state.checkInitiator ? { checkInitiator: state.checkInitiator } : {}),
      checkedAt,
    });

  const applyDownloadProgress = (progress: ElectronUpdaterDownloadProgress): void => {
    if (typeof progress.percent !== "number" || !Number.isFinite(progress.percent)) {
      return;
    }
    publishState({
      status: "downloading",
      currentVersion,
      ...(state.availableVersion ? { availableVersion: state.availableVersion } : {}),
      progressPercent: clampProgressPercent(progress.percent),
      ...(state.checkInitiator ? { checkInitiator: state.checkInitiator } : {}),
      ...(state.checkedAt ? { checkedAt: state.checkedAt } : {}),
    });
  };

  const applyDownloaded = (info: ElectronUpdaterUpdateInfo): void => {
    const downloadedVersion = readUpdateVersion(info) ?? state.availableVersion;
    publishState({
      status: "downloaded",
      currentVersion,
      ...(downloadedVersion ? { availableVersion: downloadedVersion } : {}),
      progressPercent: 100,
      ...(state.checkInitiator ? { checkInitiator: state.checkInitiator } : {}),
      ...(state.checkedAt ? { checkedAt: state.checkedAt } : {}),
    });
  };

  const applyAdapterError = (cause: unknown): void => {
    const operation = activeOperation ?? "check";
    const availableVersion = state.availableVersion;
    const checkedAt = operation === "check" ? now() : state.checkedAt;
    const message = errorMessage(cause);
    if (operation === "install" && state.status === "downloaded") {
      publishState({
        ...state,
        error: createError({
          cause,
          code: "install_failed",
          message,
          operation: "install",
        }),
      });
      return;
    }
    setErrorState({
      ...(availableVersion ? { availableVersion } : {}),
      ...(checkedAt ? { checkedAt } : {}),
      code:
        operation === "download"
          ? "download_failed"
          : operation === "install"
            ? "install_failed"
            : "check_failed",
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
        createDisabledState({
          code: "not_packaged",
          currentVersion,
          reason: "Updates are available only in packaged desktop builds.",
        }),
      );
      return;
    }
    if (platform === "linux" && !appImagePath) {
      publishState(
        createDisabledState({
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
        createDisabledState({
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
      if (state.status === "disabled") {
        publishState({
          ...state,
          checkInitiator: initiator,
          checkedAt: now(),
        });
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
      publishState({ status: "checking", currentVersion, checkInitiator: initiator });
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
      publishState({
        status: "downloading",
        currentVersion,
        ...(availableVersion ? { availableVersion } : {}),
        progressPercent: state.progressPercent ?? 0,
        ...(state.checkInitiator ? { checkInitiator: state.checkInitiator } : {}),
        ...(state.checkedAt ? { checkedAt: state.checkedAt } : {}),
      });
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
      if (state.status !== "downloaded") {
        return rejectInvalidState(
          "install",
          "Restart and install is available only after the update download completes.",
        );
      }

      activeOperation = "install";
      const downloadedState = state;
      try {
        await installDownloadedUpdate(() => {
          adapter.quitAndInstall(false, true);
        });
        return commandAccepted();
      } catch (cause) {
        logger.error("OpenDucktor update install failed", cause);
        publishState({
          ...downloadedState,
          error: createError({
            cause,
            code: "install_failed",
            message: errorMessage(cause),
            operation: "install",
          }),
        });
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
