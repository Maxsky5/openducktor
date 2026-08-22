import type {
  GitBranch,
  RepoRuntimeRef,
  RuntimeDescriptor,
  RuntimeKind,
} from "@openducktor/contracts";
import type {
  AgentModelCatalog,
  AgentModelSelection,
  AgentSessionStartMode,
} from "@openducktor/core";
import { useCallback, useMemo, useState } from "react";
import { resolveAgentAccentColor } from "@/components/features/agents/agent-accent-color";
import { toPrimaryAgentOptions } from "@/components/features/agents/catalog-select-options";
import type {
  ModelPickerRuntime,
  ModelPickerValue,
} from "@/components/features/agents/model-picker";
import { toModelPickerCatalogResource } from "@/components/features/agents/model-picker";
import { toBranchSelectorOptions } from "@/components/features/repository/branch-selector-model";
import type { ComboboxOption } from "@/components/ui/combobox";
import {
  filterRuntimeDefinitionsForStartMode,
  resolveRuntimeKindSelection,
} from "@/lib/agent-runtime";
import {
  canonicalTargetBranch,
  effectiveTaskTargetBranch,
  targetBranchSelectionValue,
} from "@/lib/target-branch";
import { useRuntimeAvailabilityContext } from "@/state/app-state-contexts";
import type { RepoSettingsInput } from "@/types/state-slices";
import { supportsTaskTargetBranchSelection } from "./constants";
import { orderStartModesForDisplay } from "./session-start-display";
import { useSessionStartModalReuseState } from "./session-start-modal-reuse-state";
import { useSessionStartModalRuntimeState } from "./session-start-modal-runtime-state";
import type { SessionStartModalIntent } from "./session-start-modal-types";
import { roleDefaultSelectionFor } from "./session-start-selection";
import type { SessionStartExistingSessionOption } from "./session-start-types";
import { useSessionStartModalSelectionState } from "./use-session-start-modal-selection-state";

export type { SessionStartModalIntent, SessionStartModalSource } from "./session-start-modal-types";
export type { SessionStartPostAction } from "./session-start-workflow";

type UseSessionStartModalStateArgs = {
  branches?: GitBranch[];
  repoSettings: RepoSettingsInput | null;
  initialCatalog?: AgentModelCatalog | null;
  loadCatalog?: (runtimeRef: RepoRuntimeRef) => Promise<AgentModelCatalog>;
  workspaceRepoPath: string | null;
};

type UseSessionStartModalStateResult = {
  intent: SessionStartModalIntent | null;
  isOpen: boolean;
  selection: AgentModelSelection | null;
  eligibleRuntimeDefinitions: RuntimeDescriptor[];
  selectedRuntimeDescriptor: RuntimeDescriptor | null;
  selectedRuntimeKind: RuntimeKind | null;
  modelPickerRuntimes: ModelPickerRuntime[];
  supportsProfiles: boolean;
  supportsVariants: boolean;
  catalogError: string | null;
  isCatalogLoading: boolean;
  runtimeDefinitionsError: string | null;
  isRuntimeDefinitionsLoading: boolean;
  retryRuntimeDefinitions: () => Promise<RuntimeDescriptor[]>;
  runtimeSettingsError: string | null;
  isRuntimeSettingsLoading: boolean;
  hasRuntimeSettingsSnapshot: boolean;
  retryRuntimeSettings: () => Promise<void>;
  runtimeProfileOptions: ComboboxOption[];
  variantOptions: ComboboxOption[];
  availableStartModes: AgentSessionStartMode[];
  selectedStartMode: AgentSessionStartMode;
  existingSessionOptions: SessionStartExistingSessionOption[];
  selectedSourceSessionValue: string;
  showTargetBranchSelector: boolean;
  targetBranchOptions: ComboboxOption[];
  selectedTargetBranch: string;
  openStartModal: (nextIntent: SessionStartModalIntent) => void;
  closeStartModal: () => void;
  handleSelectStartMode: (startMode: AgentSessionStartMode) => void;
  handleSelectSourceSessionValue: (sourceSessionValue: string) => void;
  handleSelectTargetBranch: (branch: string) => void;
  handleSelectRuntimeProfile: (profileId: string) => void;
  handleSelectModelPair: (value: ModelPickerValue) => void;
  handleSelectVariant: (variant: string) => void;
};

export function useSessionStartModalState({
  branches = [],
  repoSettings,
  initialCatalog,
  loadCatalog,
  workspaceRepoPath,
}: UseSessionStartModalStateArgs): UseSessionStartModalStateResult {
  const {
    availableRuntimeDefinitions,
    hasRuntimeSettingsSnapshot,
    isLoadingRuntimeDefinitions,
    isLoadingRuntimeSettings,
    loadRepoRuntimeCatalog,
    refreshRuntimeDefinitions,
    refreshRuntimeSettings,
    runtimeDefinitionsError,
    runtimeSettingsError,
  } = useRuntimeAvailabilityContext();
  const loadCatalogForRepo = loadCatalog ?? loadRepoRuntimeCatalog;
  const [intent, setIntent] = useState<SessionStartModalIntent | null>(null);
  const [selection, setSelection] = useState<AgentModelSelection | null>(null);
  const [selectedTargetBranch, setSelectedTargetBranch] = useState("");
  const [selectedStartModeForRuntime, setSelectedStartModeForRuntime] =
    useState<AgentSessionStartMode>("fresh");
  const activeRole = intent?.role ?? null;
  const activeRoleDefaultSelection = useMemo(
    () => (activeRole ? roleDefaultSelectionFor(repoSettings, activeRole) : null),
    [activeRole, repoSettings],
  );
  const {
    catalog,
    catalogResources,
    catalogError,
    eligibleRuntimeDefinitions,
    isCatalogLoading,
    selectedRuntimeDescriptor,
    selectedRuntimeKind,
    setRequestedRuntimeKind,
  } = useSessionStartModalRuntimeState({
    initialCatalog,
    isOpen: intent !== null,
    loadCatalog: loadCatalogForRepo,
    runtimeDefinitions: availableRuntimeDefinitions,
    selectedStartMode: selectedStartModeForRuntime,
    workspaceRepoPath,
  });
  const {
    availableStartModes,
    existingSessionOptions,
    initializeStartState,
    resetStartState,
    reuseSelection,
    selectedSourceSessionValue,
    selectedStartMode,
    handleSelectSourceSessionValue,
    handleSelectStartMode,
  } = useSessionStartModalReuseState({
    catalog,
    intent,
    runtimeDefinitions: availableRuntimeDefinitions,
    setRequestedRuntimeKind,
    setSelection,
  });

  const {
    resolvedSelection,
    resetSelection,
    initializeSelection,
    handleSelectRuntimeProfile,
    handleSelectPair,
    handleSelectVariant,
  } = useSessionStartModalSelectionState({
    catalog,
    defaultSelection: activeRoleDefaultSelection,
    intentSelectedModel: intent?.selectedModel ?? null,
    isSelectionActive: activeRole !== null,
    selection,
    selectedRuntimeKind,
    selectedStartMode,
    setSelection,
  });

  const visibleSelection = selectedStartMode === "reuse" ? reuseSelection : resolvedSelection;

  const closeStartModal = useCallback(() => {
    setIntent(null);
    setSelectedTargetBranch("");
    setSelectedStartModeForRuntime("fresh");
    resetSelection();
    resetStartState();
  }, [resetSelection, resetStartState]);

  const openStartModal = useCallback(
    (nextIntent: SessionStartModalIntent) => {
      const requestedRuntimeKind =
        nextIntent.requestedRuntimeKind ??
        nextIntent.selectedModel?.runtimeKind ??
        roleDefaultSelectionFor(repoSettings, nextIntent.role)?.runtimeKind ??
        repoSettings?.defaultRuntimeKind ??
        null;
      const initialStartState = initializeStartState(nextIntent);
      const initialStartMode = initialStartState.selectedStartMode;
      const initialRuntimeKind = resolveRuntimeKindSelection({
        runtimeDefinitions: filterRuntimeDefinitionsForStartMode(
          availableRuntimeDefinitions,
          initialStartMode,
        ),
        requestedRuntimeKind,
      });
      if (initialStartMode === "fresh") {
        setRequestedRuntimeKind(requestedRuntimeKind);
      }
      setSelectedStartModeForRuntime(initialStartMode);
      setIntent(nextIntent);
      setSelectedTargetBranch(
        targetBranchSelectionValue(
          effectiveTaskTargetBranch(
            nextIntent.initialTargetBranch,
            repoSettings?.defaultTargetBranch,
          ),
        ),
      );
      if (initialStartMode === "fresh") {
        initializeSelection(
          roleDefaultSelectionFor(repoSettings, nextIntent.role),
          initialRuntimeKind,
          nextIntent.selectedModel ?? null,
        );
      }
    },
    [
      initializeSelection,
      initializeStartState,
      availableRuntimeDefinitions,
      repoSettings,
      setRequestedRuntimeKind,
    ],
  );

  const modelPickerRuntimes = useMemo<ModelPickerRuntime[]>(
    () =>
      eligibleRuntimeDefinitions.flatMap((descriptor) => {
        const resource = catalogResources.find(
          (candidate) => candidate.runtimeKind === descriptor.kind,
        );
        if (!resource) {
          return [];
        }
        return [
          {
            descriptor,
            resource: toModelPickerCatalogResource({
              catalog: resource.catalog,
              isFetching: resource.isFetching,
              error: resource.error,
              isAvailable: resource.isEnabled,
              unavailableReason: "This runtime catalog is not available yet.",
              retry: resource.retry,
            }),
          },
        ];
      }),
    [catalogResources, eligibleRuntimeDefinitions],
  );

  const handleSelectModelPair = useCallback(
    (value: ModelPickerValue): void => {
      if (selectedStartMode === "reuse") {
        return;
      }
      const runtime = modelPickerRuntimes.find(
        (candidate) => candidate.descriptor.kind === value.runtimeKind,
      );
      if (runtime?.resource.status !== "ready") {
        return;
      }
      setRequestedRuntimeKind(value.runtimeKind);
      handleSelectPair(value, runtime.resource.catalog);
    },
    [handleSelectPair, modelPickerRuntimes, selectedStartMode, setRequestedRuntimeKind],
  );

  const handleSelectedStartModeChange = useCallback(
    (startMode: AgentSessionStartMode): void => {
      setSelectedStartModeForRuntime(startMode);
      handleSelectStartMode(startMode);
    },
    [handleSelectStartMode],
  );

  const selectedModelEntry = useMemo(() => {
    if (!catalog || !visibleSelection) {
      return null;
    }
    return (
      catalog.models.find(
        (entry) =>
          entry.providerId === visibleSelection.providerId &&
          entry.modelId === visibleSelection.modelId,
      ) ?? null
    );
  }, [catalog, visibleSelection]);

  const runtimeProfileOptions = useMemo<ComboboxOption[]>(() => {
    const options = toPrimaryAgentOptions(catalog);
    if (options.length > 0) {
      return options;
    }

    const fallbackProfileId = visibleSelection?.profileId;
    if (!fallbackProfileId) {
      return [];
    }
    const accentColor = resolveAgentAccentColor(fallbackProfileId);
    return [
      {
        value: fallbackProfileId,
        label: fallbackProfileId,
        description: "Current default runtime profile",
        ...(() => {
          if (accentColor) {
            return { accentColor };
          }
          return {};
        })(),
      },
    ];
  }, [catalog, visibleSelection?.profileId]);

  const variantOptions = useMemo<ComboboxOption[]>(() => {
    if (selectedModelEntry) {
      return selectedModelEntry.variants.map((variant) => ({
        value: variant,
        label: variant,
      }));
    }

    if (!visibleSelection?.variant) {
      return [];
    }

    return [{ value: visibleSelection.variant, label: visibleSelection.variant }];
  }, [selectedModelEntry, visibleSelection?.variant]);

  const orderedStartModes = useMemo<AgentSessionStartMode[]>(() => {
    return orderStartModesForDisplay(availableStartModes);
  }, [availableStartModes]);

  const showTargetBranchSelector = supportsTaskTargetBranchSelection(
    intent?.role,
    intent?.launchActionId,
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
    selection: visibleSelection,
    eligibleRuntimeDefinitions,
    selectedRuntimeDescriptor,
    selectedRuntimeKind,
    modelPickerRuntimes,
    supportsProfiles:
      selectedRuntimeDescriptor?.capabilities.optionalSurfaces.supportsProfiles ?? false,
    supportsVariants:
      selectedRuntimeDescriptor?.capabilities.optionalSurfaces.supportsVariants ?? false,
    catalogError,
    isCatalogLoading,
    runtimeDefinitionsError,
    isRuntimeDefinitionsLoading: isLoadingRuntimeDefinitions,
    retryRuntimeDefinitions: refreshRuntimeDefinitions,
    runtimeSettingsError,
    isRuntimeSettingsLoading: isLoadingRuntimeSettings,
    hasRuntimeSettingsSnapshot,
    retryRuntimeSettings: refreshRuntimeSettings,
    runtimeProfileOptions,
    variantOptions,
    availableStartModes: orderedStartModes,
    selectedStartMode,
    existingSessionOptions,
    selectedSourceSessionValue,
    showTargetBranchSelector,
    targetBranchOptions,
    selectedTargetBranch,
    openStartModal,
    closeStartModal,
    handleSelectStartMode: handleSelectedStartModeChange,
    handleSelectSourceSessionValue,
    handleSelectTargetBranch,
    handleSelectRuntimeProfile,
    handleSelectModelPair,
    handleSelectVariant,
  };
}
