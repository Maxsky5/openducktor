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
import {
  getChatComposerPromptInputRuntimeKind,
  resolveChatComposerPromptInputTarget,
} from "@/features/agent-chat-composer/prompt-input/chat-composer-prompt-input-target";
import { createChatComposerFileSearch } from "@/features/agent-chat-composer/prompt-input/create-chat-composer-file-search";
import { resolveRuntimePromptInputSupport } from "@/features/agent-chat-composer/prompt-input/runtime-prompt-input-support";
import { useChatComposerSkills } from "@/features/agent-chat-composer/prompt-input/use-chat-composer-skills";
import { useChatComposerSlashCommands } from "@/features/agent-chat-composer/prompt-input/use-chat-composer-slash-commands";
import { pickDefaultVisibleSelectionForCatalog } from "@/features/session-start";
import { findRuntimeDefinition } from "@/lib/agent-runtime";
import { toAgentSessionIdentity } from "@/lib/agent-session-identity";
import type { AgentSessionSummary } from "@/state/agent-sessions-store";
import { useRuntimeAvailabilityContext } from "@/state/app-state-contexts";
import { repoRuntimeCatalogQueryOptions } from "@/state/queries/runtime-catalog";
import type { AgentSessionIdentity, AgentSessionState } from "@/types/agent-orchestrator";
import type { RepoSettingsInput } from "@/types/state-slices";

type UseAgentStudioChatComposerArgs = {
  workspaceRepoPath: string | null;
  activeSession: AgentSessionState | null;
  activeSessionSummary: AgentSessionSummary | null;
  activeSessionModelCatalog: AgentModelCatalog | null;
  activeSessionIsLoadingModelCatalog: boolean;
  role: AgentRole;
  reusablePrompts: ReusablePrompt[];
  repoSettings: RepoSettingsInput | null;
  updateAgentSessionModel: (
    session: AgentSessionIdentity,
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
  workspaceRepoPath,
  activeSession,
  activeSessionSummary,
  activeSessionModelCatalog,
  activeSessionIsLoadingModelCatalog,
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
  const activeLoadedSessionIdentity: AgentSessionIdentity | null = activeSession
    ? toAgentSessionIdentity(activeSession)
    : null;
  const activeSessionSelectedModel =
    activeSession?.selectedModel ?? activeSessionSummary?.selectedModel ?? null;
  const activeSessionIdentity =
    activeLoadedSessionIdentity ??
    (activeSessionSummary ? toAgentSessionIdentity(activeSessionSummary) : null);
  const activeSessionRuntimeKind = activeSessionIdentity?.runtimeKind ?? null;
  const hasSessionTarget = activeSessionIdentity !== null;
  const hasLoadedSessionTarget = activeSession !== null;
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
  const promptInputTarget = useMemo(
    () =>
      resolveChatComposerPromptInputTarget({
        workspaceRepoPath,
        activeSession,
        activeSessionSummary,
        selectedRuntimeKind,
      }),
    [activeSession, activeSessionSummary, selectedRuntimeKind, workspaceRepoPath],
  );
  const promptInputRuntimeKind = getChatComposerPromptInputRuntimeKind(promptInputTarget);
  const promptInputRuntimeDefinitions = hasSessionTarget
    ? allRuntimeDefinitions
    : availableRuntimeDefinitions;
  const { runtimeSupportsSlashCommands, supportsFileSearch, supportsSkillReferences } = useMemo(
    () =>
      resolveRuntimePromptInputSupport({
        runtimeDefinitions: promptInputRuntimeDefinitions,
        runtimeKind: promptInputRuntimeKind,
      }),
    [promptInputRuntimeDefinitions, promptInputRuntimeKind],
  );
  const supportsProfiles = useMemo(() => {
    const runtimeKind = hasSessionTarget ? activeSessionRuntimeKind : selectedRuntimeKind;
    if (!runtimeKind) {
      return true;
    }
    const runtimeDefinitions = hasSessionTarget
      ? allRuntimeDefinitions
      : availableRuntimeDefinitions;
    const definition = findRuntimeDefinition(runtimeDefinitions, runtimeKind);
    return definition?.capabilities.optionalSurfaces.supportsProfiles ?? false;
  }, [
    activeSessionRuntimeKind,
    allRuntimeDefinitions,
    availableRuntimeDefinitions,
    hasSessionTarget,
    selectedRuntimeKind,
  ]);

  const composerCatalogQuery = useQuery({
    ...repoRuntimeCatalogQueryOptions(workspaceRepoPath, selectedRuntimeKind, loadCatalogForRepo),
    enabled: workspaceRepoPath !== null && !hasLoadedSessionTarget && selectedRuntimeKind !== null,
  });
  const composerCatalog = composerCatalogQuery.data ?? null;
  const isLoadingComposerCatalog =
    composerCatalogQuery.isLoading ||
    (hasLoadedSessionTarget && activeSessionIsLoadingModelCatalog);
  const {
    supportsSlashCommands,
    slashCommandCatalog,
    slashCommands,
    slashCommandsError,
    isSlashCommandsLoading,
  } = useChatComposerSlashCommands({
    promptInputTarget,
    runtimeSupportsSlashCommands,
    reusablePrompts,
    loadSlashCommandsForRepo,
    ...(readSessionSlashCommands ? { readSessionSlashCommands } : {}),
  });
  const { skillCatalog, skills, skillsError, isSkillsLoading } = useChatComposerSkills({
    promptInputTarget,
    supportsSkillReferences,
    loadSkillsForRepo,
    ...(readSessionSkills ? { readSessionSkills } : {}),
  });
  useEffect(() => {
    repairDraftSelection({
      hasSessionTarget,
      composerCatalog,
      roleDefaultSelection,
    });
  }, [composerCatalog, hasSessionTarget, repairDraftSelection, roleDefaultSelection]);

  useActiveSessionModelSelectionRepair({
    activeSession: activeLoadedSessionIdentity,
    activeSessionModelCatalog,
    activeSessionSelectedModel,
    roleDefaultSelection,
    updateAgentSessionModel,
  });

  const roleDefaultSelectionForComposer = useMemo<AgentModelSelection | null>(() => {
    return resolveRoleDefaultSelectionForComposer({
      hasSessionTarget,
      composerCatalog,
      isAwaitingRepoSettingsForWorkspaceRepoPath,
      roleDefaultSelection,
    });
  }, [
    hasSessionTarget,
    composerCatalog,
    isAwaitingRepoSettingsForWorkspaceRepoPath,
    roleDefaultSelection,
  ]);
  const selectionCatalog = activeSessionModelCatalog ?? composerCatalog;
  const searchFiles = useMemo(
    () =>
      createChatComposerFileSearch({
        promptInputTarget,
        supportsFileSearch,
        queryClient,
        loadFileSearchForRepo,
        ...(readSessionFileSearch ? { readSessionFileSearch } : {}),
      }),
    [
      loadFileSearchForRepo,
      promptInputTarget,
      queryClient,
      readSessionFileSearch,
      supportsFileSearch,
    ],
  );
  const isSelectionCatalogLoading = resolveSelectionCatalogLoading({
    hasSessionTarget,
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
    activeSessionModelCatalog,
    selectedModelEntry,
  });

  const { handleSelectAgentProfile, handleSelectModel, handleSelectVariant } =
    useModelSelectionActions({
      activeSession: activeLoadedSessionIdentity,
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
