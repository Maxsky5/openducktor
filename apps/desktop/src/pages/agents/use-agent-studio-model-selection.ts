import type { RuntimeKind } from "@openducktor/contracts";
import type {
  AgentFileSearchResult,
  AgentModelCatalog,
  AgentModelSelection,
  AgentRole,
  AgentRuntimeConnection,
  AgentSlashCommandCatalog,
} from "@openducktor/core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  resolveAgentAccentColor,
  toModelGroupsByProvider,
  toModelOptions,
  toPrimaryAgentOptions,
} from "@/components/features/agents";
import type { ComboboxOption } from "@/components/ui/combobox";
import { DEFAULT_RUNTIME_KIND } from "@/lib/agent-runtime";
import { useRuntimeDefinitionsContext } from "@/state/app-state-contexts";
import { findFirstChangedSessionMessageIndex } from "@/state/operations/agent-orchestrator/support/messages";
import {
  sessionFileSearchQueryOptions,
  sessionSlashCommandsQueryOptions,
} from "@/state/queries/agent-session-runtime";
import {
  repoRuntimeCatalogQueryOptions,
  repoRuntimeFileSearchQueryOptions,
  repoRuntimeSlashCommandsQueryOptions,
} from "@/state/queries/runtime-catalog";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import type { ActiveWorkspace, RepoSettingsInput } from "@/types/state-slices";
import { resolveAttachedSessionRuntimeQueryState } from "./agent-studio-session-runtime";
import {
  coerceVisibleSelectionToCatalog,
  emptyDraftSelections,
  isSameSelection,
  pickDefaultVisibleSelectionForCatalog,
} from "./agents-page-selection";
import {
  type AgentStudioContextUsage,
  type AgentStudioContextUsageEntry,
  extractLatestContextUsage,
  extractLatestContextUsageEntry,
  resolveDraftSelection,
  resolveSessionSelection,
  toModelDescriptorByKey,
  toRoleDefaultSelection,
} from "./use-agent-studio-model-selection-model";

type UseAgentStudioModelSelectionArgs = {
  activeWorkspace: ActiveWorkspace | null;
  activeSession: AgentSessionState | null;
  role: AgentRole;
  repoSettings: RepoSettingsInput | null;
  updateAgentSessionModel: (sessionId: string, selection: AgentModelSelection | null) => void;
  loadCatalog?: (repoPath: string, runtimeKind: RuntimeKind) => Promise<AgentModelCatalog>;
  loadSlashCommands?: (
    repoPath: string,
    runtimeKind: RuntimeKind,
  ) => Promise<AgentSlashCommandCatalog>;
  loadFileSearch?: (
    repoPath: string,
    runtimeKind: RuntimeKind,
    query: string,
  ) => Promise<AgentFileSearchResult[]>;
  readSessionSlashCommands?: (
    runtimeKind: RuntimeKind,
    runtimeConnection: AgentRuntimeConnection,
  ) => Promise<AgentSlashCommandCatalog>;
  readSessionFileSearch?: (
    runtimeKind: RuntimeKind,
    runtimeConnection: AgentRuntimeConnection,
    query: string,
  ) => Promise<AgentFileSearchResult[]>;
};

type AgentStudioModelSelectionState = {
  selectionForNewSession: AgentModelSelection | null;
  selectedModelSelection: AgentModelSelection | null;
  selectedModelDescriptor: AgentModelCatalog["models"][number] | null;
  isSelectionCatalogLoading: boolean;
  supportsSlashCommands: boolean;
  supportsFileSearch: boolean;
  slashCommandCatalog: AgentSlashCommandCatalog | null;
  slashCommands: AgentSlashCommandCatalog["commands"];
  slashCommandsError: string | null;
  isSlashCommandsLoading: boolean;
  searchFiles: (query: string) => Promise<AgentFileSearchResult[]>;
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
  activeWorkspace,
  activeSession,
  role,
  repoSettings,
  updateAgentSessionModel,
  loadCatalog,
  loadSlashCommands,
  loadFileSearch,
  readSessionSlashCommands,
  readSessionFileSearch,
}: UseAgentStudioModelSelectionArgs): AgentStudioModelSelectionState {
  const workspaceRepoPath = activeWorkspace?.repoPath ?? null;
  const {
    runtimeDefinitions,
    loadRepoRuntimeCatalog,
    loadRepoRuntimeSlashCommands,
    loadRepoRuntimeFileSearch,
  } = useRuntimeDefinitionsContext();
  const queryClient = useQueryClient();
  const loadCatalogForRepo = loadCatalog ?? loadRepoRuntimeCatalog;
  const loadSlashCommandsForRepo = loadSlashCommands ?? loadRepoRuntimeSlashCommands;
  const loadFileSearchForRepo = loadFileSearch ?? loadRepoRuntimeFileSearch;
  const previousWorkspaceRepoPathRef = useRef<string | null>(workspaceRepoPath);
  const previousWorkspaceRepoPathForDefaultsRef = useRef<string | null>(workspaceRepoPath);
  const previousRepoSettingsRef = useRef<RepoSettingsInput | null>(repoSettings);
  const activeSessionContextUsageCacheRef = useRef<{
    sessionId: string;
    messages: AgentSessionState["messages"];
    sourceIndex: number;
    metadataKey: string;
    key: string;
    value: NonNullable<AgentStudioContextUsage>;
  } | null>(null);
  const [
    isAwaitingRepoSettingsForWorkspaceRepoPath,
    setIsAwaitingRepoSettingsForWorkspaceRepoPath,
  ] = useState(false);
  const [draftSelectionByRole, setDraftSelectionByRole] =
    useState<Record<AgentRole, AgentModelSelection | null>>(emptyDraftSelections);
  const [draftSelectionTouchedByRole, setDraftSelectionTouchedByRole] = useState<
    Record<AgentRole, boolean>
  >(emptyDraftSelectionTouchedByRole);
  const activeSessionId = activeSession?.sessionId ?? null;
  const activeSessionStatus = activeSession?.status ?? null;
  const activeSessionSelectedModel = activeSession?.selectedModel ?? null;
  const activeSessionModelCatalog = activeSession?.modelCatalog ?? null;
  const activeSessionRuntimeKind = activeSession?.runtimeKind ?? null;
  const activeSessionRuntimeRoute = activeSession?.runtimeRoute ?? null;
  const activeSessionWorkingDirectory = activeSession?.workingDirectory?.trim() ?? "";
  const activeSessionIsLoadingModelCatalog = activeSession?.isLoadingModelCatalog === true;
  const activeSessionLiveContextUsage = activeSession?.contextUsage ?? null;
  const activeSessionMessages = activeSession?.messages ?? null;
  const hasActiveSession = activeSessionId !== null;
  const roleDefaultSelection = useMemo<AgentModelSelection | null>(() => {
    return toRoleDefaultSelection(repoSettings?.agentDefaults[role]);
  }, [repoSettings?.agentDefaults, role]);
  const composerRuntimeKind = useMemo<RuntimeKind>(() => {
    return (
      activeSessionSelectedModel?.runtimeKind ??
      draftSelectionByRole[role]?.runtimeKind ??
      roleDefaultSelection?.runtimeKind ??
      repoSettings?.defaultRuntimeKind ??
      DEFAULT_RUNTIME_KIND
    );
  }, [
    activeSessionSelectedModel?.runtimeKind,
    draftSelectionByRole,
    repoSettings?.defaultRuntimeKind,
    role,
    roleDefaultSelection?.runtimeKind,
  ]);
  const activeSessionRuntimeQueryState = useMemo(
    () =>
      resolveAttachedSessionRuntimeQueryState(
        hasActiveSession
          ? {
              runtimeKind: activeSessionRuntimeKind,
              runtimeRoute: activeSessionRuntimeRoute,
              workingDirectory: activeSessionWorkingDirectory,
            }
          : null,
        "active session runtime queries",
      ),
    [
      activeSessionRuntimeKind,
      activeSessionRuntimeRoute,
      activeSessionWorkingDirectory,
      hasActiveSession,
    ],
  );
  const activeSessionRuntimeQueryInput = activeSessionRuntimeQueryState.runtimeQueryInput;
  const activeSessionRuntimeQueryError = activeSessionRuntimeQueryState.runtimeQueryError;
  const slashCommandRuntimeKind =
    activeSessionRuntimeQueryInput?.runtimeKind ?? composerRuntimeKind;
  const supportsSlashCommands = useMemo(() => {
    return (
      runtimeDefinitions.find((definition) => definition.kind === slashCommandRuntimeKind)
        ?.capabilities.supportsSlashCommands ?? false
    );
  }, [runtimeDefinitions, slashCommandRuntimeKind]);
  const fileSearchRuntimeKind = activeSessionRuntimeQueryInput?.runtimeKind ?? composerRuntimeKind;
  const supportsFileSearch = useMemo(() => {
    return (
      runtimeDefinitions.find((definition) => definition.kind === fileSearchRuntimeKind)
        ?.capabilities.supportsFileSearch ?? false
    );
  }, [fileSearchRuntimeKind, runtimeDefinitions]);

  useEffect(() => {
    if (previousWorkspaceRepoPathRef.current === workspaceRepoPath) {
      return;
    }
    previousWorkspaceRepoPathRef.current = workspaceRepoPath;
    setDraftSelectionByRole(emptyDraftSelections());
    setDraftSelectionTouchedByRole(emptyDraftSelectionTouchedByRole());
  }, [workspaceRepoPath]);

  useEffect(() => {
    if (previousWorkspaceRepoPathForDefaultsRef.current !== workspaceRepoPath) {
      previousWorkspaceRepoPathForDefaultsRef.current = workspaceRepoPath;
      previousRepoSettingsRef.current = repoSettings;
      setIsAwaitingRepoSettingsForWorkspaceRepoPath(
        Boolean(workspaceRepoPath) && repoSettings == null,
      );
      return;
    }

    if (!isAwaitingRepoSettingsForWorkspaceRepoPath) {
      previousRepoSettingsRef.current = repoSettings;
      return;
    }

    if (repoSettings != null) {
      previousRepoSettingsRef.current = repoSettings;
      setIsAwaitingRepoSettingsForWorkspaceRepoPath(false);
    }
  }, [workspaceRepoPath, isAwaitingRepoSettingsForWorkspaceRepoPath, repoSettings]);

  const composerCatalogQuery = useQuery({
    ...repoRuntimeCatalogQueryOptions(
      workspaceRepoPath ?? "",
      composerRuntimeKind,
      loadCatalogForRepo,
    ),
    enabled: workspaceRepoPath !== null && activeSession == null,
    queryFn: async (): Promise<AgentModelCatalog> => {
      if (!workspaceRepoPath) {
        throw new Error("No repository selected.");
      }
      return loadCatalogForRepo(workspaceRepoPath, composerRuntimeKind);
    },
  });
  const composerCatalog = composerCatalogQuery.data ?? null;
  const isLoadingComposerCatalog = composerCatalogQuery.isLoading;
  const activeSessionSlashCommandsQuery = useQuery({
    ...(activeSessionRuntimeQueryInput && readSessionSlashCommands
      ? sessionSlashCommandsQueryOptions(
          activeSessionRuntimeQueryInput.runtimeKind,
          activeSessionRuntimeQueryInput.runtimeConnection,
          readSessionSlashCommands,
        )
      : {
          queryKey: ["agent-session-runtime", "slash-commands", "", "", ""] as const,
          queryFn: async (): Promise<AgentSlashCommandCatalog> => {
            throw new Error("Session slash commands query is disabled.");
          },
        }),
    enabled:
      supportsSlashCommands &&
      hasActiveSession &&
      activeSessionStatus !== "starting" &&
      activeSessionRuntimeQueryInput !== null &&
      activeSessionRuntimeQueryError === null &&
      readSessionSlashCommands !== undefined,
  });
  const repoSlashCommandsQuery = useQuery({
    ...repoRuntimeSlashCommandsQueryOptions(
      workspaceRepoPath ?? "",
      composerRuntimeKind,
      loadSlashCommandsForRepo,
    ),
    enabled: supportsSlashCommands && workspaceRepoPath !== null && activeSession == null,
  });
  const hasDraftSelectionForWorkspaceRepoPath =
    previousWorkspaceRepoPathRef.current === workspaceRepoPath;
  const isDraftSelectionTouched = hasDraftSelectionForWorkspaceRepoPath
    ? draftSelectionTouchedByRole[role]
    : false;

  useEffect(() => {
    if (hasActiveSession) {
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
  }, [composerCatalog, hasActiveSession, isDraftSelectionTouched, role, roleDefaultSelection]);

  useEffect(() => {
    if (!activeSessionId) {
      return;
    }
    const preferredSelection = resolveSessionSelection({
      catalog: activeSessionModelCatalog,
      selectedModel: activeSessionSelectedModel,
      roleDefaultSelection,
    });
    if (!preferredSelection || isSameSelection(activeSessionSelectedModel, preferredSelection)) {
      return;
    }
    updateAgentSessionModel(activeSessionId, preferredSelection);
  }, [
    activeSessionId,
    activeSessionModelCatalog,
    activeSessionSelectedModel,
    roleDefaultSelection,
    updateAgentSessionModel,
  ]);

  const draftSelection = hasDraftSelectionForWorkspaceRepoPath ? draftSelectionByRole[role] : null;
  const roleDefaultSelectionForComposer = useMemo<AgentModelSelection | null>(() => {
    if (activeSession) {
      return roleDefaultSelection;
    }
    if (!composerCatalog) {
      return isAwaitingRepoSettingsForWorkspaceRepoPath ? null : roleDefaultSelection;
    }
    return coerceVisibleSelectionToCatalog(composerCatalog, roleDefaultSelection);
  }, [
    activeSession,
    composerCatalog,
    isAwaitingRepoSettingsForWorkspaceRepoPath,
    roleDefaultSelection,
  ]);
  const selectionCatalog = activeSessionModelCatalog ?? composerCatalog;
  const slashCommandCatalog = activeSession
    ? (activeSessionSlashCommandsQuery.data ?? null)
    : (repoSlashCommandsQuery.data ?? null);
  const slashCommands = slashCommandCatalog?.commands ?? [];
  const slashCommandsError = supportsSlashCommands
    ? activeSession
      ? activeSessionSlashCommandsQuery.error instanceof Error
        ? activeSessionSlashCommandsQuery.error.message
        : null
      : repoSlashCommandsQuery.error instanceof Error
        ? repoSlashCommandsQuery.error.message
        : null
    : null;
  const isSlashCommandsLoading = supportsSlashCommands
    ? activeSession
      ? activeSessionSlashCommandsQuery.isLoading
      : repoSlashCommandsQuery.isLoading
    : false;
  const searchFiles = useCallback(
    async (query: string): Promise<AgentFileSearchResult[]> => {
      if (!supportsFileSearch) {
        return [];
      }
      if (hasActiveSession) {
        if (activeSessionRuntimeQueryError) {
          throw new Error(activeSessionRuntimeQueryError);
        }
        if (activeSessionRuntimeQueryInput == null || readSessionFileSearch == null) {
          throw new Error(
            "Active session file search is unavailable until the session runtime connection is ready.",
          );
        }
        return queryClient.fetchQuery(
          sessionFileSearchQueryOptions(
            activeSessionRuntimeQueryInput.runtimeKind,
            activeSessionRuntimeQueryInput.runtimeConnection,
            query,
            readSessionFileSearch,
          ),
        );
      }
      if (!workspaceRepoPath) {
        throw new Error("No repository selected.");
      }
      return queryClient.fetchQuery(
        repoRuntimeFileSearchQueryOptions(
          workspaceRepoPath,
          composerRuntimeKind,
          query,
          loadFileSearchForRepo,
        ),
      );
    },
    [
      workspaceRepoPath,
      hasActiveSession,
      activeSessionRuntimeQueryInput,
      activeSessionRuntimeQueryError,
      composerRuntimeKind,
      loadFileSearchForRepo,
      queryClient,
      readSessionFileSearch,
      supportsFileSearch,
    ],
  );
  const isSelectionCatalogLoading = hasActiveSession
    ? activeSessionIsLoadingModelCatalog && !activeSessionModelCatalog && !composerCatalog
    : isLoadingComposerCatalog;
  const fallbackCatalogSelection = useMemo(
    () => pickDefaultVisibleSelectionForCatalog(selectionCatalog),
    [selectionCatalog],
  );
  const selectedModelSelection = useMemo(
    () =>
      activeSessionSelectedModel ??
      draftSelection ??
      roleDefaultSelectionForComposer ??
      fallbackCatalogSelection ??
      null,
    [
      activeSessionSelectedModel,
      draftSelection,
      fallbackCatalogSelection,
      roleDefaultSelectionForComposer,
    ],
  );

  const applySelection = useCallback(
    (selection: AgentModelSelection | null): void => {
      if (activeSessionId) {
        updateAgentSessionModel(activeSessionId, selection);
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
    [activeSessionId, role, updateAgentSessionModel],
  );

  const selectionForNewSession = useMemo(
    () =>
      draftSelection ??
      roleDefaultSelectionForComposer ??
      coerceVisibleSelectionToCatalog(selectionCatalog, fallbackCatalogSelection) ??
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
    for (const descriptor of selectionCatalog.profiles ?? []) {
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

  const activeSessionIdForContextUsage = activeSession?.sessionId ?? null;
  const activeSessionMessagesForContextUsage = activeSessionMessages;
  const activeSessionMessageOwnerForContextUsage = useMemo(
    () =>
      activeSessionIdForContextUsage && activeSessionMessagesForContextUsage
        ? {
            sessionId: activeSessionIdForContextUsage,
            messages: activeSessionMessagesForContextUsage,
          }
        : null,
    [activeSessionIdForContextUsage, activeSessionMessagesForContextUsage],
  );
  const activeSessionModelDescriptorByKey = useMemo(() => {
    return toModelDescriptorByKey(activeSessionModelCatalog ?? null);
  }, [activeSessionModelCatalog]);

  const activeSessionContextUsage = useMemo<AgentStudioContextUsage>(() => {
    const fallbackContextWindow =
      typeof selectedModelEntry?.contextWindow === "number"
        ? selectedModelEntry.contextWindow
        : null;
    const fallbackOutputLimit =
      typeof selectedModelEntry?.outputLimit === "number" ? selectedModelEntry.outputLimit : null;
    const metadataKey = [
      activeSessionIdForContextUsage ?? "",
      selectedModelSelection?.providerId ?? "",
      selectedModelSelection?.modelId ?? "",
      selectedModelEntry?.contextWindow ?? "",
      selectedModelEntry?.outputLimit ?? "",
    ].join(":");
    const commitCachedUsage = (
      usage: NonNullable<AgentStudioContextUsage>,
      sourceIndex: number,
      messages: AgentSessionState["messages"],
    ): NonNullable<AgentStudioContextUsage> => {
      const nextKey = [usage.totalTokens, usage.contextWindow, usage.outputLimit ?? ""].join(":");
      const cached = activeSessionContextUsageCacheRef.current;
      if (cached?.key === nextKey && cached.metadataKey === metadataKey) {
        activeSessionContextUsageCacheRef.current = {
          sessionId: activeSessionIdForContextUsage ?? cached.sessionId,
          messages,
          sourceIndex,
          metadataKey,
          key: cached.key,
          value: cached.value,
        };
        return cached.value;
      }

      activeSessionContextUsageCacheRef.current = {
        sessionId: activeSessionIdForContextUsage ?? "",
        messages,
        sourceIndex,
        metadataKey,
        key: nextKey,
        value: usage,
      };
      return usage;
    };

    if (activeSessionLiveContextUsage !== null) {
      const nextUsage = extractLatestContextUsage({
        session: activeSessionMessageOwnerForContextUsage,
        liveContextUsage: activeSessionLiveContextUsage,
        modelDescriptorByKey: activeSessionModelDescriptorByKey,
        ...(fallbackContextWindow !== null ? { fallbackContextWindow } : {}),
        ...(fallbackOutputLimit !== null ? { fallbackOutputLimit } : {}),
      });
      if (nextUsage === null) {
        activeSessionContextUsageCacheRef.current = null;
        return null;
      }

      return commitCachedUsage(
        nextUsage,
        Number.MAX_SAFE_INTEGER,
        activeSessionMessages ?? activeSessionMessageOwnerForContextUsage?.messages ?? [],
      );
    }

    let nextUsageEntry: AgentStudioContextUsageEntry = null;
    if (activeSessionMessageOwnerForContextUsage) {
      const cached = activeSessionContextUsageCacheRef.current;
      if (
        cached &&
        activeSessionIdForContextUsage !== null &&
        cached.sessionId === activeSessionIdForContextUsage &&
        cached.metadataKey === metadataKey
      ) {
        const firstChangedMessageIndex = findFirstChangedSessionMessageIndex(
          cached.messages,
          activeSessionMessageOwnerForContextUsage,
        );
        if (firstChangedMessageIndex < 0) {
          return cached.value;
        }

        nextUsageEntry = extractLatestContextUsageEntry({
          session: activeSessionMessageOwnerForContextUsage,
          modelDescriptorByKey: activeSessionModelDescriptorByKey,
          ...(fallbackContextWindow !== null ? { fallbackContextWindow } : {}),
          ...(fallbackOutputLimit !== null ? { fallbackOutputLimit } : {}),
          startIndex: firstChangedMessageIndex,
        });

        if (!nextUsageEntry && cached.sourceIndex < firstChangedMessageIndex) {
          activeSessionContextUsageCacheRef.current = {
            ...cached,
            messages: activeSessionMessageOwnerForContextUsage.messages,
            metadataKey,
          };
          return cached.value;
        }

        if (!nextUsageEntry && firstChangedMessageIndex > 0) {
          nextUsageEntry = extractLatestContextUsageEntry({
            session: activeSessionMessageOwnerForContextUsage,
            modelDescriptorByKey: activeSessionModelDescriptorByKey,
            ...(fallbackContextWindow !== null ? { fallbackContextWindow } : {}),
            ...(fallbackOutputLimit !== null ? { fallbackOutputLimit } : {}),
            endIndex: firstChangedMessageIndex - 1,
          });
        }
      } else {
        nextUsageEntry = extractLatestContextUsageEntry({
          session: activeSessionMessageOwnerForContextUsage,
          modelDescriptorByKey: activeSessionModelDescriptorByKey,
          ...(fallbackContextWindow !== null ? { fallbackContextWindow } : {}),
          ...(fallbackOutputLimit !== null ? { fallbackOutputLimit } : {}),
        });
      }
    }

    if (nextUsageEntry === null) {
      activeSessionContextUsageCacheRef.current = null;
      return null;
    }

    return commitCachedUsage(
      nextUsageEntry.usage,
      nextUsageEntry.sourceIndex,
      activeSessionMessageOwnerForContextUsage?.messages ?? [],
    );
  }, [
    activeSessionLiveContextUsage,
    activeSessionIdForContextUsage,
    activeSessionMessages,
    activeSessionMessageOwnerForContextUsage,
    activeSessionModelDescriptorByKey,
    selectedModelSelection?.modelId,
    selectedModelSelection?.providerId,
    selectedModelEntry?.contextWindow,
    selectedModelEntry?.outputLimit,
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
    selectedModelDescriptor: selectedModelEntry,
    isSelectionCatalogLoading,
    supportsSlashCommands,
    supportsFileSearch,
    slashCommandCatalog,
    slashCommands,
    slashCommandsError,
    isSlashCommandsLoading,
    searchFiles,
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
