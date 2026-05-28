import type { ReusablePrompt, RuntimeKind } from "@openducktor/contracts";
import type {
  AgentFileSearchResult,
  AgentModelCatalog,
  AgentModelSelection,
  AgentRole,
  AgentSkillCatalog,
  AgentSlashCommandCatalog,
} from "@openducktor/core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import type { ComboboxOption } from "@/components/ui/combobox";
import type { AgentStudioContextUsage } from "@/features/agent-chat-composer/context-usage/context-usage-resolution";
import { useActiveSessionContextUsage } from "@/features/agent-chat-composer/context-usage/use-active-session-context-usage";
import { resolveModelSelectionOptions } from "@/features/agent-chat-composer/model-selection/model-selection-options";
import { toRoleDefaultModelSelection } from "@/features/agent-chat-composer/model-selection/model-selection-preferences";
import { resolveSelectedRuntimeKindForChatComposer } from "@/features/agent-chat-composer/model-selection/selected-runtime-kind";
import {
  resolveRoleDefaultSelectionForComposer,
  resolveSelectedModelSelection,
  resolveSelectionCatalogLoading,
  resolveSelectionForNewSession,
} from "@/features/agent-chat-composer/model-selection/selection-resolution";
import { useActiveSessionModelSelectionRepair } from "@/features/agent-chat-composer/model-selection/use-active-session-model-selection-repair";
import { useAgentStudioDraftModelSelectionState } from "@/features/agent-chat-composer/model-selection/use-draft-model-selection";
import { useModelSelectionActions } from "@/features/agent-chat-composer/model-selection/use-model-selection-actions";
import { createChatComposerFileSearch } from "@/features/agent-chat-composer/prompt-input/create-chat-composer-file-search";
import { resolveRuntimePromptInputSupport } from "@/features/agent-chat-composer/prompt-input/runtime-prompt-input-support";
import { useChatComposerSkills } from "@/features/agent-chat-composer/prompt-input/use-chat-composer-skills";
import { useChatComposerSlashCommands } from "@/features/agent-chat-composer/prompt-input/use-chat-composer-slash-commands";
import { resolveActiveSessionChatComposerContext } from "@/features/agent-chat-composer/session-context/active-session-chat-composer-context";
import { pickDefaultVisibleSelectionForCatalog } from "@/features/session-start";
import { DEFAULT_RUNTIME_KIND, findRuntimeDefinition } from "@/lib/agent-runtime";
import type { AgentSessionSummary } from "@/state/agent-sessions-store";
import { useRuntimeAvailabilityContext } from "@/state/app-state-contexts";
import { resolveAttachedSessionRuntimeQueryState } from "@/state/operations/agent-orchestrator/support/session-runtime-query-state";
import { repoRuntimeCatalogQueryOptions } from "@/state/queries/runtime-catalog";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import type { ActiveWorkspace, RepoSettingsInput } from "@/types/state-slices";

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
  loadSkills?: (
    repoPath: string,
    runtimeKind: RuntimeKind,
    workingDirectory: string,
  ) => Promise<AgentSkillCatalog>;
  loadFileSearch?: (
    repoPath: string,
    runtimeKind: RuntimeKind,
    query: string,
  ) => Promise<AgentFileSearchResult[]>;
  readSessionSlashCommands?: (
    repoPath: string,
    runtimeKind: RuntimeKind,
  ) => Promise<AgentSlashCommandCatalog>;
  readSessionSkills?: (
    repoPath: string,
    runtimeKind: RuntimeKind,
    workingDirectory: string,
  ) => Promise<AgentSkillCatalog>;
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
  supportsProfiles?: boolean;
  supportsSlashCommands: boolean;
  supportsFileSearch: boolean;
  supportsSkillReferences: boolean;
  slashCommandCatalog: AgentSlashCommandCatalog;
  slashCommands: AgentSlashCommandCatalog["commands"];
  slashCommandsError: string | null;
  isSlashCommandsLoading: boolean;
  skillCatalog: AgentSkillCatalog;
  skills: AgentSkillCatalog["skills"];
  skillsError: string | null;
  isSkillsLoading: boolean;
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
  loadSkills,
  loadFileSearch,
  readSessionSlashCommands,
  readSessionSkills,
  readSessionFileSearch,
}: UseAgentStudioChatComposerArgs): AgentStudioChatComposerState {
  const workspaceRepoPath = activeWorkspace?.repoPath ?? null;
  const {
    availableRuntimeDefinitions,
    allRuntimeDefinitions,
    loadRepoRuntimeCatalog,
    loadRepoRuntimeSlashCommands,
    loadRepoRuntimeSkills,
    loadRepoRuntimeFileSearch,
  } = useRuntimeAvailabilityContext();
  const queryClient = useQueryClient();
  const loadCatalogForRepo = loadCatalog ?? loadRepoRuntimeCatalog;
  const loadSlashCommandsForRepo = loadSlashCommands ?? loadRepoRuntimeSlashCommands;
  const loadSkillsForRepo =
    loadSkills ??
    loadRepoRuntimeSkills ??
    (async (): Promise<AgentSkillCatalog> => {
      throw new Error("Runtime skill catalog loading is unavailable.");
    });
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
    const selection = toRoleDefaultModelSelection(
      repoSettings?.agentDefaults[role],
      repoSettings?.defaultRuntimeKind,
    );
    if (!selection) {
      return null;
    }
    const runtimeKind = selection.runtimeKind;
    if (!runtimeKind) {
      return null;
    }
    return findRuntimeDefinition(availableRuntimeDefinitions, runtimeKind) ? selection : null;
  }, [
    availableRuntimeDefinitions,
    repoSettings?.agentDefaults,
    repoSettings?.defaultRuntimeKind,
    role,
  ]);
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
      repoDefaultRuntimeKind:
        repoSettings?.defaultRuntimeKind &&
        findRuntimeDefinition(availableRuntimeDefinitions, repoSettings.defaultRuntimeKind)
          ? repoSettings.defaultRuntimeKind
          : null,
    });
  }, [
    activeSessionSelectedModel,
    draftSelection,
    repoSettings?.defaultRuntimeKind,
    roleDefaultSelection,
    availableRuntimeDefinitions,
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
  const { runtimeSupportsSlashCommands, supportsFileSearch, supportsSkillReferences } = useMemo(
    () =>
      resolveRuntimePromptInputSupport({
        runtimeDefinitions: hasActiveSession ? allRuntimeDefinitions : availableRuntimeDefinitions,
        hasActiveSession,
        activeSessionRuntimeKind: activeSessionRuntimeKind ?? null,
        selectedRuntimeKind,
      }),
    [
      activeSessionRuntimeKind,
      allRuntimeDefinitions,
      availableRuntimeDefinitions,
      hasActiveSession,
      selectedRuntimeKind,
    ],
  );
  const supportsProfiles = useMemo(() => {
    const runtimeKind = hasActiveSession ? activeSessionRuntimeKind : selectedRuntimeKind;
    if (!runtimeKind) {
      return true;
    }
    const runtimeDefinitions = hasActiveSession
      ? allRuntimeDefinitions
      : availableRuntimeDefinitions;
    const definition = findRuntimeDefinition(runtimeDefinitions, runtimeKind);
    return definition?.capabilities.optionalSurfaces.supportsProfiles ?? false;
  }, [
    activeSessionRuntimeKind,
    allRuntimeDefinitions,
    availableRuntimeDefinitions,
    hasActiveSession,
    selectedRuntimeKind,
  ]);

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
  });
  const activeSessionCatalogQuery = useQuery({
    ...repoRuntimeCatalogQueryOptions(
      activeSessionRuntimeQueryInput?.repoPath ?? "",
      activeSessionRuntimeQueryInput?.runtimeKind ?? DEFAULT_RUNTIME_KIND,
      loadCatalogForRepo,
    ),
    enabled:
      hasActiveSession &&
      activeSessionModelCatalog === null &&
      activeSessionRuntimeQueryInput !== null,
  });
  const composerCatalog = composerCatalogQuery.data ?? null;
  const activeSessionCatalog = activeSessionCatalogQuery.data ?? null;
  const isLoadingComposerCatalog =
    composerCatalogQuery.isLoading || activeSessionCatalogQuery.isLoading;
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
  const { skillCatalog, skills, skillsError, isSkillsLoading } = useChatComposerSkills({
    hasActiveSession,
    activeSessionStatus,
    activeSessionRuntimeQueryInput,
    activeSessionRuntimeQueryError,
    supportsSkillReferences,
    workspaceRepoPath,
    selectedRuntimeKind,
    loadSkillsForRepo,
    ...(readSessionSkills ? { readSessionSkills } : {}),
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
  const selectionCatalog = activeSessionModelCatalog ?? activeSessionCatalog ?? composerCatalog;
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
    supportsProfiles,
    supportsSlashCommands,
    supportsFileSearch,
    supportsSkillReferences,
    slashCommandCatalog,
    slashCommands,
    slashCommandsError,
    isSlashCommandsLoading,
    skillCatalog,
    skills,
    skillsError,
    isSkillsLoading,
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
