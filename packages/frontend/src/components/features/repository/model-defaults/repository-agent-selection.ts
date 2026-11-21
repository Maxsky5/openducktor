import type { RuntimeKind } from "@openducktor/contracts";
import {
  type AgentModelCatalog,
  type AgentModelSelection,
  resolveModelSelectionForPair,
} from "@openducktor/core";
import type { ModelPickerValue } from "@openducktor/frontend-core/sessions/model-selection/model-picker-model";
import type {
  ModelDefaultDraft,
  RepoAgentDefaultDraft,
} from "@openducktor/frontend-core/lib/repo-agent-defaults";
import { ensureDraftAgentDefault } from "./model-defaults-model";

export const resolveRepoAgentDefaultModelPickerSelection = ({
  currentValue,
  currentRuntimeKind,
  targetCatalog,
  value,
}: {
  currentValue: ReturnType<typeof ensureDraftAgentDefault> | null;
  currentRuntimeKind: RuntimeKind | null;
  targetCatalog: AgentModelCatalog;
  value: ModelPickerValue;
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
  }
  const resolvedPair = resolveModelSelectionForPair({
    catalog: targetCatalog,
    // A model default has no speed, so no speed label to match.
    currentCatalog: null,
    currentSelection,
    defaultSelection: null,
    selectedModel: null,
    value,
  });
  if (!resolvedPair) {
    return null;
  }
  return {
    runtimeKind: value.runtimeKind,
    providerId: resolvedPair.selection.providerId,
    modelId: resolvedPair.selection.modelId,
    variant: resolvedPair.selection.variant ?? "",
    profileId: resolvedPair.selection.profileId ?? "",
  };
};

/** The model that a picker choice selects, from the current draft, or null for no change. */
export const selectPickedModel = (
  current: RepoAgentDefaultDraft | null | undefined,
  value: ModelPickerValue,
  targetCatalog: AgentModelCatalog,
) =>
  resolveRepoAgentDefaultModelPickerSelection({
    currentValue: current ? ensureDraftAgentDefault(current) : null,
    currentRuntimeKind: current?.runtimeKind ?? null,
    targetCatalog,
    value,
  });
