import { readFile } from "node:fs/promises";
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
import type {
  ElectronAppUpdaterAdapter,
  ElectronInstallHandoff,
  ElectronUpdaterCheckResult,
  ElectronUpdaterDownloadProgress,
  ElectronUpdaterUpdateInfo,
} from "./electron-app-updater-adapter";

type ElectronAppUpdateLogger = {
  error(message: string, error?: unknown): void | Promise<void>;
  info(message: string): void | Promise<void>;
  warn(message: string, details?: unknown): void | Promise<void>;
};

export type ElectronAppUpdateService = {
  check(input: { initiator: AppUpdateCheckInitiator }): Promise<AppUpdateCommandResult>;
  dispose(): Promise<void>;
  download(): Promise<AppUpdateCommandResult>;
  getState(): AppUpdateState;
  install(): Promise<AppUpdateCommandResult>;
  startBackgroundChecks(): void;
  subscribe(listener: (state: AppUpdateState) => void): () => void;
};

export type ElectronAppUpdateScheduler = {
  clearInterval(handle: unknown): void;
  clearTimeout(handle: unknown): void;
  setInterval(callback: () => void, intervalMs: number): unknown;
  setTimeout(callback: () => void, timeoutMs: number): unknown;
};

export type ElectronAppUpdateServiceOptions = {
  adapter: ElectronAppUpdaterAdapter;
  appImagePath?: string | undefined;
  appUpdateConfigPath?: string | undefined;
  backgroundCheckIntervalMs?: number;
  currentVersion: string;
  installDownloadedUpdate(installHandoff: ElectronInstallHandoff): Promise<void>;
  isPackaged: boolean;
  logger: ElectronAppUpdateLogger;
  now?: () => string;
  onFatalError(cause: unknown): void;
  platform: NodeJS.Platform;
  readUpdateConfig?: (path: string) => Promise<string | null>;
  resourcesPath: string;
  scheduler?: ElectronAppUpdateScheduler;
};

const DEFAULT_APP_UPDATE_CONFIG_FILE = "app-update.yml";
const INSTALL_RELAUNCH_GUIDANCE = "Quit and reopen OpenDucktor before trying again.";
const MANUAL_SIGNATURE_UPDATE_GUIDANCE =
  "This installation cannot verify the signed update because it was installed without a compatible macOS signature. Download and install the latest signed release manually. Automatic updates will work after that.";
const APP_UPDATE_PROGRESS_INTERVAL_MS = 500;
const INITIAL_APP_UPDATE_CHECK_DELAY_MS = 1_000;
export const DEFAULT_APP_UPDATE_BACKGROUND_CHECK_INTERVAL_MS = 12 * 60 * 60 * 1000;

const releaseVersionPattern =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+)(?:\.[0-9A-Za-z-]+)*)?$/;

export const deriveElectronUpdateChannel = (version: string): string | null =>
  releaseVersionPattern.exec(version)?.[4] ?? null;

const defaultAppUpdateScheduler: ElectronAppUpdateScheduler = {
  clearInterval: (handle) => {
    clearInterval(handle as ReturnType<typeof setInterval>);
  },
  clearTimeout: (handle) => {
    clearTimeout(handle as ReturnType<typeof setTimeout>);
  },
  setInterval: (callback, intervalMs) => setInterval(callback, intervalMs),
  setTimeout: (callback, timeoutMs) => setTimeout(callback, timeoutMs),
};

const defaultReadUpdateConfig = async (path: string): Promise<string | null> => {
  try {
    return await readFile(path, "utf8");
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

const isMacOsUpdateSignatureMismatch = (platform: NodeJS.Platform, cause: unknown): boolean => {
  if (platform !== "darwin") {
    return false;
  }
  const message = errorMessage(cause);
  return (
    message.includes("Code signature at URL") &&
    message.includes(
      "did not pass validation: code failed to satisfy specified code requirement(s)",
    )
  );
};

const readStringProperty = (value: unknown, property: string): string | undefined => {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }
  const propertyValue = Reflect.get(value, property);
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

  const parsedConfig: unknown = parseYaml(rawConfig);
  if (typeof parsedConfig !== "object" || parsedConfig === null || Array.isArray(parsedConfig)) {
    return false;
  }

  const provider = Reflect.get(parsedConfig, "provider");
  return typeof provider === "string" && provider.trim().length > 0;
};

type DisabledAppUpdateState = Extract<AppUpdateState, { status: "disabled" }>;

const availableVersionFromState = (state: AppUpdateState): string | undefined =>
  "availableVersion" in state ? state.availableVersion : undefined;

const checkedAtFromState = (state: AppUpdateState): string | undefined =>
  "checkedAt" in state ? state.checkedAt : undefined;

export const createElectronAppUpdateService = ({
  adapter,
  appImagePath,
  appUpdateConfigPath,
  backgroundCheckIntervalMs = DEFAULT_APP_UPDATE_BACKGROUND_CHECK_INTERVAL_MS,
  currentVersion,
  installDownloadedUpdate,
  isPackaged,
  logger,
  now = defaultNow,
  onFatalError,
  platform,
  readUpdateConfig = defaultReadUpdateConfig,
  resourcesPath,
  scheduler = defaultAppUpdateScheduler,
}: ElectronAppUpdateServiceOptions): ElectronAppUpdateService => {
  const listeners = new Set<(state: AppUpdateState) => void>();
  const unsubscribeAdapterListeners: Array<() => void> = [];
  const resolvedAppUpdateConfigPath =
    appUpdateConfigPath ?? join(resourcesPath, DEFAULT_APP_UPDATE_CONFIG_FILE);
  let activeOperation: AppUpdateOperation | null = null;
  let backgroundCheckIntervalHandle: unknown = null;
  let downloadProgressThrottleHandle: unknown = null;
  let initialBackgroundCheckHandle: unknown = null;
  let installHandoffStarted = false;
  let pendingDownloadProgress: number | null = null;
  let disposed = false;
  let initializationAttempted = false;
  let updaterReady = false;
  let state: AppUpdateState = { status: "idle", currentVersion };
  let firstDetachedLogFailure: unknown | undefined;
  const pendingDetachedLogs = new Set<Promise<void>>();

  const trackDetachedLog = (operation: () => void | Promise<void>): void => {
    const pending = Promise.resolve()
      .then(operation)
      .then(
        () => {},
        (cause: unknown) => {
          firstDetachedLogFailure ??= cause;
          onFatalError(cause);
        },
      );
    pendingDetachedLogs.add(pending);
    void pending.then(
      () => {
        pendingDetachedLogs.delete(pending);
      },
      () => {
        pendingDetachedLogs.delete(pending);
      },
    );
  };

  const drainDetachedLogs = async (): Promise<void> => {
    await Promise.all(pendingDetachedLogs);
    if (firstDetachedLogFailure !== undefined) {
      throw firstDetachedLogFailure;
    }
  };

  if (!isPackaged) {
    state = createDisabledUpdateState({
      code: "not_packaged",
      currentVersion,
      reason: "Updates are available only in packaged desktop builds.",
    });
  } else if (platform === "linux" && !appImagePath) {
    state = createDisabledUpdateState({
      code: "unsupported_linux_target",
      currentVersion,
      reason: "OpenDucktor updates on Linux require the AppImage build.",
    });
  }

  const publishState = (nextState: AppUpdateState): AppUpdateState => {
    if (disposed) {
      return state;
    }
    state = nextState;
    for (const listener of listeners) {
      listener(state);
    }
    return state;
  };

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

  const rejectDisposed = (operation: AppUpdateOperation): AppUpdateCommandResult =>
    commandRejected({
      code: "updater_unavailable",
      message: "Electron updater is no longer available because the app is shutting down.",
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

  const publishDownloadProgress = (
    previousState: Extract<AppUpdateState, { status: "downloading" }>,
    percent: number,
  ): void => {
    publishState(
      markDownloadProgress({
        currentVersion,
        percent,
        previousState,
      }),
    );
  };

  const clearDownloadProgressThrottle = (): void => {
    pendingDownloadProgress = null;
    if (downloadProgressThrottleHandle !== null) {
      scheduler.clearTimeout(downloadProgressThrottleHandle);
      downloadProgressThrottleHandle = null;
    }
  };

  const flushDownloadProgress = (): void => {
    downloadProgressThrottleHandle = null;
    if (disposed || pendingDownloadProgress === null || state.status !== "downloading") {
      pendingDownloadProgress = null;
      return;
    }

    const percent = pendingDownloadProgress;
    pendingDownloadProgress = null;
    publishDownloadProgress(state, percent);
    downloadProgressThrottleHandle = scheduler.setTimeout(
      flushDownloadProgress,
      APP_UPDATE_PROGRESS_INTERVAL_MS,
    );
  };

  const applyDownloadProgress = (progress: ElectronUpdaterDownloadProgress): void => {
    if (disposed || state.status !== "downloading") {
      return;
    }
    if (downloadProgressThrottleHandle === null) {
      publishDownloadProgress(state, progress.percent);
      downloadProgressThrottleHandle = scheduler.setTimeout(
        flushDownloadProgress,
        APP_UPDATE_PROGRESS_INTERVAL_MS,
      );
      return;
    }
    pendingDownloadProgress = progress.percent;
  };

  const applyDownloaded = (info: ElectronUpdaterUpdateInfo): void => {
    if (disposed || state.status !== "downloading") {
      return;
    }
    clearDownloadProgressThrottle();
    const downloadedVersion = info.version;
    publishState(
      markDownloaded({
        availableVersion: downloadedVersion,
        currentVersion,
        previousState: { ...state, availableVersion: downloadedVersion },
      }),
    );
  };

  const applyInstallFailure = (
    cause: unknown,
    previousState: Extract<AppUpdateState, { status: "downloaded" }>,
  ): void => {
    if (installHandoffStarted) {
      const incompatibleAppSignature = isMacOsUpdateSignatureMismatch(platform, cause);
      publishState(
        markDownloadedInstallRetryDisabled({
          cause,
          code: incompatibleAppSignature ? "incompatible_app_signature" : "install_failed",
          message: incompatibleAppSignature
            ? MANUAL_SIGNATURE_UPDATE_GUIDANCE
            : installTerminalFailureMessage(cause),
          previousState,
        }),
      );
      return;
    }

    publishState(
      markDownloadedInstallError({
        cause,
        message: appUpdateErrorMessage("install", cause),
        previousState,
      }),
    );
  };

  const applyAdapterError = (cause: unknown): void => {
    if (disposed) {
      return;
    }
    const previousState = state;
    if (previousState.status === "downloaded" && previousState.installRetryDisabled === true) {
      trackDetachedLog(() =>
        logger.warn("Ignoring Electron updater error after terminal install failure", cause),
      );
      return;
    }
    if (previousState.status === "downloading") {
      clearDownloadProgressThrottle();
    }
    const installInProgress =
      installHandoffStarted ||
      (previousState.status === "downloaded" && previousState.installRequested === true);
    const operation = activeOperation ?? (installInProgress ? "install" : "check");
    const availableVersion = availableVersionFromState(previousState);
    const checkedAt = operation === "check" ? now() : checkedAtFromState(previousState);
    const message = appUpdateErrorMessage(operation, cause);
    if (operation === "install" && previousState.status === "downloaded") {
      activeOperation = null;
      applyInstallFailure(cause, previousState);
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
      adapter.on("download-progress", applyDownloadProgress),
      adapter.on("error", applyAdapterError),
    );
  };

  const initializeUpdater = async (): Promise<boolean> => {
    if (disposed) {
      return false;
    }
    if (updaterReady) {
      return true;
    }
    if (initializationAttempted) {
      return false;
    }
    initializationAttempted = true;
    let rawConfig: string | null;
    const updateChannel = deriveElectronUpdateChannel(currentVersion);

    try {
      rawConfig = await readUpdateConfig(resolvedAppUpdateConfigPath);
    } catch (cause) {
      if (disposed) {
        return false;
      }
      setErrorState({
        code: "updater_unavailable",
        cause,
        message: `Failed to read Electron update configuration at ${resolvedAppUpdateConfigPath}: ${errorMessage(
          cause,
        )}`,
        operation: "initialize",
      });
      return false;
    }

    if (disposed) {
      return false;
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
      return false;
    }

    if (!hasProviderConfig) {
      publishState(
        createDisabledUpdateState({
          code: "missing_update_config",
          currentVersion,
          reason: `Electron update feed configuration is missing at ${resolvedAppUpdateConfigPath}.`,
        }),
      );
      return false;
    }

    try {
      adapter.configure({
        allowPrerelease: updateChannel !== null,
        autoDownload: false,
        autoInstallOnAppQuit: false,
        channel: updateChannel,
        logger,
        onLogFailure: onFatalError,
      });
      registerAdapterEvents();
      updaterReady = true;
      return true;
    } catch (cause) {
      setErrorState({
        code: "updater_unavailable",
        cause,
        message: `Electron updater initialization failed: ${errorMessage(cause)}`,
        operation: "initialize",
      });
      return false;
    }
  };

  const runBackgroundCheck = (): void => {
    if (disposed || state.status === "disabled" || (initializationAttempted && !updaterReady)) {
      return;
    }
    void service.check({ initiator: "background" }).catch(onFatalError);
  };

  const service: ElectronAppUpdateService = {
    check: async ({ initiator }) => {
      if (disposed) {
        return rejectDisposed("check");
      }
      const currentState = state;
      if (currentState.status === "disabled") {
        publishState(markDisabledManualCheck(currentState, initiator, now()));
        return rejectDisabled("check", currentState);
      }
      if (initializationAttempted && !updaterReady) {
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
      const checkBlockedByDownloadedState =
        state.status === "downloaded" &&
        (state.installRequested === true || initiator === "background");
      if (
        activeOperation !== null ||
        state.status === "downloading" ||
        checkBlockedByDownloadedState
      ) {
        return rejectBusy("check");
      }

      activeOperation = "check";
      installHandoffStarted = false;
      publishState(markChecking({ currentVersion, initiator, previousState: currentState }));
      try {
        const initialized = await initializeUpdater();
        if (disposed) {
          return rejectDisposed("check");
        }
        if (!initialized) {
          const unavailableState = state;
          if (unavailableState.status === "disabled") {
            if (initiator !== "background") {
              publishState(markDisabledManualCheck(unavailableState, initiator, now()));
            }
            return rejectDisabled("check", unavailableState);
          }
          if (unavailableState.status === "error" && initiator !== "background") {
            publishState(markErrorManualCheck(unavailableState, initiator, now()));
          }
          return rejectUpdaterUnavailable("check");
        }

        let result: ElectronUpdaterCheckResult;
        try {
          result = await adapter.checkForUpdates();
        } catch (cause) {
          if (disposed) {
            return rejectDisposed("check");
          }
          await logger.error("OpenDucktor update check failed", cause);
          setErrorState({
            checkedAt: now(),
            code: "check_failed",
            cause,
            message: appUpdateErrorMessage("check", cause),
            operation: "check",
          });
          return commandAccepted();
        }
        if (disposed) {
          return rejectDisposed("check");
        }
        if (state.status === "checking") {
          if (result.isUpdateAvailable) {
            applyAvailable(result.updateInfo.version);
          } else {
            applyUpToDate();
          }
        }
        await logger.info(`OpenDucktor update check completed (${initiator})`);
        return commandAccepted();
      } finally {
        activeOperation = null;
      }
    },
    dispose: async () => {
      if (disposed) {
        return;
      }
      disposed = true;
      if (backgroundCheckIntervalHandle !== null) {
        scheduler.clearInterval(backgroundCheckIntervalHandle);
        backgroundCheckIntervalHandle = null;
      }
      if (initialBackgroundCheckHandle !== null) {
        scheduler.clearTimeout(initialBackgroundCheckHandle);
        initialBackgroundCheckHandle = null;
      }
      clearDownloadProgressThrottle();
      listeners.clear();
      for (const unsubscribe of unsubscribeAdapterListeners.splice(0)) {
        unsubscribe();
      }
      const [detachedLogsResult, adapterResult] = await Promise.allSettled([
        drainDetachedLogs(),
        adapter.dispose(),
      ]);
      if (detachedLogsResult.status === "rejected") {
        throw detachedLogsResult.reason;
      }
      if (adapterResult.status === "rejected") {
        throw adapterResult.reason;
      }
    },
    download: async () => {
      if (disposed) {
        return rejectDisposed("download");
      }
      if (state.status === "disabled") {
        return rejectDisabled("download", state);
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
      if (!updaterReady) {
        return rejectUpdaterUnavailable("download");
      }

      activeOperation = "download";
      clearDownloadProgressThrottle();
      const availableVersion = state.availableVersion;
      publishState(
        markDownloading({
          availableVersion,
          currentVersion,
          previousState: state,
        }),
      );
      try {
        let result: ElectronUpdaterUpdateInfo;
        try {
          result = await adapter.downloadUpdate();
        } catch (cause) {
          if (disposed) {
            return rejectDisposed("download");
          }
          clearDownloadProgressThrottle();
          await logger.error("OpenDucktor update download failed", cause);
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
        }
        if (disposed) {
          return rejectDisposed("download");
        }
        applyDownloaded(result);
        await logger.info("OpenDucktor update download completed");
        return commandAccepted();
      } finally {
        activeOperation = null;
      }
    },
    getState: () => state,
    install: async () => {
      if (disposed) {
        return rejectDisposed("install");
      }
      if (state.status === "disabled") {
        return rejectDisabled("install", state);
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
      if (!updaterReady) {
        return rejectUpdaterUnavailable("install");
      }

      activeOperation = "install";
      installHandoffStarted = false;
      publishState(markDownloadedInstallRequested(downloadedState));
      try {
        const installHandoff = await adapter.prepareInstall();
        if (disposed) {
          return rejectDisposed("install");
        }
        installHandoffStarted = true;
        await installDownloadedUpdate(installHandoff);
        if (disposed) {
          return rejectDisposed("install");
        }
        return commandAccepted();
      } catch (cause) {
        if (disposed) {
          return rejectDisposed("install");
        }
        await logger.error("OpenDucktor update install failed", cause);
        const previousState = state.status === "downloaded" ? state : downloadedState;
        applyInstallFailure(cause, previousState);
        return commandAccepted();
      } finally {
        activeOperation = null;
      }
    },
    startBackgroundChecks: () => {
      if (disposed || state.status === "disabled" || backgroundCheckIntervalHandle !== null) {
        return;
      }
      initialBackgroundCheckHandle = scheduler.setTimeout(() => {
        initialBackgroundCheckHandle = null;
        runBackgroundCheck();
      }, INITIAL_APP_UPDATE_CHECK_DELAY_MS);
      backgroundCheckIntervalHandle = scheduler.setInterval(
        runBackgroundCheck,
        backgroundCheckIntervalMs,
      );
    },
    subscribe: (listener) => {
      if (disposed) {
        return () => {};
      }
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };

  return service;
};
