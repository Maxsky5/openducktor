import type {
  AppUpdateCheckInitiator,
  AppUpdateError,
  AppUpdateErrorCode,
  AppUpdateOperation,
  AppUpdateState,
} from "@openducktor/contracts";

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
  details?: Record<string, unknown>;
  message: string;
  operation: AppUpdateOperation;
}): AppUpdateError => {
  const causeName = errorCauseName(cause);
  return {
    code,
    message,
    operation,
    ...(causeName ? { causeName } : {}),
    ...(details === undefined ? {} : { details }),
  };
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
  state: AppUpdateState,
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
}: {
  currentVersion: string;
  initiator: AppUpdateCheckInitiator;
}): AppUpdateState => ({
  status: "checking",
  currentVersion,
  checkInitiator: initiator,
});

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
}): AppUpdateState => ({
  status: "available",
  currentVersion,
  availableVersion,
  ...(previousState.checkInitiator ? { checkInitiator: previousState.checkInitiator } : {}),
  checkedAt,
});

export const markUpToDate = ({
  checkedAt,
  currentVersion,
  previousState,
}: {
  checkedAt: string;
  currentVersion: string;
  previousState: AppUpdateState;
}): AppUpdateState => ({
  status: "upToDate",
  currentVersion,
  ...(previousState.checkInitiator ? { checkInitiator: previousState.checkInitiator } : {}),
  checkedAt,
});

const clampProgressPercent = (percent: number): number => Math.max(0, Math.min(100, percent));

export const markDownloading = ({
  availableVersion,
  currentVersion,
  previousState,
}: {
  availableVersion?: string;
  currentVersion: string;
  previousState: AppUpdateState;
}): AppUpdateState => ({
  status: "downloading",
  currentVersion,
  ...(availableVersion ? { availableVersion } : {}),
  progressPercent: previousState.progressPercent ?? 0,
  ...(previousState.checkInitiator ? { checkInitiator: previousState.checkInitiator } : {}),
  ...(previousState.checkedAt ? { checkedAt: previousState.checkedAt } : {}),
});

export const markDownloadProgress = ({
  currentVersion,
  percent,
  previousState,
}: {
  currentVersion: string;
  percent: number;
  previousState: AppUpdateState;
}): AppUpdateState => ({
  status: "downloading",
  currentVersion,
  ...(previousState.availableVersion ? { availableVersion: previousState.availableVersion } : {}),
  progressPercent: clampProgressPercent(percent),
  ...(previousState.checkInitiator ? { checkInitiator: previousState.checkInitiator } : {}),
  ...(previousState.checkedAt ? { checkedAt: previousState.checkedAt } : {}),
});

export const markDownloaded = ({
  availableVersion,
  currentVersion,
  previousState,
}: {
  availableVersion?: string;
  currentVersion: string;
  previousState: AppUpdateState;
}): AppUpdateState => ({
  status: "downloaded",
  currentVersion,
  ...(availableVersion ? { availableVersion } : {}),
  progressPercent: 100,
  ...(previousState.checkInitiator ? { checkInitiator: previousState.checkInitiator } : {}),
  ...(previousState.checkedAt ? { checkedAt: previousState.checkedAt } : {}),
});

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
}): AppUpdateState => ({
  status: "error",
  currentVersion,
  ...(availableVersion ? { availableVersion } : {}),
  ...(previousState.checkInitiator ? { checkInitiator: previousState.checkInitiator } : {}),
  ...(checkedAt ? { checkedAt } : {}),
  error: createUpdateError({ cause, code, message, operation }),
});

export const markDownloadedInstallError = ({
  cause,
  message,
  previousState,
}: {
  cause?: unknown;
  message: string;
  previousState: AppUpdateState;
}): AppUpdateState => ({
  ...previousState,
  error: createUpdateError({
    cause,
    code: "install_failed",
    message,
    operation: "install",
  }),
});
