import type { RuntimeKind } from "@openducktor/contracts";
import type { AgentModelCatalog } from "@openducktor/core";
import type { ModelPickerValue } from "@/components/features/agents/model-picker";
import {
  resolveModelSelectionForModelChange,
  resolveModelSelectionForRuntimeChange,
} from "@/features/agent-chat-composer/model-selection/model-selection-state";
import type { ensureDraftAgentDefault } from "./settings-modal-model";

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
}): ReturnType<typeof ensureDraftAgentDefault> | null => {
  const hasExactModel = targetCatalog.models.some(
    (model) => model.providerId === value.providerId && model.modelId === value.modelId,
  );
  if (!hasExactModel) {
    return null;
  }
  const currentSelection =
    currentValue && currentRuntimeKind
      ? {
          runtimeKind: currentRuntimeKind,
          providerId: currentValue.providerId,
          modelId: currentValue.modelId,
          ...(currentValue.variant ? { variant: currentValue.variant } : {}),
          ...(currentValue.profileId ? { profileId: currentValue.profileId } : {}),
        }
      : null;
  const runtimeSelection = resolveModelSelectionForRuntimeChange({
    catalog: targetCatalog,
    currentSelection,
    defaultSelection: null,
    selectedModel: null,
    runtimeKind: value.runtimeKind,
  });
  const nextSelection = resolveModelSelectionForModelChange({
    catalog: targetCatalog,
    currentSelection: runtimeSelection,
    modelKey: `${value.providerId}/${value.modelId}`,
    runtimeKind: value.runtimeKind,
  });
  if (!nextSelection) {
    return null;
  }
  return {
    runtimeKind: value.runtimeKind,
    providerId: nextSelection.providerId,
    modelId: nextSelection.modelId,
    variant: nextSelection.variant ?? "",
    profileId: nextSelection.profileId ?? "",
  };
};
