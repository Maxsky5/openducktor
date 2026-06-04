import type { RuntimeKind } from "@openducktor/contracts";
import type { AgentModelCatalog, AgentModelSelection, AgentRole } from "@openducktor/core";
import { type Dispatch, type SetStateAction, useCallback, useMemo } from "react";
import type { RepoSettingsInput } from "@/types/state-slices";
import {
  resolveInitialModalSelection,
  resolveSelectionForAgentChange,
  resolveSelectionForModelChange,
  resolveSelectionForRuntimeChange,
  resolveSelectionForVariantChange,
} from "./session-start-modal-selection";
import { coerceVisibleSelectionToCatalog } from "./session-start-selection";

type UseSessionStartModalSelectionStateArgs = {
  activeRole: AgentRole | null;
  catalog: AgentModelCatalog | null;
  intentSelectedModel: AgentModelSelection | null;
  repoSettings: RepoSettingsInput | null;
  selection: AgentModelSelection | null;
  selectedRuntimeKind: RuntimeKind | null;
  selectedStartMode: "fresh" | "reuse" | "fork";
  setSelection: Dispatch<SetStateAction<AgentModelSelection | null>>;
};

type UseSessionStartModalSelectionStateResult = {
  resolvedSelection: AgentModelSelection | null;
  resetSelection: () => void;
  initializeSelection: (
    role: AgentRole,
    runtimeKind: RuntimeKind | null,
    selectedModel: AgentModelSelection | null,
  ) => void;
  handleSelectAgent: (profileId: string) => void;
  handleSelectModel: (modelKey: string) => void;
  handleSelectRuntime: (runtimeKind: RuntimeKind) => void;
  handleSelectVariant: (variant: string) => void;
};

const resolveVisibleSelection = ({
  activeRole,
  catalog,
  intentSelectedModel,
  repoSettings,
  selection,
  selectedRuntimeKind,
  selectedStartMode,
}: {
  activeRole: AgentRole | null;
  catalog: AgentModelCatalog | null;
  intentSelectedModel: AgentModelSelection | null;
  repoSettings: RepoSettingsInput | null;
  selection: AgentModelSelection | null;
  selectedRuntimeKind: RuntimeKind | null;
  selectedStartMode: "fresh" | "reuse" | "fork";
}): AgentModelSelection | null => {
  if (!activeRole || selectedStartMode === "reuse" || !selectedRuntimeKind) {
    return null;
  }

  if (selectedStartMode === "fork" && selection) {
    return selection;
  }

  const normalizedCurrent = coerceVisibleSelectionToCatalog(catalog, selection);
  const fallback = resolveInitialModalSelection({
    catalog,
    repoSettings,
    role: activeRole,
    runtimeKind: selectedRuntimeKind,
    selectedModel: intentSelectedModel,
  });
  return normalizedCurrent ?? fallback;
};

export function useSessionStartModalSelectionState({
  activeRole,
  catalog,
  intentSelectedModel,
  repoSettings,
  selection,
  selectedRuntimeKind,
  selectedStartMode,
  setSelection,
}: UseSessionStartModalSelectionStateArgs): UseSessionStartModalSelectionStateResult {
  const resolvedSelection = useMemo(
    () =>
      resolveVisibleSelection({
        activeRole,
        catalog,
        intentSelectedModel,
        repoSettings,
        selection,
        selectedRuntimeKind,
        selectedStartMode,
      }),
    [
      activeRole,
      catalog,
      intentSelectedModel,
      repoSettings,
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
      role: AgentRole,
      runtimeKind: RuntimeKind | null,
      selectedModel: AgentModelSelection | null,
    ): void => {
      setSelection(
        resolveInitialModalSelection({
          catalog,
          repoSettings,
          role,
          runtimeKind,
          selectedModel,
        }),
      );
    },
    [catalog, repoSettings, setSelection],
  );

  const handleSelectRuntime = useCallback(
    (runtimeKind: RuntimeKind): void => {
      setSelection(
        resolveSelectionForRuntimeChange({
          activeRole,
          currentSelection: resolvedSelection,
          intentSelectedModel,
          repoSettings,
          runtimeKind,
        }),
      );
    },
    [activeRole, intentSelectedModel, repoSettings, resolvedSelection, setSelection],
  );

  const handleSelectAgent = useCallback(
    (profileId: string): void => {
      if (!selectedRuntimeKind) {
        return;
      }
      setSelection(
        resolveSelectionForAgentChange({
          activeRole,
          catalog,
          currentSelection: resolvedSelection,
          intentSelectedModel,
          profileId,
          repoSettings,
          runtimeKind: selectedRuntimeKind,
        }),
      );
    },
    [
      activeRole,
      catalog,
      intentSelectedModel,
      repoSettings,
      resolvedSelection,
      selectedRuntimeKind,
      setSelection,
    ],
  );

  const handleSelectModel = useCallback(
    (modelKey: string): void => {
      if (!selectedRuntimeKind) {
        return;
      }
      setSelection(
        resolveSelectionForModelChange({
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
      setSelection(
        resolveSelectionForVariantChange({ currentSelection: resolvedSelection, variant }),
      );
    },
    [resolvedSelection, setSelection],
  );

  return {
    resolvedSelection,
    resetSelection,
    initializeSelection,
    handleSelectAgent,
    handleSelectModel,
    handleSelectRuntime,
    handleSelectVariant,
  };
}
