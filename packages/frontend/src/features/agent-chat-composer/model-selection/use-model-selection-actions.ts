import type { RuntimeKind } from "@openducktor/contracts";
import type { AgentModelCatalog, AgentModelSelection } from "@openducktor/core";
import { useCallback } from "react";
import { catalogModelOptionValue } from "@/components/features/agents";

export const useModelSelectionActions = ({
  activeExternalSessionId,
  updateAgentSessionModel,
  applyDraftSelection,
  selectedModelSelection,
  selectionCatalog,
  selectedRuntimeKind,
}: {
  activeExternalSessionId: string | null;
  updateAgentSessionModel: (
    externalSessionId: string,
    selection: AgentModelSelection | null,
  ) => void;
  applyDraftSelection: (selection: AgentModelSelection | null) => void;
  selectedModelSelection: AgentModelSelection | null;
  selectionCatalog: AgentModelCatalog | null;
  selectedRuntimeKind: RuntimeKind | null;
}): {
  handleSelectAgentProfile: (profileId: string) => void;
  handleSelectModel: (modelKey: string) => void;
  handleSelectVariant: (variant: string) => void;
} => {
  const applySelection = useCallback(
    (selection: AgentModelSelection | null): void => {
      if (activeExternalSessionId) {
        updateAgentSessionModel(activeExternalSessionId, selection);
        return;
      }
      applyDraftSelection(selection);
    },
    [activeExternalSessionId, applyDraftSelection, updateAgentSessionModel],
  );

  const handleSelectAgentProfile = useCallback(
    (profileId: string) => {
      const baseSelection =
        selectedModelSelection ??
        (() => {
          const firstModel = selectionCatalog?.models[0];
          if (!firstModel || !selectedRuntimeKind) {
            return null;
          }
          return {
            runtimeKind: selectedRuntimeKind,
            providerId: firstModel.providerId,
            modelId: firstModel.modelId,
            ...(firstModel.variants[0] ? { variant: firstModel.variants[0] } : {}),
          } satisfies AgentModelSelection;
        })();
      if (!baseSelection) {
        return;
      }
      applySelection({ ...baseSelection, profileId });
    },
    [applySelection, selectedRuntimeKind, selectedModelSelection, selectionCatalog],
  );

  const handleSelectModel = useCallback(
    (nextValue: string) => {
      if (!selectionCatalog || !selectedRuntimeKind) {
        return;
      }
      const model = selectionCatalog.models.find(
        (entry) => catalogModelOptionValue(entry) === nextValue,
      );
      if (!model) {
        return;
      }
      applySelection({
        runtimeKind: selectedRuntimeKind,
        providerId: model.providerId,
        modelId: model.modelId,
        ...(model.variants[0] ? { variant: model.variants[0] } : {}),
        ...(selectedModelSelection?.profileId
          ? { profileId: selectedModelSelection.profileId }
          : {}),
      });
    },
    [applySelection, selectedRuntimeKind, selectedModelSelection?.profileId, selectionCatalog],
  );

  const handleSelectVariant = useCallback(
    (variant: string) => {
      if (!selectedModelSelection) {
        return;
      }
      applySelection({ ...selectedModelSelection, variant });
    },
    [applySelection, selectedModelSelection],
  );

  return { handleSelectAgentProfile, handleSelectModel, handleSelectVariant };
};
