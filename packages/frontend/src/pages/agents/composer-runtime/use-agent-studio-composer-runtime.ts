import type { ReusablePrompt, RuntimeKind } from "@openducktor/contracts";
import type {
  AgentFileSearchResult,
  AgentModelCatalog,
  AgentModelSelection,
  AgentRole,
  AgentSlashCommandCatalog,
} from "@openducktor/core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import type { ComboboxOption } from "@/components/ui/combobox";
import { DEFAULT_RUNTIME_KIND } from "@/lib/agent-runtime";
import type { AgentSessionSummary } from "@/state/agent-sessions-store";
import { useRuntimeDefinitionsContext } from "@/state/app-state-contexts";
import { resolveAttachedSessionRuntimeQueryState } from "@/state/operations/agent-orchestrator/support/session-runtime-query-state";
import { repoRuntimeCatalogQueryOptions } from "@/state/queries/runtime-catalog";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import type { ActiveWorkspace, RepoSettingsInput } from "@/types/state-slices";
import { pickDefaultVisibleSelectionForCatalog } from "../agents-page-selection";
import type { AgentStudioContextUsage } from "./context-usage-resolution";
import { resolveModelSelectionOptions } from "./model-selection-options";
import { toRoleDefaultModelSelection } from "./model-selection-preferences";
import {
  resolveActiveSessionSelectionState,
  resolveComposerRuntimeKind,
  resolveRoleDefaultSelectionForComposer,
  resolveRuntimePromptInputSupport,
  resolveSelectedModelSelection,
  resolveSelectionCatalogLoading,
  resolveSelectionForNewSession,
} from "./model-selection-resolution";
import { useAgentStudioActiveSessionModelRepair } from "./use-active-session-model-repair";
import { useAgentStudioContextUsage } from "./use-context-usage";
import { useAgentStudioDraftModelSelectionState } from "./use-draft-model-selection";
import { createAgentStudioFileSearch } from "./use-file-search";
import { useAgentStudioModelSelectionHandlers } from "./use-model-selection-handlers";
import { useAgentStudioSlashCommands } from "./use-slash-commands";

export { resolveActiveSessionSelectionState } from "./model-selection-resolution";

type UseAgentStudioComposerRuntimeArgs = {
  activeWorkspace: ActiveWorkspace | null;
  activeSession: AgentSessionState | null;
  activeSessionSummary: AgentSessionSummary | null;
  role: AgentRole;
  reusablePrompts: ReusablePrompt[];
  repoSettings: RepoSettingsInput | null;
  updateAgentSessionModel: (
    externalSessionId: string,
    selection: AgentModelSelection | null,
  ) => void;
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
    repoPath: string,
    runtimeKind: RuntimeKind,
  ) => Promise<AgentSlashCommandCatalog>;
  readSessionFileSearch?: (
    repoPath: string,
    runtimeKind: RuntimeKind,
    workingDirectory: string,
    query: string,
  ) => Promise<AgentFileSearchResult[]>;
};

type AgentStudioComposerRuntimeState = {
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
  modelGroups: ReturnType<typeof resolveModelSelectionOptions>["modelGroups"];
  variantOptions: ComboboxOption[];
  activeSessionAgentColors: Record<string, string>;
  activeSessionContextUsage: AgentStudioContextUsage;
  handleSelectAgent: (profileId: string) => void;
  handleSelectModel: (modelKey: string) => void;
  handleSelectVariant: (variant: string) => void;
};

export function useAgentStudioComposerRuntime({
  activeWorkspace,
  activeSession,
  activeSessionSummary,
  role,
  reusablePrompts,
  repoSettings,
  updateAgentSessionModel,
  loadCatalog,
  loadSlashCommands,
  loadFileSearch,
  readSessionSlashCommands,
  readSessionFileSearch,
}: UseAgentStudioComposerRuntimeArgs): AgentStudioComposerRuntimeState {
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
  const activeSessionSelection = useMemo(
    () => resolveActiveSessionSelectionState(activeSession, activeSessionSummary),
    [activeSession, activeSessionSummary],
  );
  const activeExternalSessionId = activeSessionSelection.externalSessionId;
  const activeSessionStatus = activeSessionSelection.status;
  const activeSessionSelectedModel = activeSessionSelection.selectedModel;
  const activeSessionModelCatalog = activeSessionSelection.modelCatalog;
  const activeSessionRuntimeKind = activeSessionSelection.runtimeKind;
  const activeSessionRepoPath = activeSessionSelection.repoPath;
  const activeSessionWorkingDirectory = activeSessionSelection.workingDirectory;
  const activeSessionIsLoadingModelCatalog = activeSessionSelection.isLoadingModelCatalog;
  const activeSessionLiveContextUsage = activeSessionSelection.liveContextUsage ?? null;
  const activeSessionMessages = activeSessionSelection.messages;
  const hasActiveSession = activeSessionSelection.hasSelection;
  const roleDefaultSelection = useMemo<AgentModelSelection | null>(() => {
    return toRoleDefaultModelSelection(
      repoSettings?.agentDefaults[role],
      repoSettings?.defaultRuntimeKind,
    );
  }, [repoSettings?.agentDefaults, repoSettings?.defaultRuntimeKind, role]);
  const {
    draftSelection,
    isAwaitingRepoSettingsForWorkspaceRepoPath,
    applyDraftSelection,
    repairDraftSelection,
  } = useAgentStudioDraftModelSelectionState({ workspaceRepoPath, repoSettings, role });
  const composerRuntimeKind = useMemo<RuntimeKind | null>(() => {
    return resolveComposerRuntimeKind({
      activeSessionSelectedModel,
      draftSelection,
      roleDefaultSelection,
      repoDefaultRuntimeKind: repoSettings?.defaultRuntimeKind ?? null,
    });
  }, [
    activeSessionSelectedModel,
    draftSelection,
    repoSettings?.defaultRuntimeKind,
    roleDefaultSelection,
  ]);
  const activeSessionRuntimeQueryState = useMemo(
    () =>
      resolveAttachedSessionRuntimeQueryState(
        hasActiveSession
          ? {
              repoPath: activeSessionRepoPath,
              runtimeKind: activeSessionRuntimeKind,
              workingDirectory: activeSessionWorkingDirectory,
            }
          : null,
      ),
    [
      activeSessionRepoPath,
      activeSessionRuntimeKind,
      activeSessionWorkingDirectory,
      hasActiveSession,
    ],
  );
  const activeSessionRuntimeQueryInput = activeSessionRuntimeQueryState.runtimeQueryInput;
  const activeSessionRuntimeQueryError = activeSessionRuntimeQueryState.runtimeQueryError;
  const { runtimeSupportsSlashCommands, supportsFileSearch } = useMemo(
    () =>
      resolveRuntimePromptInputSupport({
        runtimeDefinitions,
        readyActiveSessionRuntimeKind: activeSessionRuntimeQueryInput?.runtimeKind ?? null,
        composerRuntimeKind,
      }),
    [activeSessionRuntimeQueryInput?.runtimeKind, composerRuntimeKind, runtimeDefinitions],
  );

  const composerCatalogQuery = useQuery({
    ...repoRuntimeCatalogQueryOptions(
      workspaceRepoPath ?? "",
      composerRuntimeKind ?? DEFAULT_RUNTIME_KIND,
      loadCatalogForRepo,
    ),
    enabled:
      workspaceRepoPath !== null &&
      activeExternalSessionId === null &&
      composerRuntimeKind !== null,
    queryFn: async (): Promise<AgentModelCatalog> => {
      if (!workspaceRepoPath) {
        throw new Error("No repository selected.");
      }
      if (!composerRuntimeKind) {
        throw new Error("Select a runtime before loading model catalogs.");
      }
      return loadCatalogForRepo(workspaceRepoPath, composerRuntimeKind);
    },
  });
  const composerCatalog = composerCatalogQuery.data ?? null;
  const isLoadingComposerCatalog = composerCatalogQuery.isLoading;
  const {
    supportsSlashCommands,
    slashCommandCatalog,
    slashCommands,
    slashCommandsError,
    isSlashCommandsLoading,
  } = useAgentStudioSlashCommands({
    hasActiveSession,
    activeExternalSessionId,
    activeSessionStatus,
    activeSessionRuntimeQueryInput,
    activeSessionRuntimeQueryError,
    runtimeSupportsSlashCommands,
    workspaceRepoPath,
    composerRuntimeKind,
    reusablePrompts,
    loadSlashCommandsForRepo,
    ...(readSessionSlashCommands ? { readSessionSlashCommands } : {}),
  });
  useEffect(() => {
    repairDraftSelection({
      hasActiveSession,
      composerCatalog,
      roleDefaultSelection,
    });
  }, [composerCatalog, hasActiveSession, repairDraftSelection, roleDefaultSelection]);

  useAgentStudioActiveSessionModelRepair({
    activeExternalSessionId,
    activeSessionModelCatalog,
    activeSessionSelectedModel,
    roleDefaultSelection,
    updateAgentSessionModel,
  });

  const roleDefaultSelectionForComposer = useMemo<AgentModelSelection | null>(() => {
    return resolveRoleDefaultSelectionForComposer({
      hasActiveSession,
      composerCatalog,
      isAwaitingRepoSettingsForWorkspaceRepoPath,
      roleDefaultSelection,
    });
  }, [
    hasActiveSession,
    composerCatalog,
    isAwaitingRepoSettingsForWorkspaceRepoPath,
    roleDefaultSelection,
  ]);
  const selectionCatalog = activeSessionModelCatalog ?? composerCatalog;
  const searchFiles = useMemo(
    () =>
      createAgentStudioFileSearch({
        hasActiveSession,
        activeSessionRuntimeQueryInput,
        activeSessionRuntimeQueryError,
        workspaceRepoPath,
        composerRuntimeKind,
        supportsFileSearch,
        queryClient,
        loadFileSearchForRepo,
        ...(readSessionFileSearch ? { readSessionFileSearch } : {}),
      }),
    [
      activeSessionRuntimeQueryError,
      activeSessionRuntimeQueryInput,
      composerRuntimeKind,
      hasActiveSession,
      loadFileSearchForRepo,
      queryClient,
      readSessionFileSearch,
      supportsFileSearch,
      workspaceRepoPath,
    ],
  );
  const isSelectionCatalogLoading = resolveSelectionCatalogLoading({
    hasActiveSession,
    activeSessionIsLoadingModelCatalog,
    activeSessionModelCatalog,
    composerCatalog,
    isLoadingComposerCatalog,
  });
  const fallbackCatalogSelection = useMemo(
    () => pickDefaultVisibleSelectionForCatalog(selectionCatalog),
    [selectionCatalog],
  );
  const selectedModelSelection = useMemo(
    () =>
      resolveSelectedModelSelection({
        activeSessionSelectedModel,
        draftSelection,
        roleDefaultSelectionForComposer,
        fallbackCatalogSelection,
      }),
    [
      activeSessionSelectedModel,
      draftSelection,
      fallbackCatalogSelection,
      roleDefaultSelectionForComposer,
    ],
  );

  const selectionForNewSession = useMemo(
    () =>
      resolveSelectionForNewSession({
        draftSelection,
        roleDefaultSelectionForComposer,
        selectionCatalog,
        fallbackCatalogSelection,
      }),
    [draftSelection, fallbackCatalogSelection, roleDefaultSelectionForComposer, selectionCatalog],
  );

  const {
    selectedModelEntry,
    agentOptions,
    modelOptions,
    modelGroups,
    variantOptions,
    activeSessionAgentColors,
  } = useMemo(
    () => resolveModelSelectionOptions({ selectionCatalog, selectedModelSelection }),
    [selectedModelSelection, selectionCatalog],
  );

  const activeSessionContextUsage = useAgentStudioContextUsage({
    activeSession,
    activeSessionMessages,
    activeSessionLiveContextUsage,
    activeSessionModelCatalog,
    selectedModelSelection,
    selectedModelEntry,
  });

  const { handleSelectAgent, handleSelectModel, handleSelectVariant } =
    useAgentStudioModelSelectionHandlers({
      activeExternalSessionId,
      updateAgentSessionModel,
      applyDraftSelection,
      selectedModelSelection,
      selectionCatalog,
      composerRuntimeKind,
    });

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
