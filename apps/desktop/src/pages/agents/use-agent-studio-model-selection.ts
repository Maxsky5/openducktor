import type { RuntimeKind } from "@openducktor/contracts";
import type { AgentModelCatalog, AgentModelSelection, AgentRole } from "@openducktor/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  resolveAgentAccentColor,
  toModelGroupsByProvider,
  toModelOptions,
  toPrimaryAgentOptions,
} from "@/components/features/agents";
import type { ComboboxOption } from "@/components/ui/combobox";
import { DEFAULT_RUNTIME_KIND } from "@/lib/agent-runtime";
import { loadRepoRuntimeCatalog } from "@/state/operations";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import type { RepoSettingsInput } from "@/types/state-slices";
import {
  emptyDraftSelections,
  isSameSelection,
  normalizeSelectionForCatalog,
  pickDefaultSelectionForCatalog,
} from "./agents-page-utils";
import {
  type AgentStudioContextUsage,
  extractLatestContextUsage,
  resolveDraftSelection,
  resolveSessionSelection,
  toModelDescriptorByKey,
  toRoleDefaultSelection,
} from "./use-agent-studio-model-selection-model";

type UseAgentStudioModelSelectionArgs = {
  activeRepo: string | null;
  activeSession: AgentSessionState | null;
  role: AgentRole;
  repoSettings: RepoSettingsInput | null;
  updateAgentSessionModel: (sessionId: string, selection: AgentModelSelection | null) => void;
  loadCatalog?: (repoPath: string, runtimeKind: RuntimeKind) => Promise<AgentModelCatalog>;
};

export type AgentStudioModelSelectionState = {
  selectionForNewSession: AgentModelSelection | null;
  selectedModelSelection: AgentModelSelection | null;
  isSelectionCatalogLoading: boolean;
  agentOptions: ComboboxOption[];
  modelOptions: ComboboxOption[];
  modelGroups: ReturnType<typeof toModelGroupsByProvider>;
  variantOptions: ComboboxOption[];
  activeSessionAgentColors: Record<string, string>;
  activeSessionContextUsage: AgentStudioContextUsage;
  handleSelectAgent: (profileId: string) => void;
  handleSelectModel: (modelKey: string) => void;
  handleSelectVariant: (variant: string) => void;
};

const emptyDraftSelectionTouchedByRole = (): Record<AgentRole, boolean> => ({
  spec: false,
  planner: false,
  build: false,
  qa: false,
});

export function useAgentStudioModelSelection({
  activeRepo,
  activeSession,
  role,
  repoSettings,
  updateAgentSessionModel,
  loadCatalog = loadRepoRuntimeCatalog,
}: UseAgentStudioModelSelectionArgs): AgentStudioModelSelectionState {
  const previousActiveRepoRef = useRef<string | null>(activeRepo);
  const previousRepoForDefaultsRef = useRef<string | null>(activeRepo);
  const previousRepoSettingsRef = useRef<RepoSettingsInput | null>(repoSettings);
  const [composerCatalog, setComposerCatalog] = useState<AgentModelCatalog | null>(null);
  const [isLoadingComposerCatalog, setIsLoadingComposerCatalog] = useState(false);
  const [isAwaitingRepoSettingsForActiveRepo, setIsAwaitingRepoSettingsForActiveRepo] =
    useState(false);
  const [draftSelectionByRole, setDraftSelectionByRole] =
    useState<Record<AgentRole, AgentModelSelection | null>>(emptyDraftSelections);
  const [draftSelectionTouchedByRole, setDraftSelectionTouchedByRole] = useState<
    Record<AgentRole, boolean>
  >(emptyDraftSelectionTouchedByRole);
  const roleDefaultSelection = useMemo<AgentModelSelection | null>(() => {
    return toRoleDefaultSelection(repoSettings?.agentDefaults[role]);
  }, [repoSettings?.agentDefaults, role]);
  const composerRuntimeKind = useMemo<RuntimeKind>(() => {
    return (
      activeSession?.selectedModel?.runtimeKind ??
      draftSelectionByRole[role]?.runtimeKind ??
      roleDefaultSelection?.runtimeKind ??
      repoSettings?.defaultRuntimeKind ??
      DEFAULT_RUNTIME_KIND
    );
  }, [
    activeSession?.selectedModel?.runtimeKind,
    draftSelectionByRole,
    repoSettings?.defaultRuntimeKind,
    role,
    roleDefaultSelection?.runtimeKind,
  ]);

  useEffect(() => {
    if (previousActiveRepoRef.current === activeRepo) {
      return;
    }
    previousActiveRepoRef.current = activeRepo;
    setDraftSelectionByRole(emptyDraftSelections());
    setDraftSelectionTouchedByRole(emptyDraftSelectionTouchedByRole());
  }, [activeRepo]);

  useEffect(() => {
    if (previousRepoForDefaultsRef.current !== activeRepo) {
      previousRepoForDefaultsRef.current = activeRepo;
      previousRepoSettingsRef.current = repoSettings;
      setIsAwaitingRepoSettingsForActiveRepo(Boolean(activeRepo));
      return;
    }

    if (!isAwaitingRepoSettingsForActiveRepo) {
      previousRepoSettingsRef.current = repoSettings;
      return;
    }

    if (previousRepoSettingsRef.current !== repoSettings) {
      previousRepoSettingsRef.current = repoSettings;
      setIsAwaitingRepoSettingsForActiveRepo(false);
    }
  }, [activeRepo, isAwaitingRepoSettingsForActiveRepo, repoSettings]);

  useEffect(() => {
    if (!activeRepo) {
      setComposerCatalog(null);
      setIsLoadingComposerCatalog(false);
      return;
    }
    let cancelled = false;
    setComposerCatalog(null);
    setIsLoadingComposerCatalog(true);
    void loadCatalog(activeRepo, composerRuntimeKind)
      .then((catalog) => {
        if (!cancelled) {
          setComposerCatalog(catalog);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setComposerCatalog(null);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoadingComposerCatalog(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [activeRepo, composerRuntimeKind, loadCatalog]);
  const isDraftSelectionTouched = draftSelectionTouchedByRole[role];

  useEffect(() => {
    if (activeSession) {
      return;
    }
    if (!composerCatalog) {
      setDraftSelectionByRole((current) => {
        if (current[role] === null) {
          return current;
        }
        return {
          ...current,
          [role]: null,
        };
      });
      setDraftSelectionTouchedByRole((current) => {
        if (!current[role]) {
          return current;
        }
        return {
          ...current,
          [role]: false,
        };
      });
      return;
    }
    setDraftSelectionByRole((current) => {
      const existing = current[role];
      const normalized = resolveDraftSelection({
        catalog: composerCatalog,
        existingSelection: isDraftSelectionTouched ? existing : null,
        roleDefaultSelection,
      });
      if (isSameSelection(existing, normalized)) {
        return current;
      }
      return {
        ...current,
        [role]: normalized,
      };
    });
  }, [activeSession, composerCatalog, isDraftSelectionTouched, role, roleDefaultSelection]);

  useEffect(() => {
    if (!activeSession) {
      return;
    }
    const preferredSelection = resolveSessionSelection({
      catalog: activeSession.modelCatalog,
      selectedModel: activeSession.selectedModel,
      roleDefaultSelection,
    });
    if (!preferredSelection || isSameSelection(activeSession.selectedModel, preferredSelection)) {
      return;
    }
    updateAgentSessionModel(activeSession.sessionId, preferredSelection);
  }, [activeSession, roleDefaultSelection, updateAgentSessionModel]);

  const draftSelection = draftSelectionByRole[role];
  const roleDefaultSelectionForComposer = useMemo<AgentModelSelection | null>(() => {
    if (activeSession) {
      return roleDefaultSelection;
    }
    if (!composerCatalog) {
      return isAwaitingRepoSettingsForActiveRepo ? null : roleDefaultSelection;
    }
    return normalizeSelectionForCatalog(composerCatalog, roleDefaultSelection);
  }, [activeSession, composerCatalog, isAwaitingRepoSettingsForActiveRepo, roleDefaultSelection]);
  const selectionCatalog = activeSession?.modelCatalog ?? composerCatalog;
  const isSelectionCatalogLoading = activeSession
    ? activeSession.isLoadingModelCatalog && !activeSession.modelCatalog && !composerCatalog
    : isLoadingComposerCatalog;
  const fallbackCatalogSelection = useMemo(
    () => pickDefaultSelectionForCatalog(selectionCatalog),
    [selectionCatalog],
  );
  const selectedModelSelection = useMemo(
    () =>
      activeSession?.selectedModel ??
      draftSelection ??
      roleDefaultSelectionForComposer ??
      fallbackCatalogSelection ??
      null,
    [
      activeSession?.selectedModel,
      draftSelection,
      fallbackCatalogSelection,
      roleDefaultSelectionForComposer,
    ],
  );

  const applySelection = useCallback(
    (selection: AgentModelSelection | null): void => {
      if (activeSession) {
        updateAgentSessionModel(activeSession.sessionId, selection);
        return;
      }
      setDraftSelectionByRole((current) => ({
        ...current,
        [role]: selection,
      }));
      setDraftSelectionTouchedByRole((current) => ({
        ...current,
        [role]: true,
      }));
    },
    [activeSession, role, updateAgentSessionModel],
  );

  const selectionForNewSession = useMemo(
    () =>
      draftSelection ??
      roleDefaultSelectionForComposer ??
      normalizeSelectionForCatalog(selectionCatalog, fallbackCatalogSelection) ??
      fallbackCatalogSelection ??
      null,
    [draftSelection, fallbackCatalogSelection, roleDefaultSelectionForComposer, selectionCatalog],
  );

  const agentOptions = useMemo<ComboboxOption[]>(() => {
    const options = toPrimaryAgentOptions(selectionCatalog);
    if (options.length > 0) {
      return options;
    }
    const fallbackAgent = selectedModelSelection?.profileId;
    const fallbackAgentColor = resolveAgentAccentColor(fallbackAgent);
    if (fallbackAgent && fallbackAgent.trim().length > 0) {
      return [
        {
          value: fallbackAgent,
          label: fallbackAgent,
          description: "Current session agent",
          ...(fallbackAgentColor ? { accentColor: fallbackAgentColor } : {}),
        },
      ];
    }
    return [];
  }, [selectedModelSelection?.profileId, selectionCatalog]);

  const modelOptions = useMemo<ComboboxOption[]>(() => {
    const options = toModelOptions(selectionCatalog);
    if (options.length > 0) {
      return options;
    }
    const selected = selectedModelSelection;
    if (selected?.providerId && selected.modelId) {
      return [
        {
          value: `${selected.providerId}/${selected.modelId}`,
          label: selected.modelId,
          description: `${selected.providerId} (current session model)`,
        },
      ];
    }
    return [];
  }, [selectedModelSelection, selectionCatalog]);

  const modelGroups = useMemo(() => toModelGroupsByProvider(selectionCatalog), [selectionCatalog]);

  const selectedModelEntry = useMemo(() => {
    if (!selectionCatalog || !selectedModelSelection) {
      return null;
    }
    return (
      selectionCatalog.models.find(
        (entry) =>
          entry.providerId === selectedModelSelection.providerId &&
          entry.modelId === selectedModelSelection.modelId,
      ) ?? null
    );
  }, [selectedModelSelection, selectionCatalog]);

  const variantOptions = useMemo(() => {
    if (!selectedModelEntry) {
      const selectedVariant = selectedModelSelection?.variant;
      if (selectedVariant && selectedVariant.trim().length > 0) {
        return [
          {
            value: selectedVariant,
            label: selectedVariant,
          },
        ];
      }
      return [];
    }
    return selectedModelEntry.variants.map((variant) => ({
      value: variant,
      label: variant,
    }));
  }, [selectedModelEntry, selectedModelSelection?.variant]);

  const activeSessionAgentColors = useMemo<Record<string, string>>(() => {
    if (!selectionCatalog) {
      return {};
    }
    const map: Record<string, string> = {};
    for (const descriptor of selectionCatalog.profiles ?? selectionCatalog.agents ?? []) {
      const descriptorId = descriptor.id ?? descriptor.name;
      const descriptorLabel = descriptor.label ?? descriptor.name;
      if (!descriptorId || !descriptorLabel) {
        continue;
      }
      const color = resolveAgentAccentColor(descriptorLabel, descriptor.color);
      if (color) {
        map[descriptorId] = color;
      }
    }
    return map;
  }, [selectionCatalog]);

  const activeSessionMessages = activeSession?.messages;
  const activeSessionModelCatalog = activeSession?.modelCatalog;
  const activeSessionModelDescriptorByKey = useMemo(() => {
    return toModelDescriptorByKey(activeSessionModelCatalog ?? null);
  }, [activeSessionModelCatalog]);

  const activeSessionContextUsage = useMemo<AgentStudioContextUsage>(() => {
    return extractLatestContextUsage({
      messages: activeSessionMessages,
      ...(activeSession?.contextUsage !== undefined
        ? { liveContextUsage: activeSession.contextUsage }
        : {}),
      modelDescriptorByKey: activeSessionModelDescriptorByKey,
      ...(typeof selectedModelEntry?.contextWindow === "number"
        ? { fallbackContextWindow: selectedModelEntry.contextWindow }
        : {}),
    });
  }, [
    activeSession?.contextUsage,
    activeSessionMessages,
    activeSessionModelDescriptorByKey,
    selectedModelEntry?.contextWindow,
  ]);

  const handleSelectAgent = useCallback(
    (profileId: string) => {
      const baseSelection =
        selectedModelSelection ??
        (() => {
          const firstModel = selectionCatalog?.models[0];
          if (!firstModel) {
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
      applySelection({
        ...baseSelection,
        profileId,
      });
    },
    [applySelection, composerRuntimeKind, selectedModelSelection, selectionCatalog],
  );

  const handleSelectModel = useCallback(
    (nextValue: string) => {
      if (!selectionCatalog) {
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
      applySelection({
        ...selectedModelSelection,
        variant,
      });
    },
    [applySelection, selectedModelSelection],
  );

  return {
    selectionForNewSession,
    selectedModelSelection,
    isSelectionCatalogLoading,
    agentOptions,
    modelOptions,
    modelGroups,
    variantOptions,
    activeSessionAgentColors,
    activeSessionContextUsage,
    handleSelectAgent,
    handleSelectModel,
    handleSelectVariant,
  };
}
