import type { AgentSessionStartMode } from "@openducktor/core";

const START_MODE_DISPLAY_ORDER = {
  fresh: 0,
  reuse: 1,
  fork: 2,
} satisfies Record<AgentSessionStartMode, number>;

export const orderStartModesForDisplay = (
  startModes: readonly AgentSessionStartMode[],
): AgentSessionStartMode[] => {
  return startModes.toSorted(
    (left, right) => START_MODE_DISPLAY_ORDER[left] - START_MODE_DISPLAY_ORDER[right],
  );
};

export const sessionStartModeButtonLabel = (startMode: AgentSessionStartMode): string => {
  if (startMode === "fresh") {
    return "Start fresh";
  }
  if (startMode === "reuse") {
    return "Reuse existing";
  }
  return "Fork existing";
};

/** A start mode that needs a source session is unavailable when the task has none. */
export const isSessionStartModeUnavailable = (
  startMode: AgentSessionStartMode,
  hasExistingSessionOptions: boolean,
): boolean => (startMode === "reuse" || startMode === "fork") && !hasExistingSessionOptions;

export const sessionStartVariantPlaceholder = ({
  isSelectionCatalogLoading,
  hasSelectedModel,
  supportsVariants,
  variantCount,
}: {
  isSelectionCatalogLoading: boolean;
  hasSelectedModel: boolean;
  supportsVariants: boolean;
  variantCount: number;
}): string => {
  if (isSelectionCatalogLoading) {
    return "Checking compatibility...";
  }
  if (!hasSelectedModel) {
    return "Select model first";
  }
  if (!supportsVariants) {
    return "Effort handled by runtime";
  }
  if (variantCount === 0) {
    return "This model has no effort options";
  }
  return "Select effort";
};

export const sessionStartRuntimeProfileHelperText = ({
  runtimeProfileCount,
  isReuseMode,
  isSelectionCatalogLoading,
}: {
  runtimeProfileCount: number;
  isReuseMode: boolean;
  isSelectionCatalogLoading: boolean;
}): string | null => {
  if (isReuseMode) {
    return "Reuse mode keeps the previous session runtime profile, model, and effort.";
  }
  if (isSelectionCatalogLoading) {
    return "Loading profiles for the selected runtime.";
  }
  if (runtimeProfileCount === 0) {
    return "No profiles are available for this runtime.";
  }
  return null;
};

/** Why the model choice is read-only during a reuse or a running start. */
export const sessionStartModelReadOnlyReason = (isStarting: boolean): string =>
  isStarting
    ? "Session start is in progress."
    : "Reuse mode keeps the source session runtime and model.";

export const sessionStartModelPlaceholder = (isSelectionCatalogLoading: boolean): string =>
  isSelectionCatalogLoading ? "Loading models..." : "Select a model";

export const sessionStartTargetBranchPlaceholder = (branchCount: number): string =>
  branchCount > 0 ? "Select branch..." : "Branches unavailable";
