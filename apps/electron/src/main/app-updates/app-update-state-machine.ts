import type {
  AppUpdateCheckInitiator,
  AppUpdateError,
  AppUpdateErrorCode,
  AppUpdateOperation,
  AppUpdateState,
} from "@openducktor/contracts";

type DisabledAppUpdateState = Extract<AppUpdateState, { status: "disabled" }>;
type DownloadingAppUpdateState = Extract<AppUpdateState, { status: "downloading" }>;
type DownloadedAppUpdateState = Extract<AppUpdateState, { status: "downloaded" }>;
type ErrorAppUpdateState = Extract<AppUpdateState, { status: "error" }>;
type AppUpdateStateWithAvailableVersion = AppUpdateState & { availableVersion: string };

const availableVersionFromState = (state: AppUpdateState | undefined): string | undefined =>
  state && "availableVersion" in state ? state.availableVersion : undefined;

const checkInitiatorFromState = (
  state: AppUpdateState | undefined,
): AppUpdateCheckInitiator | undefined =>
  state && "checkInitiator" in state ? state.checkInitiator : undefined;

const checkedAtFromState = (state: AppUpdateState | undefined): string | undefined =>
  state && "checkedAt" in state ? state.checkedAt : undefined;

const progressPercentFromState = (state: AppUpdateState | undefined): number | undefined =>
  state && "progressPercent" in state ? state.progressPercent : undefined;

const errorCauseName = (cause: unknown): string | undefined =>
  cause instanceof Error ? cause.name : undefined;

export const createUpdateError = ({
  cause,
  code,
  details,
  message,
  operation,
}: {
  cause?: unknown;
  code: AppUpdateErrorCode;
  details?: AppUpdateError["details"];
  message: string;
  operation: AppUpdateOperation;
}): AppUpdateError => {
  const causeName = errorCauseName(cause);
  const error: AppUpdateError = {
    code,
    message,
    operation,
  };
  if (causeName) error.causeName = causeName;
  if (details !== undefined) error.details = details;
  return error;
};

export const createDisabledUpdateState = ({
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

export const markDisabledManualCheck = (
  state: DisabledAppUpdateState,
  initiator: AppUpdateCheckInitiator,
  checkedAt: string,
): AppUpdateState => ({
  ...state,
  checkInitiator: initiator,
  checkedAt,
});

export const markErrorManualCheck = (
  state: ErrorAppUpdateState,
  initiator: AppUpdateCheckInitiator,
  checkedAt: string,
): AppUpdateState => ({
  ...state,
  checkInitiator: initiator,
  checkedAt,
});

export const markChecking = ({
  currentVersion,
  initiator,
  previousState,
}: {
  currentVersion: string;
  initiator: AppUpdateCheckInitiator;
  previousState?: AppUpdateState;
}): AppUpdateState => {
  const state: Extract<AppUpdateState, { status: "checking" }> = {
    status: "checking",
    currentVersion,
    checkInitiator: initiator,
  };
  const availableVersion = availableVersionFromState(previousState);
  if (availableVersion) state.availableVersion = availableVersion;
  const checkedAt = checkedAtFromState(previousState);
  if (checkedAt) state.checkedAt = checkedAt;
  return state;
};

export const markAvailable = ({
  availableVersion,
  checkedAt,
  currentVersion,
  previousState,
}: {
  availableVersion: string;
  checkedAt: string;
  currentVersion: string;
  previousState: AppUpdateState;
}): AppUpdateState => {
  const state: Extract<AppUpdateState, { status: "available" }> = {
    status: "available",
    currentVersion,
    availableVersion,
    checkedAt,
  };
  const checkInitiator = checkInitiatorFromState(previousState);
  if (checkInitiator) state.checkInitiator = checkInitiator;
  return state;
};

export const markUpToDate = ({
  checkedAt,
  currentVersion,
  previousState,
}: {
  checkedAt: string;
  currentVersion: string;
  previousState: AppUpdateState;
}): AppUpdateState => {
  const state: Extract<AppUpdateState, { status: "upToDate" }> = {
    status: "upToDate",
    currentVersion,
    checkedAt,
  };
  const checkInitiator = checkInitiatorFromState(previousState);
  if (checkInitiator) state.checkInitiator = checkInitiator;
  return state;
};

const clampProgressPercent = (percent: number): number => Math.max(0, Math.min(100, percent));

export const markDownloading = ({
  availableVersion,
  currentVersion,
  previousState,
}: {
  availableVersion: string;
  currentVersion: string;
  previousState: AppUpdateStateWithAvailableVersion;
}): AppUpdateState => {
  const state: Extract<AppUpdateState, { status: "downloading" }> = {
    status: "downloading",
    currentVersion,
    availableVersion,
    progressPercent: progressPercentFromState(previousState) ?? 0,
  };
  const checkInitiator = checkInitiatorFromState(previousState);
  if (checkInitiator) state.checkInitiator = checkInitiator;
  const checkedAt = checkedAtFromState(previousState);
  if (checkedAt) state.checkedAt = checkedAt;
  return state;
};

export const markDownloadProgress = ({
  currentVersion,
  percent,
  previousState,
}: {
  currentVersion: string;
  percent: number;
  previousState: DownloadingAppUpdateState;
}): AppUpdateState => {
  const state: Extract<AppUpdateState, { status: "downloading" }> = {
    status: "downloading",
    currentVersion,
    availableVersion: previousState.availableVersion,
    progressPercent: clampProgressPercent(percent),
  };
  const checkInitiator = checkInitiatorFromState(previousState);
  if (checkInitiator) state.checkInitiator = checkInitiator;
  const checkedAt = checkedAtFromState(previousState);
  if (checkedAt) state.checkedAt = checkedAt;
  return state;
};

export const markDownloaded = ({
  availableVersion,
  currentVersion,
  previousState,
}: {
  availableVersion: string;
  currentVersion: string;
  previousState: AppUpdateStateWithAvailableVersion;
}): AppUpdateState => {
  const state: Extract<AppUpdateState, { status: "downloaded" }> = {
    status: "downloaded",
    currentVersion,
    availableVersion,
    progressPercent: 100,
  };
  const checkInitiator = checkInitiatorFromState(previousState);
  if (checkInitiator) state.checkInitiator = checkInitiator;
  const checkedAt = checkedAtFromState(previousState);
  if (checkedAt) state.checkedAt = checkedAt;
  return state;
};

export const markDownloadedInstallRequested = (
  previousState: DownloadedAppUpdateState,
): AppUpdateState => {
  const {
    error: _error,
    installRequested: _installRequested,
    installRetryDisabled: _installRetryDisabled,
    ...installState
  } = previousState;
  return {
    ...installState,
    installRequested: true,
  };
};

export const updateErrorCodeForOperation = (
  operation: AppUpdateOperation,
): "check_failed" | "download_failed" | "install_failed" => {
  if (operation === "download") {
    return "download_failed";
  }
  if (operation === "install") {
    return "install_failed";
  }
  return "check_failed";
};

export const markUpdateError = ({
  availableVersion,
  checkedAt,
  code,
  cause,
  currentVersion,
  message,
  operation,
  previousState,
}: {
  availableVersion?: string;
  checkedAt?: string;
  code: AppUpdateErrorCode;
  cause?: unknown;
  currentVersion: string;
  message: string;
  operation: AppUpdateOperation;
  previousState: AppUpdateState;
}): AppUpdateState => {
  const resolvedAvailableVersion = availableVersion ?? availableVersionFromState(previousState);
  const checkInitiator = checkInitiatorFromState(previousState);
  const state: Extract<AppUpdateState, { status: "error" }> = {
    status: "error",
    currentVersion,
    error: createUpdateError({ cause, code, message, operation }),
  };
  if (resolvedAvailableVersion) state.availableVersion = resolvedAvailableVersion;
  if (checkInitiator) state.checkInitiator = checkInitiator;
  if (checkedAt) state.checkedAt = checkedAt;
  return state;
};

export const markDownloadedInstallError = ({
  cause,
  message,
  previousState,
}: {
  cause?: unknown;
  message: string;
  previousState: DownloadedAppUpdateState;
}): AppUpdateState => {
  const {
    installRequested: _installRequested,
    installRetryDisabled: _installRetryDisabled,
    ...retryableState
  } = previousState;
  return {
    ...retryableState,
    error: createUpdateError({
      cause,
      code: "install_failed",
      message,
      operation: "install",
    }),
  };
};

export const markDownloadedInstallRetryDisabled = ({
  cause,
  code,
  message,
  previousState,
}: {
  cause?: unknown;
  code: AppUpdateErrorCode;
  message: string;
  previousState: DownloadedAppUpdateState;
}): AppUpdateState => {
  const { installRequested: _installRequested, ...terminalState } = previousState;
  return {
    ...terminalState,
    installRetryDisabled: true,
    error: createUpdateError({
      cause,
      code,
      message,
      operation: "install",
    }),
  };
};
