import type { RuntimeKind } from "@openducktor/contracts";
import type { AgentModelCatalog, AgentModelSelection } from "@openducktor/core";
import { useCallback } from "react";

export const useAgentStudioModelSelectionHandlers = ({
  activeExternalSessionId,
  updateAgentSessionModel,
  applyDraftSelection,
  selectedModelSelection,
  selectionCatalog,
  composerRuntimeKind,
}: {
  activeExternalSessionId: string | null;
  updateAgentSessionModel: (
    externalSessionId: string,
    selection: AgentModelSelection | null,
  ) => void;
  applyDraftSelection: (selection: AgentModelSelection | null) => void;
  selectedModelSelection: AgentModelSelection | null;
  selectionCatalog: AgentModelCatalog | null;
  composerRuntimeKind: RuntimeKind | null;
}): {
  handleSelectAgent: (profileId: string) => void;
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

  const handleSelectAgent = useCallback(
    (profileId: string) => {
      const baseSelection =
        selectedModelSelection ??
        (() => {
          const firstModel = selectionCatalog?.models[0];
          if (!firstModel || !composerRuntimeKind) {
            return null;
          }
          return {
            runtimeKind: composerRuntimeKind,
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
    [applySelection, composerRuntimeKind, selectedModelSelection, selectionCatalog],
  );

  const handleSelectModel = useCallback(
    (nextValue: string) => {
      if (!selectionCatalog || !composerRuntimeKind) {
        return;
      }
      const model = selectionCatalog.models.find((entry) => entry.id === nextValue);
      if (!model) {
        return;
      }
      applySelection({
        runtimeKind: composerRuntimeKind,
        providerId: model.providerId,
        modelId: model.modelId,
        ...(model.variants[0] ? { variant: model.variants[0] } : {}),
        ...(selectedModelSelection?.profileId
          ? { profileId: selectedModelSelection.profileId }
          : {}),
      });
    },
    [applySelection, composerRuntimeKind, selectedModelSelection?.profileId, selectionCatalog],
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

  return { handleSelectAgent, handleSelectModel, handleSelectVariant };
};
