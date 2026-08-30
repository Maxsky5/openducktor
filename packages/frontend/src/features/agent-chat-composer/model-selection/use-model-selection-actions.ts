import type { RuntimeKind } from "@openducktor/contracts";
import type { AgentModelCatalog, AgentModelSelection } from "@openducktor/core";
import { useCallback } from "react";
import type { ModelPickerValue } from "@/components/features/agents/model-picker";
import {
  resolveModelSelectionForPair,
  resolveModelSelectionForProfileChange,
  resolveModelSelectionForVariantChange,
} from "@/features/model-selection/model-selection-state";
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
}) => {
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
      const selection = resolveModelSelectionForProfileChange({
        catalog: selectionCatalog,
        currentSelection: selectedModelSelection,
        profileId,
        runtimeKind: effectiveRuntimeKind,
      });
      if (!selection) {
        return;
      }
      applySelection(selection);
    },
    [
      applySelection,
      effectiveRuntimeKind,
      loadedSessionIdentity,
      selectedModelSelection,
      selectionCatalog,
    ],
  );

  const handleSelectModelPair = useCallback(
    (value: ModelPickerValue, targetCatalog: AgentModelCatalog): void => {
      if (loadedSessionIdentity && loadedSessionIdentity.runtimeKind !== value.runtimeKind) {
        return;
      }
      const resolvedPair = resolveModelSelectionForPair({
        catalog: targetCatalog,
        currentSelection: selectedModelSelection,
        defaultSelection: null,
        selectedModel: null,
        value,
      });
      if (!resolvedPair) {
        return;
      }
      const { model, selection: modelSelection } = resolvedPair;
      const liveVariants = loadedSessionIdentity ? model.liveSessionUpdates?.variants : undefined;
      const liveVariantSet = liveVariants ? new Set(liveVariants) : null;
      const variants = liveVariantSet
        ? model.variants.filter((variant) => liveVariantSet.has(variant))
        : model.variants;
      const { variant: _defaultVariant, ...selectionWithoutVariant } = modelSelection;
      const nextSelection: AgentModelSelection = { ...selectionWithoutVariant };
      if (variants[0]) {
        nextSelection.variant = variants[0];
      }
      applySelection(nextSelection);
    },
    [applySelection, loadedSessionIdentity, selectedModelSelection],
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

  return {
    handleSelectAgentProfile,
    handleSelectModelPair,
    handleSelectVariant,
  } satisfies {
    handleSelectAgentProfile: (profileId: string) => void;
    handleSelectModelPair: (value: ModelPickerValue, targetCatalog: AgentModelCatalog) => void;
    handleSelectVariant: (variant: string) => void;
  };
};
