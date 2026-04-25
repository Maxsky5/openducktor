import type { RuntimeKind } from "@openducktor/contracts";
import type { AgentModelCatalog, AgentModelSelection, AgentRole } from "@openducktor/core";
import { type Dispatch, type SetStateAction, useCallback, useEffect } from "react";
import type { RepoSettingsInput } from "@/types/state-slices";
import {
  resolveInitialModalSelection,
  resolveSelectionForAgentChange,
  resolveSelectionForModelChange,
  resolveSelectionForRuntimeChange,
  resolveSelectionForVariantChange,
} from "./session-start-modal-selection";
import { coerceVisibleSelectionToCatalog, isSameSelection } from "./session-start-selection";

type UseSessionStartModalSelectionStateArgs = {
  activeRole: AgentRole | null;
  catalog: AgentModelCatalog | null;
  intentSelectedModel: AgentModelSelection | null;
  repoSettings: RepoSettingsInput | null;
  selectedRuntimeKind: RuntimeKind;
  selectedStartMode: "fresh" | "reuse" | "fork";
  setSelection: Dispatch<SetStateAction<AgentModelSelection | null>>;
};

type UseSessionStartModalSelectionStateResult = {
  resetSelection: () => void;
  initializeSelection: (
    role: AgentRole,
    runtimeKind: RuntimeKind,
    selectedModel: AgentModelSelection | null,
  ) => void;
  handleSelectAgent: (profileId: string) => void;
  handleSelectModel: (modelKey: string) => void;
  handleSelectRuntime: (runtimeKind: RuntimeKind) => void;
  handleSelectVariant: (variant: string) => void;
};

export function useSessionStartModalSelectionState({
  activeRole,
  catalog,
  intentSelectedModel,
  repoSettings,
  selectedRuntimeKind,
  selectedStartMode,
  setSelection,
}: UseSessionStartModalSelectionStateArgs): UseSessionStartModalSelectionStateResult {
  const resetSelection = useCallback((): void => {
    setSelection(null);
  }, [setSelection]);

  const initializeSelection = useCallback(
    (
      role: AgentRole,
      runtimeKind: RuntimeKind,
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

  useEffect(() => {
    if (!activeRole) {
      return;
    }
    if (selectedStartMode === "reuse") {
      return;
    }

    setSelection((current) => {
      const normalizedCurrent = coerceVisibleSelectionToCatalog(catalog, current);
      const fallback = resolveInitialModalSelection({
        catalog,
        repoSettings,
        role: activeRole,
        runtimeKind: selectedRuntimeKind,
        selectedModel: intentSelectedModel,
      });
      const next = normalizedCurrent ?? fallback;
      return isSameSelection(current, next) ? current : next;
    });
  }, [
    activeRole,
    catalog,
    intentSelectedModel,
    repoSettings,
    selectedRuntimeKind,
    selectedStartMode,
    setSelection,
  ]);

  const handleSelectRuntime = useCallback(
    (runtimeKind: RuntimeKind): void => {
      setSelection((current) =>
        resolveSelectionForRuntimeChange({
          activeRole,
          currentSelection: current,
          intentSelectedModel,
          repoSettings,
          runtimeKind,
        }),
      );
    },
    [activeRole, intentSelectedModel, repoSettings, setSelection],
  );

  const handleSelectAgent = useCallback(
    (profileId: string): void => {
      setSelection((current) =>
        resolveSelectionForAgentChange({
          activeRole,
          catalog,
          currentSelection: current,
          intentSelectedModel,
          profileId,
          repoSettings,
          runtimeKind: selectedRuntimeKind,
        }),
      );
    },
    [activeRole, catalog, intentSelectedModel, repoSettings, selectedRuntimeKind, setSelection],
  );

  const handleSelectModel = useCallback(
    (modelKey: string): void => {
      setSelection((current) =>
        resolveSelectionForModelChange({
          catalog,
          currentSelection: current,
          modelKey,
          runtimeKind: selectedRuntimeKind,
        }),
      );
    },
    [catalog, selectedRuntimeKind, setSelection],
  );

  const handleSelectVariant = useCallback(
    (variant: string): void => {
      setSelection((current) =>
        resolveSelectionForVariantChange({ currentSelection: current, variant }),
      );
    },
    [setSelection],
  );

  return {
    resetSelection,
    initializeSelection,
    handleSelectAgent,
    handleSelectModel,
    handleSelectRuntime,
    handleSelectVariant,
  };
}
