import type { AppUpdateState } from "@openducktor/contracts";

export type AppUpdateBadgeVariant =
  | "default"
  | "secondary"
  | "outline"
  | "success"
  | "warning"
  | "danger";

export type AppUpdateStatusDisplay = {
  badgeVariant: AppUpdateBadgeVariant;
  description: string;
  label: string;
};

export const isManualUpdateCheckState = (state: AppUpdateState): boolean =>
  state.checkInitiator === "settings" || state.checkInitiator === "menu";

export const isActionableUpdateError = (state: AppUpdateState): boolean =>
  state.status === "error" &&
  Boolean(state.availableVersion) &&
  (state.error?.operation === "download" || state.error?.operation === "install");

export const canDownloadUpdate = (state: AppUpdateState): boolean =>
  state.status === "available" ||
  (state.status === "error" &&
    state.error?.operation === "download" &&
    Boolean(state.availableVersion));

export const canInstallUpdate = (state: AppUpdateState): boolean => state.status === "downloaded";

export const getAppUpdateStatusDisplay = (state: AppUpdateState): AppUpdateStatusDisplay => {
  if (state.status === "disabled") {
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
      description: "Download starts only when you choose it.",
    };
  }
  if (state.status === "downloading") {
    return {
      badgeVariant: "secondary",
      label: "Downloading update",
      description: "The update is downloading. Restart waits for your confirmation.",
    };
  }
  if (state.status === "downloaded") {
    return {
      badgeVariant: "success",
      label: "Ready to install",
      description: "Restart OpenDucktor when you are ready to install the update.",
    };
  }
  if (state.status === "error") {
    return {
      badgeVariant: "danger",
      label: "Update error",
      description: state.error?.message ?? "OpenDucktor could not complete the update action.",
    };
  }
  return {
    badgeVariant: "outline",
    label: "Updates ready",
    description: "OpenDucktor will ask before downloading or installing updates.",
  };
};

export const getAppUpdatePromptKey = (state: AppUpdateState): string => {
  const version = state.availableVersion ?? state.currentVersion;
  const marker = state.checkedAt ?? state.error?.message ?? state.disabledReason ?? "";
  return `${state.status}:${version}:${marker}`;
};
