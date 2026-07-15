import {
  type AppUpdateError,
  type AppUpdateState,
  canDownloadAppUpdate,
  canInstallAppUpdate,
} from "@openducktor/contracts";

export type AppUpdateBadgeVariant =
  | "default"
  | "secondary"
  | "outline"
  | "success"
  | "warning"
  | "danger";

export type AppUpdateStatusDisplay = {
  badgeVariant: AppUpdateBadgeVariant;
  description?: string;
  label: string;
};

export const appUpdateErrorPanelClassName =
  "max-h-40 overflow-y-auto break-words whitespace-pre-wrap rounded-md border border-destructive/30 bg-destructive-surface/60 px-3 py-2 text-xs text-destructive-surface-foreground";
export const appUpdateManualRecoveryPanelClassName =
  "max-h-40 overflow-y-auto break-words whitespace-pre-wrap rounded-md border border-warning-border bg-warning-surface px-3 py-2 text-xs text-warning-surface-foreground";

export const getAppUpdateAvailableVersion = (state: AppUpdateState): string | undefined =>
  "availableVersion" in state ? state.availableVersion : undefined;

export const getAppUpdateCheckedAt = (state: AppUpdateState): string | undefined =>
  "checkedAt" in state ? state.checkedAt : undefined;

export const getAppUpdateDisabledReason = (state: AppUpdateState): string | undefined =>
  "disabledReason" in state ? state.disabledReason : undefined;

export const getAppUpdateError = (state: AppUpdateState): AppUpdateError | undefined =>
  "error" in state ? state.error : undefined;

export const getAppUpdateProgressPercent = (state: AppUpdateState): number | undefined =>
  "progressPercent" in state ? state.progressPercent : undefined;

export const isMenuUpdateCheckState = (state: AppUpdateState): boolean =>
  "checkInitiator" in state && state.checkInitiator === "menu";

export const isActionableUpdateError = (state: AppUpdateState): boolean => {
  const error = getAppUpdateError(state);
  if (state.status !== "error" || !error) {
    return false;
  }
  return canDownloadAppUpdate(state) || error.operation === "install";
};

export const canDownloadUpdate = canDownloadAppUpdate;

export const canInstallUpdate = canInstallAppUpdate;

export const requiresManualAppUpdate = (state: AppUpdateState): boolean =>
  state.status === "downloaded" &&
  state.installRetryDisabled === true &&
  state.error?.code === "incompatible_app_signature";

export const getAppUpdateErrorPanelClassName = (state: AppUpdateState): string =>
  requiresManualAppUpdate(state)
    ? appUpdateManualRecoveryPanelClassName
    : appUpdateErrorPanelClassName;

const getErrorStatusDescription = (state: AppUpdateState): string => {
  const operation = state.status === "error" ? state.error.operation : undefined;
  if (operation === "initialize") {
    return "OpenDucktor could not initialize the updater.";
  }
  if (operation === "check") {
    return "OpenDucktor could not complete the update check.";
  }
  if (operation === "download") {
    return "OpenDucktor could not download the update.";
  }
  if (operation === "install") {
    return "OpenDucktor could not start the update install.";
  }
  return "OpenDucktor could not complete the update action.";
};

export const getAppUpdateStatusDisplay = (state: AppUpdateState): AppUpdateStatusDisplay => {
  if (state.status === "disabled") {
    if (state.disabledCode === "unsupported_web_runner") {
      return {
        badgeVariant: "outline",
        label: "Browser runner",
        description: state.disabledReason,
      };
    }
    if (state.disabledCode === "not_packaged") {
      return {
        badgeVariant: "outline",
        label: "Development build",
        description: "Automatic updates are disabled while running OpenDucktor in development.",
      };
    }
    return {
      badgeVariant: "outline",
      label: "Updates unavailable",
      description: state.disabledReason ?? "Updates are unavailable in this runtime.",
    };
  }
  if (state.status === "checking") {
    return {
      badgeVariant: "secondary",
      label: "Checking for updates",
      description: "Looking for a newer OpenDucktor release.",
    };
  }
  if (state.status === "upToDate") {
    return {
      badgeVariant: "success",
      label: "OpenDucktor is up to date",
      description: "No newer packaged release is available.",
    };
  }
  if (state.status === "available") {
    return {
      badgeVariant: "warning",
      label: "Update available",
    };
  }
  if (state.status === "downloading") {
    return {
      badgeVariant: "secondary",
      label: "Downloading update",
    };
  }
  if (state.status === "downloaded") {
    if (state.installRetryDisabled === true) {
      if (requiresManualAppUpdate(state)) {
        return {
          badgeVariant: "warning",
          label: "Manual update required",
        };
      }
      return {
        badgeVariant: "danger",
        label: "Install needs attention",
        description: "Automatic installation stopped.",
      };
    }
    if (state.installRequested === true) {
      return {
        badgeVariant: "secondary",
        label: "Installing update",
        description: "Installing... Keep the app open.",
      };
    }
    return {
      badgeVariant: "success",
      label: "Ready to install",
    };
  }
  if (state.status === "error") {
    return {
      badgeVariant: "danger",
      label: "Update error",
      description: getErrorStatusDescription(state),
    };
  }
  return {
    badgeVariant: "outline",
    label: "Updates ready",
    description: "OpenDucktor will ask before downloading or installing updates.",
  };
};

export const getAppUpdatePromptKey = (state: AppUpdateState): string => {
  const version = getAppUpdateAvailableVersion(state) ?? state.currentVersion;
  const error = getAppUpdateError(state);
  const checkedAt = getAppUpdateCheckedAt(state);
  const marker = error
    ? `${error.operation}:${error.code}:${checkedAt ?? ""}:${error.message}`
    : (checkedAt ?? getAppUpdateDisabledReason(state) ?? "");
  return `${state.status}:${version}:${marker}`;
};
