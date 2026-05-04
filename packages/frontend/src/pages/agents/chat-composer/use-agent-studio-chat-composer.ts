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
import type { AgentStudioContextUsage } from "./context-usage/context-usage-resolution";
import { useActiveSessionContextUsage } from "./context-usage/use-active-session-context-usage";
import { resolveModelSelectionOptions } from "./model-selection/model-selection-options";
import { toRoleDefaultModelSelection } from "./model-selection/model-selection-preferences";
import { resolveSelectedRuntimeKindForChatComposer } from "./model-selection/selected-runtime-kind";
import {
  resolveRoleDefaultSelectionForComposer,
  resolveSelectedModelSelection,
  resolveSelectionCatalogLoading,
  resolveSelectionForNewSession,
} from "./model-selection/selection-resolution";
import { useActiveSessionModelSelectionRepair } from "./model-selection/use-active-session-model-selection-repair";
import { useAgentStudioDraftModelSelectionState } from "./model-selection/use-draft-model-selection";
import { useModelSelectionActions } from "./model-selection/use-model-selection-actions";
import { createChatComposerFileSearch } from "./prompt-input/create-chat-composer-file-search";
import { resolveRuntimePromptInputSupport } from "./prompt-input/runtime-prompt-input-support";
import { useChatComposerSlashCommands } from "./prompt-input/use-chat-composer-slash-commands";
import { resolveActiveSessionChatComposerContext } from "./session-context/active-session-chat-composer-context";

type UseAgentStudioChatComposerArgs = {
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

type AgentStudioChatComposerState = {
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
  agentProfileOptions: ComboboxOption[];
  modelOptions: ComboboxOption[];
  modelGroups: ReturnType<typeof resolveModelSelectionOptions>["modelGroups"];
  variantOptions: ComboboxOption[];
  agentAccentColorsByProfileId: Record<string, string>;
  activeSessionContextUsage: AgentStudioContextUsage;
  handleSelectAgentProfile: (profileId: string) => void;
  handleSelectModel: (modelKey: string) => void;
  handleSelectVariant: (variant: string) => void;
};

export function useAgentStudioChatComposer({
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
}: UseAgentStudioChatComposerArgs): AgentStudioChatComposerState {
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
  const activeSessionChatComposerContext = useMemo(
    () => resolveActiveSessionChatComposerContext(activeSession, activeSessionSummary),
    [activeSession, activeSessionSummary],
  );
  const activeExternalSessionId = activeSessionChatComposerContext.externalSessionId;
  const activeSessionStatus = activeSessionChatComposerContext.status;
  const activeSessionSelectedModel = activeSessionChatComposerContext.selectedModel;
  const activeSessionModelCatalog = activeSessionChatComposerContext.modelCatalog;
  const activeSessionRuntimeKind = activeSessionChatComposerContext.runtimeKind;
  const activeSessionRepoPath = activeSessionChatComposerContext.repoPath;
  const activeSessionWorkingDirectory = activeSessionChatComposerContext.workingDirectory;
  const activeSessionIsLoadingModelCatalog = activeSessionChatComposerContext.isLoadingModelCatalog;
  const activeSessionLiveContextUsage = activeSessionChatComposerContext.liveContextUsage ?? null;
  const activeSessionMessages = activeSessionChatComposerContext.messages;
  const hasActiveSession = activeSessionChatComposerContext.hasActiveSession;
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
  const selectedRuntimeKind = useMemo<RuntimeKind | null>(() => {
    return resolveSelectedRuntimeKindForChatComposer({
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
        selectedRuntimeKind,
      }),
    [activeSessionRuntimeQueryInput?.runtimeKind, selectedRuntimeKind, runtimeDefinitions],
  );

  const composerCatalogQuery = useQuery({
    ...repoRuntimeCatalogQueryOptions(
      workspaceRepoPath ?? "",
      selectedRuntimeKind ?? DEFAULT_RUNTIME_KIND,
      loadCatalogForRepo,
    ),
    enabled:
      workspaceRepoPath !== null &&
      activeExternalSessionId === null &&
      selectedRuntimeKind !== null,
    queryFn: async (): Promise<AgentModelCatalog> => {
      if (!workspaceRepoPath) {
        throw new Error("No repository selected.");
      }
      if (!selectedRuntimeKind) {
        throw new Error("Select a runtime before loading model catalogs.");
      }
      return loadCatalogForRepo(workspaceRepoPath, selectedRuntimeKind);
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
  } = useChatComposerSlashCommands({
    hasActiveSession,
    activeExternalSessionId,
    activeSessionStatus,
    activeSessionRuntimeQueryInput,
    activeSessionRuntimeQueryError,
    runtimeSupportsSlashCommands,
    workspaceRepoPath,
    selectedRuntimeKind,
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

  useActiveSessionModelSelectionRepair({
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
      createChatComposerFileSearch({
        hasActiveSession,
        activeSessionRuntimeQueryInput,
        activeSessionRuntimeQueryError,
        workspaceRepoPath,
        selectedRuntimeKind,
        supportsFileSearch,
        queryClient,
        loadFileSearchForRepo,
        ...(readSessionFileSearch ? { readSessionFileSearch } : {}),
      }),
    [
      activeSessionRuntimeQueryError,
      activeSessionRuntimeQueryInput,
      selectedRuntimeKind,
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
    agentProfileOptions,
    modelOptions,
    modelGroups,
    variantOptions,
    agentAccentColorsByProfileId,
  } = useMemo(
    () => resolveModelSelectionOptions({ selectionCatalog, selectedModelSelection }),
    [selectedModelSelection, selectionCatalog],
  );

  const activeSessionContextUsage = useActiveSessionContextUsage({
    activeSession,
    activeSessionMessages,
    activeSessionLiveContextUsage,
    activeSessionModelCatalog,
    selectedModelSelection,
    selectedModelEntry,
  });

  const { handleSelectAgentProfile, handleSelectModel, handleSelectVariant } =
    useModelSelectionActions({
      activeExternalSessionId,
      updateAgentSessionModel,
      applyDraftSelection,
      selectedModelSelection,
      selectionCatalog,
      selectedRuntimeKind,
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
    agentProfileOptions,
    modelOptions,
    modelGroups,
    variantOptions,
    agentAccentColorsByProfileId,
    activeSessionContextUsage,
    handleSelectAgentProfile,
    handleSelectModel,
    handleSelectVariant,
  };
}
