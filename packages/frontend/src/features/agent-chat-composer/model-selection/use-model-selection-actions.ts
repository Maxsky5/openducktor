import type { RuntimeKind } from "@openducktor/contracts";
import type { AgentModelCatalog, AgentModelSelection } from "@openducktor/core";
import { useCallback } from "react";
import { catalogModelOptionValue } from "@/components/features/agents";
import type { AgentSessionIdentity } from "@/types/agent-orchestrator";
import { reportModelUpdateError } from "./model-update-error";

const findSelectedCatalogModel = (
  catalog: AgentModelCatalog | null,
  selection: AgentModelSelection | null,
) => {
  if (!catalog || !selection) {
    return null;
  }
  return (
    catalog.models.find(
      (model) => model.providerId === selection.providerId && model.modelId === selection.modelId,
    ) ?? null
  );
};

export const useModelSelectionActions = ({
  loadedSessionIdentity,
  updateAgentSessionModel,
  applyDraftSelection,
  selectedModelSelection,
  selectionCatalog,
  selectedRuntimeKind,
}: {
  loadedSessionIdentity: AgentSessionIdentity | null;
  updateAgentSessionModel: (
    session: AgentSessionIdentity,
    selection: AgentModelSelection | null,
  ) => Promise<void> | void;
  applyDraftSelection: (selection: AgentModelSelection | null) => void;
  selectedModelSelection: AgentModelSelection | null;
  selectionCatalog: AgentModelCatalog | null;
  selectedRuntimeKind: RuntimeKind | null;
}): {
  handleSelectAgentProfile: (profileId: string) => void;
  handleSelectModel: (modelKey: string) => void;
  handleSelectVariant: (variant: string) => void;
} => {
  const effectiveRuntimeKind = loadedSessionIdentity?.runtimeKind ?? selectedRuntimeKind;
  const applySelection = useCallback(
    (selection: AgentModelSelection | null): void => {
      if (loadedSessionIdentity) {
        void Promise.resolve(updateAgentSessionModel(loadedSessionIdentity, selection)).catch(
          reportModelUpdateError,
        );
        return;
      }
      applyDraftSelection(selection);
    },
    [applyDraftSelection, loadedSessionIdentity, updateAgentSessionModel],
  );

  const handleSelectAgentProfile = useCallback(
    (profileId: string) => {
      const selectedModel = findSelectedCatalogModel(selectionCatalog, selectedModelSelection);
      if (loadedSessionIdentity && selectedModel?.liveSessionUpdates?.profile === false) {
        return;
      }
      const baseSelection =
        selectedModelSelection ??
        (() => {
          const firstModel = selectionCatalog?.models[0];
          if (!firstModel || !effectiveRuntimeKind) {
            return null;
          }
          return {
            runtimeKind: effectiveRuntimeKind,
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
    [
      applySelection,
      effectiveRuntimeKind,
      loadedSessionIdentity,
      selectedModelSelection,
      selectionCatalog,
    ],
  );

  const handleSelectModel = useCallback(
    (nextValue: string) => {
      if (!selectionCatalog || !effectiveRuntimeKind) {
        return;
      }
      const model = selectionCatalog.models.find(
        (entry) => catalogModelOptionValue(entry) === nextValue,
      );
      if (!model) {
        return;
      }
      applySelection({
        runtimeKind: effectiveRuntimeKind,
        providerId: model.providerId,
        modelId: model.modelId,
        ...(model.variants[0] ? { variant: model.variants[0] } : {}),
        ...(selectedModelSelection?.profileId
          ? { profileId: selectedModelSelection.profileId }
          : {}),
      });
    },
    [applySelection, effectiveRuntimeKind, selectedModelSelection?.profileId, selectionCatalog],
  );

  const handleSelectVariant = useCallback(
    (variant: string) => {
      const selectedModel = findSelectedCatalogModel(selectionCatalog, selectedModelSelection);
      const liveVariants = selectedModel?.liveSessionUpdates?.variants;
      if (loadedSessionIdentity && liveVariants && !liveVariants.includes(variant)) {
        return;
      }
      if (!selectedModelSelection) {
        return;
      }
      applySelection({ ...selectedModelSelection, variant });
    },
    [applySelection, loadedSessionIdentity, selectedModelSelection, selectionCatalog],
  );

  return { handleSelectAgentProfile, handleSelectModel, handleSelectVariant };
};
