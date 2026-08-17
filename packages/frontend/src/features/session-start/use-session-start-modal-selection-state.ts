import type { RuntimeKind } from "@openducktor/contracts";
import type { AgentModelCatalog, AgentModelSelection } from "@openducktor/core";
import { type Dispatch, type SetStateAction, useCallback, useMemo } from "react";
import type { ModelPickerValue } from "@/components/features/agents/model-picker";
import {
  coerceVisibleSelectionToCatalog,
  resolveInitialModelSelection,
  resolveModelSelectionForPair,
  resolveModelSelectionForProfileChange,
  resolveModelSelectionForVariantChange,
} from "@/features/model-selection/model-selection-state";

type UseSessionStartModalSelectionStateArgs = {
  catalog: AgentModelCatalog | null;
  defaultSelection: AgentModelSelection | null;
  intentSelectedModel: AgentModelSelection | null;
  isSelectionActive: boolean;
  selection: AgentModelSelection | null;
  selectedRuntimeKind: RuntimeKind | null;
  selectedStartMode: "fresh" | "reuse" | "fork";
  setSelection: Dispatch<SetStateAction<AgentModelSelection | null>>;
};

type UseSessionStartModalSelectionStateResult = {
  resolvedSelection: AgentModelSelection | null;
  resetSelection: () => void;
  initializeSelection: (
    defaultSelection: AgentModelSelection | null,
    runtimeKind: RuntimeKind | null,
    selectedModel: AgentModelSelection | null,
  ) => void;
  handleSelectRuntimeProfile: (profileId: string) => void;
  handleSelectPair: (value: ModelPickerValue, targetCatalog: AgentModelCatalog) => void;
  handleSelectVariant: (variant: string) => void;
};

const resolveVisibleSelection = ({
  catalog,
  defaultSelection,
  intentSelectedModel,
  isSelectionActive,
  selection,
  selectedRuntimeKind,
  selectedStartMode,
}: Omit<UseSessionStartModalSelectionStateArgs, "setSelection">): AgentModelSelection | null => {
  if (!isSelectionActive || selectedStartMode === "reuse" || !selectedRuntimeKind) {
    return null;
  }

  if (selectedStartMode === "fork" && selection) {
    return coerceVisibleSelectionToCatalog(catalog, selection);
  }

  const normalizedCurrent = coerceVisibleSelectionToCatalog(catalog, selection);
  const fallback = resolveInitialModelSelection({
    catalog,
    defaultSelection,
    runtimeKind: selectedRuntimeKind,
    selectedModel: intentSelectedModel,
  });
  return normalizedCurrent ?? fallback;
};

export function useSessionStartModalSelectionState({
  catalog,
  defaultSelection,
  intentSelectedModel,
  isSelectionActive,
  selection,
  selectedRuntimeKind,
  selectedStartMode,
  setSelection,
}: UseSessionStartModalSelectionStateArgs): UseSessionStartModalSelectionStateResult {
  const resolvedSelection = useMemo(
    () =>
      resolveVisibleSelection({
        catalog,
        defaultSelection,
        intentSelectedModel,
        isSelectionActive,
        selection,
        selectedRuntimeKind,
        selectedStartMode,
      }),
    [
      catalog,
      defaultSelection,
      intentSelectedModel,
      isSelectionActive,
      selection,
      selectedRuntimeKind,
      selectedStartMode,
    ],
  );

  const resetSelection = useCallback((): void => {
    setSelection(null);
  }, [setSelection]);

  const initializeSelection = useCallback(
    (
      nextDefaultSelection: AgentModelSelection | null,
      runtimeKind: RuntimeKind | null,
      selectedModel: AgentModelSelection | null,
    ): void => {
      setSelection(
        resolveInitialModelSelection({
          catalog,
          defaultSelection: nextDefaultSelection,
          runtimeKind,
          selectedModel,
        }),
      );
    },
    [catalog, setSelection],
  );

  const handleSelectRuntimeProfile = useCallback(
    (profileId: string): void => {
      if (!selectedRuntimeKind) {
        return;
      }
      setSelection(
        resolveModelSelectionForProfileChange({
          catalog,
          currentSelection: resolvedSelection,
          profileId,
          runtimeKind: selectedRuntimeKind,
        }),
      );
    },
    [catalog, resolvedSelection, selectedRuntimeKind, setSelection],
  );

  const handleSelectPair = useCallback(
    (value: ModelPickerValue, targetCatalog: AgentModelCatalog): void => {
      const resolvedPair = resolveModelSelectionForPair({
        catalog: targetCatalog,
        currentSelection: resolvedSelection,
        defaultSelection,
        selectedModel: intentSelectedModel,
        value,
      });
      setSelection(resolvedPair?.selection ?? null);
    },
    [defaultSelection, intentSelectedModel, resolvedSelection, setSelection],
  );

  const handleSelectVariant = useCallback(
    (variant: string): void => {
      if (!selectedRuntimeKind) {
        return;
      }
      setSelection(
        resolveModelSelectionForVariantChange({
          catalog,
          currentSelection: resolvedSelection,
          variant,
        }),
      );
    },
    [catalog, resolvedSelection, selectedRuntimeKind, setSelection],
  );

  return {
    resolvedSelection,
    resetSelection,
    initializeSelection,
    handleSelectRuntimeProfile,
    handleSelectPair,
    handleSelectVariant,
  };
}
