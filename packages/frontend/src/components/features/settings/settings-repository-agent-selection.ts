import type { RuntimeKind } from "@openducktor/contracts";
import type { AgentModelCatalog } from "@openducktor/core";
import type { ModelPickerValue } from "@/components/features/agents/model-picker";
import { resolveModelSelectionForPair } from "@/features/model-selection/model-selection-state";
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
  const currentSelection =
    currentValue && currentRuntimeKind
      ? {
          runtimeKind: currentRuntimeKind,
          providerId: currentValue.providerId,
          modelId: currentValue.modelId,
          ...(currentValue.variant ? { variant: currentValue.variant } : undefined),
          ...(currentValue.profileId ? { profileId: currentValue.profileId } : undefined),
        }
      : null;
  const resolvedPair = resolveModelSelectionForPair({
    catalog: targetCatalog,
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
