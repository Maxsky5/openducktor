import type { RuntimeKind } from "@openducktor/contracts";
import type { AgentModelCatalog, AgentModelSelection } from "@openducktor/core";
import { type Dispatch, type SetStateAction, useCallback, useMemo } from "react";
import {
  coerceVisibleSelectionToCatalog,
  resolveInitialModelSelection,
  resolveModelSelectionForModelChange,
  resolveModelSelectionForProfileChange,
  resolveModelSelectionForRuntimeChange,
  resolveModelSelectionForVariantChange,
} from "@/features/agent-chat-composer/model-selection/model-selection-state";

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
  handleSelectModel: (modelKey: string) => void;
  handleSelectRuntime: (runtimeKind: RuntimeKind) => void;
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

  const handleSelectRuntime = useCallback(
    (runtimeKind: RuntimeKind): void => {
      setSelection(
        resolveModelSelectionForRuntimeChange({
          catalog,
          currentSelection: resolvedSelection,
          defaultSelection,
          selectedModel: intentSelectedModel,
          runtimeKind,
        }),
      );
    },
    [catalog, defaultSelection, intentSelectedModel, resolvedSelection, setSelection],
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

  const handleSelectModel = useCallback(
    (modelKey: string): void => {
      if (!selectedRuntimeKind) {
        return;
      }
      setSelection(
        resolveModelSelectionForModelChange({
          catalog,
          currentSelection: resolvedSelection,
          modelKey,
          runtimeKind: selectedRuntimeKind,
        }),
      );
    },
    [catalog, resolvedSelection, selectedRuntimeKind, setSelection],
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
    handleSelectModel,
    handleSelectRuntime,
    handleSelectVariant,
  };
}
