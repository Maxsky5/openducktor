import type { RuntimeKind } from "@openducktor/contracts";
import {
  type AgentModelCatalog,
  type AgentModelSelection,
  resolveModelSelectionForPair,
  STANDARD_SPEED,
} from "@openducktor/core";
import type { ModelPickerValue } from "@openducktor/frontend-core/sessions/model-selection/model-picker-model";
import { SPEED_RESET_TO_STANDARD_NOTICE } from "@openducktor/frontend-core/sessions/model-selection/model-picker-presentation";
import type {
  ModelDefaultDraft,
  RepoAgentDefaultDraft,
} from "@openducktor/frontend-core/lib/repo-agent-defaults";
import { ensureDraftAgentDefault } from "./model-defaults-model";

export const REPOSITORY_SPEED_RESET_NOTICE = SPEED_RESET_TO_STANDARD_NOTICE;

export const didResetDefaultSpeed = (
  previous: { speed?: string | undefined } | null | undefined,
  next: { speed?: string | undefined } | null | undefined,
): boolean => {
  const previousSpeed = previous?.speed?.trim();
  const nextSpeed = next?.speed?.trim();
  return Boolean(
    previousSpeed &&
    previousSpeed !== STANDARD_SPEED &&
    (!nextSpeed || nextSpeed === STANDARD_SPEED),
  );
};

export const resolveRepoAgentDefaultModelPickerSelection = ({
  currentValue,
  currentRuntimeKind,
  currentCatalog = null,
  targetCatalog,
  value,
  includeSpeed = true,
}: {
  currentValue: ReturnType<typeof ensureDraftAgentDefault> | null;
  currentRuntimeKind: RuntimeKind | null;
  currentCatalog?: AgentModelCatalog | null;
  targetCatalog: AgentModelCatalog;
  value: ModelPickerValue;
  includeSpeed?: boolean;
}): ModelDefaultDraft | null => {
  let currentSelection: AgentModelSelection | null = null;
  if (currentValue && currentRuntimeKind) {
    currentSelection = {
      runtimeKind: currentRuntimeKind,
      providerId: currentValue.providerId,
      modelId: currentValue.modelId,
    };
    if (currentValue.variant) {
      currentSelection.variant = currentValue.variant;
    }
    if (currentValue.profileId) {
      currentSelection.profileId = currentValue.profileId;
    }
    const currentSpeed = currentValue.speed?.trim();
    if (includeSpeed && currentSpeed && currentSpeed !== STANDARD_SPEED) {
      currentSelection.speed = currentSpeed;
    }
  }
  const resolvedPair = resolveModelSelectionForPair({
    catalog: targetCatalog,
    currentCatalog: includeSpeed ? currentCatalog : null,
    currentSelection,
    defaultSelection: null,
    selectedModel: null,
    value,
  });
  if (!resolvedPair) {
    return null;
  }
  const nextDraft: ModelDefaultDraft = {
    runtimeKind: value.runtimeKind,
    providerId: resolvedPair.selection.providerId,
    modelId: resolvedPair.selection.modelId,
    variant: resolvedPair.selection.variant ?? "",
    profileId: resolvedPair.selection.profileId ?? "",
  };
  if (
    includeSpeed &&
    resolvedPair.selection.speed &&
    resolvedPair.selection.speed !== STANDARD_SPEED
  ) {
    nextDraft.speed = resolvedPair.selection.speed;
  }
  return nextDraft;
};

/** The model that a picker choice selects, from the current draft, or null for no change. */
export const selectPickedModel = (
  current: RepoAgentDefaultDraft | null | undefined,
  value: ModelPickerValue,
  targetCatalog: AgentModelCatalog,
  options?: {
    currentCatalog?: AgentModelCatalog | null;
    includeSpeed?: boolean;
  },
) =>
  resolveRepoAgentDefaultModelPickerSelection({
    currentValue: current ? ensureDraftAgentDefault(current) : null,
    currentRuntimeKind: current?.runtimeKind ?? null,
    currentCatalog: options?.currentCatalog ?? null,
    targetCatalog,
    value,
    includeSpeed: options?.includeSpeed ?? true,
  });

/**
 * Applies a picked model to a repository defaults draft through a reducer-safe updater and reports
 * when the new model caused a saved non-standard speed to reset to Standard.
 */
export const applyPickedModelDraft = <TConfig>({
  currentConfig,
  readCurrent,
  resolveRuntimeKind,
  getCatalogForRuntime,
  targetCatalog,
  value,
  applyNext,
  updateConfig,
  onSpeedReset,
}: {
  currentConfig: TConfig;
  readCurrent: (config: TConfig) => RepoAgentDefaultDraft | null | undefined;
  resolveRuntimeKind: (config: TConfig) => RuntimeKind | null;
  getCatalogForRuntime: (runtimeKind: RuntimeKind) => AgentModelCatalog | null;
  targetCatalog: AgentModelCatalog;
  value: ModelPickerValue;
  applyNext: (config: TConfig, next: ModelDefaultDraft) => TConfig;
  updateConfig: (updater: (current: TConfig) => TConfig) => void;
  onSpeedReset: () => void;
}): void => {
  const resolveFor = (config: TConfig): ModelDefaultDraft | null => {
    const currentValue = readCurrent(config) ?? null;
    const currentRuntimeKind = resolveRuntimeKind(config);
    return resolveRepoAgentDefaultModelPickerSelection({
      currentValue: currentValue ? ensureDraftAgentDefault(currentValue) : null,
      currentRuntimeKind,
      currentCatalog: currentRuntimeKind ? getCatalogForRuntime(currentRuntimeKind) : null,
      targetCatalog,
      value,
      includeSpeed: true,
    });
  };

  const previewCurrent = readCurrent(currentConfig) ?? null;
  const previewNext = resolveFor(currentConfig);
  updateConfig((repoConfig) => {
    const next = resolveFor(repoConfig);
    return next ? applyNext(repoConfig, next) : repoConfig;
  });
  if (previewNext && didResetDefaultSpeed(previewCurrent, previewNext)) {
    onSpeedReset();
  }
};
