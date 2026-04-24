import type { GitBranch, RuntimeDescriptor, RuntimeKind } from "@openducktor/contracts";
import type {
  AgentModelCatalog,
  AgentModelSelection,
  AgentSessionStartMode,
} from "@openducktor/core";
import { useCallback, useMemo, useState } from "react";
import { resolveAgentAccentColor } from "@/components/features/agents/agent-accent-color";
import {
  toModelGroupsByProvider,
  toModelOptions,
  toPrimaryAgentOptions,
} from "@/components/features/agents/catalog-select-options";
import { toBranchSelectorOptions } from "@/components/features/repository/branch-selector-model";
import type { ComboboxGroup, ComboboxOption } from "@/components/ui/combobox";
import { DEFAULT_RUNTIME_KIND, resolveRuntimeKindSelection } from "@/lib/agent-runtime";
import {
  canonicalTargetBranch,
  effectiveTaskTargetBranch,
  targetBranchSelectionValue,
} from "@/lib/target-branch";
import { useRuntimeDefinitionsContext } from "@/state/app-state-contexts";
import type { ActiveWorkspace, RepoSettingsInput } from "@/types/state-slices";
import { supportsTaskTargetBranchSelection } from "./constants";
import { orderStartModesForDisplay } from "./session-start-display";
import { useSessionStartModalReuseState } from "./session-start-modal-reuse-state";
import { useSessionStartModalRuntimeState } from "./session-start-modal-runtime-state";
import type { SessionStartModalIntent } from "./session-start-modal-types";
import { roleDefaultSelectionFor } from "./session-start-selection";
import type { SessionStartExistingSessionOption } from "./session-start-types";
import { useSessionStartModalSelectionState } from "./use-session-start-modal-selection-state";

export type {
  SessionStartModalIntent,
  SessionStartModalSource,
  SessionStartPostAction,
} from "./session-start-modal-types";

type UseSessionStartModalStateArgs = {
  activeWorkspace: ActiveWorkspace | null;
  branches?: GitBranch[];
  repoSettings: RepoSettingsInput | null;
  runtimeDefinitions: RuntimeDescriptor[];
  initialCatalog?: AgentModelCatalog | null;
  loadCatalog?: (repoPath: string, runtimeKind: RuntimeKind) => Promise<AgentModelCatalog>;
};

type UseSessionStartModalStateResult = {
  intent: SessionStartModalIntent | null;
  isOpen: boolean;
  selection: AgentModelSelection | null;
  selectedRuntimeKind: RuntimeKind;
  runtimeOptions: ComboboxOption[];
  supportsProfiles: boolean;
  supportsVariants: boolean;
  isCatalogLoading: boolean;
  agentOptions: ComboboxOption[];
  modelOptions: ComboboxOption[];
  modelGroups: ComboboxGroup[];
  variantOptions: ComboboxOption[];
  availableStartModes: AgentSessionStartMode[];
  selectedStartMode: AgentSessionStartMode;
  existingSessionOptions: SessionStartExistingSessionOption[];
  selectedSourceSessionId: string;
  showTargetBranchSelector: boolean;
  targetBranchOptions: ComboboxOption[];
  selectedTargetBranch: string;
  openStartModal: (nextIntent: SessionStartModalIntent) => void;
  closeStartModal: () => void;
  handleSelectStartMode: (startMode: AgentSessionStartMode) => void;
  handleSelectSourceSession: (sessionId: string) => void;
  handleSelectTargetBranch: (branch: string) => void;
  handleSelectRuntime: (runtimeKind: RuntimeKind) => void;
  handleSelectAgent: (profileId: string) => void;
  handleSelectModel: (modelKey: string) => void;
  handleSelectVariant: (variant: string) => void;
};

export function useSessionStartModalState({
  activeWorkspace,
  branches = [],
  repoSettings,
  runtimeDefinitions,
  initialCatalog,
  loadCatalog,
}: UseSessionStartModalStateArgs): UseSessionStartModalStateResult {
  const { loadRepoRuntimeCatalog } = useRuntimeDefinitionsContext();
  const loadCatalogForRepo = loadCatalog ?? loadRepoRuntimeCatalog;
  const [intent, setIntent] = useState<SessionStartModalIntent | null>(null);
  const [selection, setSelection] = useState<AgentModelSelection | null>(null);
  const [selectedTargetBranch, setSelectedTargetBranch] = useState("");
  const activeRole = intent?.role ?? null;
  const {
    catalog,
    isCatalogLoading,
    selectedRuntimeDescriptor,
    selectedRuntimeKind,
    runtimeOptions,
    setRequestedRuntimeKind,
  } = useSessionStartModalRuntimeState({
    activeWorkspace,
    initialCatalog,
    isOpen: intent !== null,
    loadCatalog: loadCatalogForRepo,
    runtimeDefinitions,
  });
  const {
    availableStartModes,
    existingSessionOptions,
    initializeStartState,
    resetStartState,
    selectedSourceSessionId,
    selectedStartMode,
    handleSelectSourceSession,
    handleSelectStartMode,
  } = useSessionStartModalReuseState({
    catalog,
    intent,
    runtimeDefinitions,
    setRequestedRuntimeKind,
    setSelection,
  });
  const {
    resetSelection,
    initializeSelection,
    handleSelectAgent,
    handleSelectModel,
    handleSelectRuntime: handleSelectionRuntimeChange,
    handleSelectVariant,
  } = useSessionStartModalSelectionState({
    activeRole,
    catalog,
    intentSelectedModel: intent?.selectedModel ?? null,
    repoSettings,
    selectedRuntimeKind,
    selectedStartMode,
    setSelection,
  });

  const closeStartModal = useCallback(() => {
    setIntent(null);
    setSelectedTargetBranch("");
    resetSelection();
    resetStartState();
  }, [resetSelection, resetStartState]);

  const openStartModal = useCallback(
    (nextIntent: SessionStartModalIntent) => {
      const initialRuntimeKind = resolveRuntimeKindSelection({
        runtimeDefinitions,
        requestedRuntimeKind:
          nextIntent.selectedModel?.runtimeKind ??
          roleDefaultSelectionFor(repoSettings, nextIntent.role)?.runtimeKind ??
          repoSettings?.defaultRuntimeKind ??
          DEFAULT_RUNTIME_KIND,
      });
      setRequestedRuntimeKind(initialRuntimeKind);
      setIntent(nextIntent);
      setSelectedTargetBranch(
        targetBranchSelectionValue(
          effectiveTaskTargetBranch(
            nextIntent.initialTargetBranch,
            repoSettings?.defaultTargetBranch,
          ),
        ),
      );
      initializeStartState(nextIntent);
      initializeSelection(nextIntent.role, initialRuntimeKind, nextIntent.selectedModel ?? null);
    },
    [
      initializeSelection,
      initializeStartState,
      repoSettings,
      runtimeDefinitions,
      setRequestedRuntimeKind,
    ],
  );

  const handleSelectRuntime = useCallback(
    (runtimeKindValue: RuntimeKind): void => {
      const runtimeKind = resolveRuntimeKindSelection({
        runtimeDefinitions,
        requestedRuntimeKind: runtimeKindValue,
      });
      setRequestedRuntimeKind(runtimeKindValue);
      handleSelectionRuntimeChange(runtimeKind);
    },
    [handleSelectionRuntimeChange, runtimeDefinitions, setRequestedRuntimeKind],
  );

  const selectedModelEntry = useMemo(() => {
    if (!catalog || !selection) {
      return null;
    }
    return (
      catalog.models.find(
        (entry) => entry.providerId === selection.providerId && entry.modelId === selection.modelId,
      ) ?? null
    );
  }, [catalog, selection]);

  const agentOptions = useMemo<ComboboxOption[]>(() => {
    const options = toPrimaryAgentOptions(catalog);
    if (options.length > 0) {
      return options;
    }

    const fallbackAgent = selection?.profileId;
    if (!fallbackAgent) {
      return [];
    }
    const accentColor = resolveAgentAccentColor(fallbackAgent);
    return [
      {
        value: fallbackAgent,
        label: fallbackAgent,
        description: "Current default agent",
        ...(accentColor ? { accentColor } : {}),
      },
    ];
  }, [catalog, selection?.profileId]);

  const modelOptions = useMemo<ComboboxOption[]>(() => {
    const options = toModelOptions(catalog);
    if (options.length > 0) {
      return options;
    }

    if (!selection?.providerId || !selection.modelId) {
      return [];
    }

    return [
      {
        value: `${selection.providerId}/${selection.modelId}`,
        label: selection.modelId,
        description: `${selection.providerId} (saved default model)`,
      },
    ];
  }, [catalog, selection]);

  const modelGroups = useMemo<ComboboxGroup[]>(() => {
    return toModelGroupsByProvider(catalog);
  }, [catalog]);

  const variantOptions = useMemo<ComboboxOption[]>(() => {
    if (selectedModelEntry) {
      return selectedModelEntry.variants.map((variant) => ({
        value: variant,
        label: variant,
      }));
    }

    if (!selection?.variant) {
      return [];
    }

    return [{ value: selection.variant, label: selection.variant }];
  }, [selectedModelEntry, selection?.variant]);

  const orderedStartModes = useMemo<AgentSessionStartMode[]>(() => {
    return orderStartModesForDisplay(availableStartModes);
  }, [availableStartModes]);

  const showTargetBranchSelector = supportsTaskTargetBranchSelection(
    intent?.role,
    intent?.scenario,
  );
  const selectedInitialTargetBranch = useMemo(
    () => effectiveTaskTargetBranch(intent?.initialTargetBranch, repoSettings?.defaultTargetBranch),
    [intent?.initialTargetBranch, repoSettings?.defaultTargetBranch],
  );
  const selectedInitialTargetBranchValue = targetBranchSelectionValue(selectedInitialTargetBranch);
  const targetBranchOptions = useMemo<ComboboxOption[]>(() => {
    const configuredTargetBranch = canonicalTargetBranch(selectedInitialTargetBranch);

    return toBranchSelectorOptions(branches, {
      valueFormat: "full_ref",
      includeOptions: selectedInitialTargetBranchValue.trim()
        ? [
            {
              value: selectedInitialTargetBranchValue,
              label: configuredTargetBranch,
              secondaryLabel: "configured",
              searchKeywords: configuredTargetBranch.split("/").filter(Boolean),
            },
          ]
        : [],
    });
  }, [branches, selectedInitialTargetBranch, selectedInitialTargetBranchValue]);

  const handleSelectTargetBranch = useCallback((branch: string) => {
    setSelectedTargetBranch(branch);
  }, []);

  return {
    intent,
    isOpen: intent !== null,
    selection,
    selectedRuntimeKind,
    runtimeOptions,
    supportsProfiles: selectedRuntimeDescriptor?.capabilities.supportsProfiles ?? false,
    supportsVariants: selectedRuntimeDescriptor?.capabilities.supportsVariants ?? false,
    isCatalogLoading,
    agentOptions,
    modelOptions,
    modelGroups,
    variantOptions,
    availableStartModes: orderedStartModes,
    selectedStartMode,
    existingSessionOptions,
    selectedSourceSessionId,
    showTargetBranchSelector,
    targetBranchOptions,
    selectedTargetBranch,
    openStartModal,
    closeStartModal,
    handleSelectStartMode,
    handleSelectSourceSession,
    handleSelectTargetBranch,
    handleSelectRuntime,
    handleSelectAgent,
    handleSelectModel,
    handleSelectVariant,
  };
}
