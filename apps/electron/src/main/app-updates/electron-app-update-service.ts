import { readFileSync } from "node:fs";
import { join } from "node:path";
import type {
  AppUpdateCheckInitiator,
  AppUpdateCommandResult,
  AppUpdateErrorCode,
  AppUpdateOperation,
  AppUpdateState,
} from "@openducktor/contracts";
import { canDownloadAppUpdate, canInstallAppUpdate } from "@openducktor/contracts";
import { parse as parseYaml } from "yaml";
import {
  createDisabledUpdateState,
  markAvailable,
  markChecking,
  markDisabledManualCheck,
  markDownloaded,
  markDownloadedInstallError,
  markDownloadedInstallRequested,
  markDownloadedInstallRetryDisabled,
  markDownloading,
  markDownloadProgress,
  markErrorManualCheck,
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
const HOST_SHUTDOWN_BEFORE_RUN_OPERATION = "electron.main.shutdown-host-before-run";
const INSTALL_RELAUNCH_GUIDANCE = "Quit and reopen OpenDucktor before trying again.";

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

const readStringProperty = (value: unknown, property: string): string | undefined => {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }
  const propertyValue = (value as Record<string, unknown>)[property];
  return typeof propertyValue === "string" ? propertyValue : undefined;
};

const missingManifestPattern = /Cannot find (?:channel ")?(latest(?:-[a-z0-9]+)*\.ya?ml)/i;
const githubReleaseDownloadPattern =
  /https:\/\/github\.com\/[^\s)]+\/releases\/download\/([^/\s)]+)\/[^\s)]+/i;

const missingManifestMessage = (message: string): string | undefined => {
  const manifest = missingManifestPattern.exec(message)?.[1];
  if (!manifest) {
    return undefined;
  }

  const release = githubReleaseDownloadPattern.exec(message)?.[1];
  return `OpenDucktor could not read ${manifest}${
    release ? ` for release ${release}` : ""
  }. Make sure the GitHub release is published and includes the Electron updater metadata asset, then try again.`;
};

const stripTechnicalDetails = (message: string): string => {
  const withoutHeaders = message.split(/\nHeaders:/u)[0] ?? message;
  const withoutStack = withoutHeaders.split(/\n\s+at\s+/u)[0] ?? withoutHeaders;
  return withoutStack.replace(/\s+/gu, " ").trim();
};

const truncateMessage = (message: string): string =>
  message.length > 320 ? `${message.slice(0, 317).trimEnd()}...` : message;

const appUpdateErrorMessage = (operation: AppUpdateOperation, cause: unknown): string => {
  const message = errorMessage(cause);
  const code = readStringProperty(cause, "code");
  const manifestMessage = missingManifestMessage(message);
  if (manifestMessage) {
    return manifestMessage;
  }

  if (
    operation === "check" &&
    (code === "ERR_UPDATER_LATEST_VERSION_NOT_FOUND" ||
      message.includes("Unable to find latest version on GitHub"))
  ) {
    return "OpenDucktor could not read the latest GitHub release. Make sure a published OpenDucktor release exists and the update feed is reachable.";
  }

  if (
    operation === "check" &&
    (code === "ERR_UPDATER_INVALID_UPDATE_INFO" || message.includes("Cannot parse update info"))
  ) {
    return "OpenDucktor could not parse the Electron updater metadata. Regenerate the release metadata and upload it to the GitHub release, then try again.";
  }

  return truncateMessage(stripTechnicalDetails(message));
};

const isObjectWithOperation = (cause: unknown): cause is { operation: unknown } =>
  typeof cause === "object" && cause !== null && "operation" in cause;

const isHostShutdownInstallFailure = (cause: unknown): boolean =>
  isObjectWithOperation(cause) && cause.operation === HOST_SHUTDOWN_BEFORE_RUN_OPERATION;

const installTerminalFailureMessage = (cause: unknown): string => {
  const message = appUpdateErrorMessage("install", cause);
  return message.includes(INSTALL_RELAUNCH_GUIDANCE)
    ? message
    : `${message} ${INSTALL_RELAUNCH_GUIDANCE}`;
};

const hasUpdateProviderConfig = (rawConfig: string | null): boolean => {
  if (rawConfig === null) {
    return false;
  }

  const parsedConfig = parseYaml(rawConfig) as unknown;
  if (typeof parsedConfig !== "object" || parsedConfig === null || Array.isArray(parsedConfig)) {
    return false;
  }

  const provider = (parsedConfig as { provider?: unknown }).provider;
  return typeof provider === "string" && provider.trim().length > 0;
};

const readUpdateVersion = (info: ElectronUpdaterUpdateInfo | undefined): string | undefined =>
  typeof info?.version === "string" && info.version.trim() ? info.version.trim() : undefined;

const readResultUpdateVersion = (result: ElectronUpdaterCheckResult): string | undefined =>
  readUpdateVersion(result.updateInfo) ?? readUpdateVersion(result.versionInfo);

type DisabledAppUpdateState = Extract<AppUpdateState, { status: "disabled" }>;

const availableVersionFromState = (state: AppUpdateState): string | undefined =>
  "availableVersion" in state ? state.availableVersion : undefined;

const checkedAtFromState = (state: AppUpdateState): string | undefined =>
  "checkedAt" in state ? state.checkedAt : undefined;

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
  let updaterReady = false;
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

  const rejectDisabled = (
    operation: AppUpdateOperation,
    disabledState: DisabledAppUpdateState,
  ): AppUpdateCommandResult =>
    commandRejected({
      code: disabledState.disabledCode,
      message: disabledState.disabledReason,
      operation,
    });

  const rejectBusy = (operation: AppUpdateOperation): AppUpdateCommandResult =>
    commandRejected({
      code: "busy",
      message: `Cannot ${operation} updates while another update action is active.`,
      operation,
    });

  const rejectUpdaterUnavailable = (operation: AppUpdateOperation): AppUpdateCommandResult => {
    const currentState = state;
    const error = currentState.status === "error" ? currentState.error : undefined;
    return commandRejected({
      code: error?.code ?? "updater_unavailable",
      message: error?.message ?? "Electron updater is not available.",
      operation,
    });
  };

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
    if (state.status !== "downloading") {
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
    const downloadedVersion = readUpdateVersion(info) ?? availableVersionFromState(state);
    if (!downloadedVersion) {
      setErrorState({
        code: "download_failed",
        message: "The update download completed without a version.",
        operation: "download",
      });
      return;
    }
    publishState(
      markDownloaded({
        availableVersion: downloadedVersion,
        currentVersion,
        previousState: { ...state, availableVersion: downloadedVersion },
      }),
    );
  };

  const applyAdapterError = (cause: unknown): void => {
    const previousState = state;
    const installHandoffStarted =
      previousState.status === "downloaded" &&
      (previousState.installRequested === true || previousState.installRetryDisabled === true);
    const operation = activeOperation ?? (installHandoffStarted ? "install" : "check");
    const availableVersion = availableVersionFromState(previousState);
    const checkedAt = operation === "check" ? now() : checkedAtFromState(previousState);
    const message = appUpdateErrorMessage(operation, cause);
    if (operation === "install" && previousState.status === "downloaded") {
      activeOperation = null;
      if (platform === "darwin" || isHostShutdownInstallFailure(cause)) {
        publishState(
          markDownloadedInstallRetryDisabled({
            cause,
            message: installTerminalFailureMessage(cause),
            previousState,
          }),
        );
        return;
      }
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

    let hasProviderConfig: boolean;
    try {
      hasProviderConfig = hasUpdateProviderConfig(rawConfig);
    } catch (cause) {
      setErrorState({
        code: "updater_unavailable",
        cause,
        message: `Electron update feed configuration is invalid at ${resolvedAppUpdateConfigPath}: ${errorMessage(
          cause,
        )}`,
        operation: "initialize",
      });
      return;
    }

    if (!hasProviderConfig) {
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
      updaterReady = true;
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
        return rejectDisabled("check", currentState);
      }
      if (!updaterReady) {
        if (currentState.status === "error" && initiator !== "background") {
          publishState(markErrorManualCheck(currentState, initiator, now()));
        }
        return rejectUpdaterUnavailable("check");
      }
      if (activeOperation === "check") {
        if (currentState.status === "checking" && initiator !== "background") {
          publishState(markChecking({ currentVersion, initiator, previousState: currentState }));
        }
        return rejectBusy("check");
      }
      if (
        activeOperation !== null ||
        state.status === "downloading" ||
        state.status === "downloaded"
      ) {
        return rejectBusy("check");
      }

      activeOperation = "check";
      publishState(markChecking({ currentVersion, initiator, previousState: currentState }));
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
          message: appUpdateErrorMessage("check", cause),
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
        return rejectDisabled("download", state);
      }
      if (!updaterReady) {
        return rejectUpdaterUnavailable("download");
      }
      if (activeOperation !== null) {
        return rejectBusy("download");
      }
      if (!canDownloadAppUpdate(state)) {
        return rejectInvalidState(
          "download",
          "Download is available only after OpenDucktor finds an update.",
        );
      }

      activeOperation = "download";
      const availableVersion = state.availableVersion;
      publishState(
        markDownloading({
          availableVersion,
          currentVersion,
          previousState: state,
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
        const checkedAt = checkedAtFromState(state);
        setErrorState({
          ...(availableVersion ? { availableVersion } : {}),
          ...(checkedAt ? { checkedAt } : {}),
          code: "download_failed",
          cause,
          message: appUpdateErrorMessage("download", cause),
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
        return rejectDisabled("install", state);
      }
      if (!updaterReady) {
        return rejectUpdaterUnavailable("install");
      }
      if (activeOperation !== null) {
        return rejectBusy("install");
      }
      const downloadedState = state;
      if (!canInstallAppUpdate(downloadedState)) {
        return rejectInvalidState(
          "install",
          "Restart and install is available only after the update download completes.",
        );
      }

      activeOperation = "install";
      publishState(markDownloadedInstallRequested(downloadedState));
      try {
        await installDownloadedUpdate(() => {
          adapter.quitAndInstall(false, true);
        });
        return commandAccepted();
      } catch (cause) {
        activeOperation = null;
        logger.error("OpenDucktor update install failed", cause);
        const previousState = state.status === "downloaded" ? state : downloadedState;
        if (platform === "darwin" || isHostShutdownInstallFailure(cause)) {
          publishState(
            markDownloadedInstallRetryDisabled({
              cause,
              message: installTerminalFailureMessage(cause),
              previousState,
            }),
          );
          return commandAccepted();
        }
        publishState(
          markDownloadedInstallError({
            cause,
            message: appUpdateErrorMessage("install", cause),
            previousState,
          }),
        );
        return commandAccepted();
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
