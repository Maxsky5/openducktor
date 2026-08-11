import type { RuntimeKind } from "@openducktor/contracts";
import type { AgentModelCatalog, AgentModelSelection } from "@openducktor/core";
import { useCallback } from "react";
import { catalogModelOptionValue } from "@/components/features/agents";
import type { AgentSessionIdentity } from "@/types/agent-orchestrator";
import {
  resolveModelSelectionForProfileChange,
  resolveModelSelectionForVariantChange,
} from "./model-selection-state";
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
      if (!effectiveRuntimeKind) {
        return;
      }
      applySelection(
        resolveModelSelectionForProfileChange({
          catalog: selectionCatalog,
          currentSelection: selectedModelSelection,
          profileId,
          runtimeKind: effectiveRuntimeKind,
        }),
      );
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
      const liveVariants = loadedSessionIdentity ? model.liveSessionUpdates?.variants : undefined;
      const liveVariantSet = liveVariants ? new Set(liveVariants) : null;
      const variants = liveVariantSet
        ? model.variants.filter((variant) => liveVariantSet.has(variant))
        : model.variants;
      applySelection({
        runtimeKind: effectiveRuntimeKind,
        providerId: model.providerId,
        modelId: model.modelId,
        ...(variants[0] ? { variant: variants[0] } : {}),
        ...(selectedModelSelection?.profileId
          ? { profileId: selectedModelSelection.profileId }
          : {}),
      });
    },
    [
      applySelection,
      effectiveRuntimeKind,
      loadedSessionIdentity,
      selectedModelSelection?.profileId,
      selectionCatalog,
    ],
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
      applySelection(
        resolveModelSelectionForVariantChange({
          catalog: selectionCatalog,
          currentSelection: selectedModelSelection,
          variant,
        }),
      );
    },
    [applySelection, loadedSessionIdentity, selectedModelSelection, selectionCatalog],
  );

  return { handleSelectAgentProfile, handleSelectModel, handleSelectVariant };
};
