import type { RepoRuntimeRef, ReusablePrompt } from "@openducktor/contracts";
import type {
  AgentFileSearchResult,
  AgentModelCatalog,
  AgentModelSelection,
  AgentRole,
  AgentSkillCatalog,
  AgentSlashCommandCatalog,
  RuntimeWorkingDirectoryRef,
} from "@openducktor/core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import type { ComboboxOption } from "@/components/ui/combobox";
import type { AgentStudioContextUsage } from "@/features/agent-chat-composer/context-usage/context-usage-resolution";
import { useSelectedSessionContextUsage } from "@/features/agent-chat-composer/context-usage/use-selected-session-context-usage";
import { resolveModelSelectionOptions } from "@/features/agent-chat-composer/model-selection/model-selection-options";
import {
  type ChatComposerModelSelectionSource,
  resolveAvailableRoleDefaultModelSelection,
  resolveChatComposerModelSelections,
  resolveChatComposerSelectedRuntimeKind,
} from "@/features/agent-chat-composer/model-selection/model-selection-preferences";
import { useAgentStudioDraftModelSelectionState } from "@/features/agent-chat-composer/model-selection/use-draft-model-selection";
import { useModelSelectionActions } from "@/features/agent-chat-composer/model-selection/use-model-selection-actions";
import {
  type ChatComposerPromptInputRuntimeSource,
  resolveChatComposerPromptInputRuntime,
} from "@/features/agent-chat-composer/prompt-input/chat-composer-prompt-input-runtime";
import { createChatComposerFileSearch } from "@/features/agent-chat-composer/prompt-input/create-chat-composer-file-search";
import { resolveRuntimePromptInputSupport } from "@/features/agent-chat-composer/prompt-input/runtime-prompt-input-support";
import { useChatComposerSkills } from "@/features/agent-chat-composer/prompt-input/use-chat-composer-skills";
import { useChatComposerSlashCommands } from "@/features/agent-chat-composer/prompt-input/use-chat-composer-slash-commands";
import { findRuntimeDefinition } from "@/lib/agent-runtime";
import { toAgentSessionIdentity } from "@/lib/agent-session-identity";
import { useRuntimeAvailabilityContext } from "@/state/app-state-contexts";
import {
  RUNTIME_CATALOG_STALE_TIME_MS,
  repoRuntimeCatalogQueryOptions,
  runtimeCatalogQueryKeys,
} from "@/state/queries/runtime-catalog";
import { skippedQueryOptions } from "@/state/queries/skipped-query";
import type { AgentSessionIdentity } from "@/types/agent-orchestrator";
import type { RepoSettingsInput } from "@/types/state-slices";
import type { AgentStudioSelectedSessionState } from "../selected-session/selected-session-state";

type UseAgentStudioChatComposerArgs = {
  workspaceRepoPath: string | null;
  selectedSession: AgentStudioSelectedSessionState;
  role: AgentRole;
  reusablePrompts: ReusablePrompt[];
  repoSettings: RepoSettingsInput | null;
  updateAgentSessionModel: (
    session: AgentSessionIdentity,
    selection: AgentModelSelection | null,
  ) => void;
  loadCatalog?: (runtimeRef: RepoRuntimeRef) => Promise<AgentModelCatalog>;
  loadSlashCommands?: (runtimeRef: RepoRuntimeRef) => Promise<AgentSlashCommandCatalog>;
  loadSkills?: (runtimeRef: RuntimeWorkingDirectoryRef) => Promise<AgentSkillCatalog>;
  loadFileSearch?: (
    runtimeRef: RuntimeWorkingDirectoryRef,
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
  selectedSessionContextUsage: AgentStudioContextUsage;
  handleSelectAgentProfile: (profileId: string) => void;
  handleSelectModel: (modelKey: string) => void;
  handleSelectVariant: (variant: string) => void;
};

const skippedComposerCatalogQueryOptions = (runtimeRef: RepoRuntimeRef | null) =>
  skippedQueryOptions<AgentModelCatalog>({
    queryKey: runtimeRef
      ? runtimeCatalogQueryKeys.repo(runtimeRef.repoPath, runtimeRef.runtimeKind)
      : runtimeCatalogQueryKeys.all,
    staleTime: RUNTIME_CATALOG_STALE_TIME_MS,
  });

export function useAgentStudioChatComposer({
  workspaceRepoPath,
  selectedSession,
  role,
  reusablePrompts,
  repoSettings,
  updateAgentSessionModel,
  loadCatalog,
  loadSlashCommands,
  loadSkills,
  loadFileSearch,
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
  const loadSkillsForRepo = loadSkills ?? loadRepoRuntimeSkills;
  const loadFileSearchForRepo = loadFileSearch ?? loadRepoRuntimeFileSearch;
  const loadedSession = selectedSession.loadedSession;
  const selectedSessionIdentity = selectedSession.identity;
  const selectedSessionModel = selectedSession.selectedModel;
  const sessionModelCatalog = selectedSession.runtimeData.modelCatalog;
  const isSessionModelCatalogLoading = selectedSession.runtimeData.isLoadingModelCatalog;
  const loadedSessionIdentity = loadedSession ? toAgentSessionIdentity(loadedSession) : null;
  const repoReadinessState = selectedSession.runtimeReadiness.state;
  const hasSessionTarget = selectedSessionIdentity !== null;
  const roleDefaultSelection = useMemo(
    () =>
      resolveAvailableRoleDefaultModelSelection({
        repoSettings,
        role,
        runtimeDefinitions: availableRuntimeDefinitions,
      }),
    [availableRuntimeDefinitions, repoSettings, role],
  );
  const {
    draftSelection,
    isAwaitingRepoSettingsForWorkspaceRepoPath,
    applyDraftSelection,
    syncDraftSelection,
  } = useAgentStudioDraftModelSelectionState({ workspaceRepoPath, repoSettings, role });
  const selectedRuntimeKind = useMemo(
    () =>
      resolveChatComposerSelectedRuntimeKind({
        selectedSessionModel,
        draftSelection,
        roleDefaultSelection,
        repoDefaultRuntimeKind: repoSettings?.defaultRuntimeKind,
        runtimeDefinitions: availableRuntimeDefinitions,
      }),
    [
      availableRuntimeDefinitions,
      draftSelection,
      repoSettings?.defaultRuntimeKind,
      roleDefaultSelection,
      selectedSessionModel,
    ],
  );
  const selectedTargetRuntimeKind = selectedSessionIdentity?.runtimeKind ?? selectedRuntimeKind;
  const selectedTargetRuntimeDefinitions = hasSessionTarget
    ? allRuntimeDefinitions
    : availableRuntimeDefinitions;
  const selectedRepoRuntimeRef = useMemo<RepoRuntimeRef | null>(() => {
    if (!workspaceRepoPath || !selectedRuntimeKind) {
      return null;
    }
    return {
      repoPath: workspaceRepoPath,
      runtimeKind: selectedRuntimeKind,
    };
  }, [selectedRuntimeKind, workspaceRepoPath]);
  const promptInputRuntimeSource = useMemo<ChatComposerPromptInputRuntimeSource>(() => {
    if (selectedSessionIdentity) {
      return { kind: "session", session: selectedSessionIdentity };
    }
    return { kind: "repo", runtimeKind: selectedTargetRuntimeKind };
  }, [selectedSessionIdentity, selectedTargetRuntimeKind]);
  const promptInputRuntime = useMemo(
    () =>
      resolveChatComposerPromptInputRuntime({
        workspaceRepoPath,
        repoReadinessState,
        source: promptInputRuntimeSource,
      }),
    [promptInputRuntimeSource, repoReadinessState, workspaceRepoPath],
  );
  const promptInputRuntimeKind =
    promptInputRuntime.state === "available"
      ? promptInputRuntime.runtimeRef.runtimeKind
      : promptInputRuntime.runtimeKind;
  const { runtimeSupportsSlashCommands, supportsFileSearch, supportsSkillReferences } = useMemo(
    () =>
      resolveRuntimePromptInputSupport({
        runtimeDefinitions: selectedTargetRuntimeDefinitions,
        runtimeKind: promptInputRuntimeKind,
      }),
    [promptInputRuntimeKind, selectedTargetRuntimeDefinitions],
  );
  const supportsProfiles = useMemo(() => {
    if (!selectedTargetRuntimeKind) {
      return true;
    }
    const definition = findRuntimeDefinition(
      selectedTargetRuntimeDefinitions,
      selectedTargetRuntimeKind,
    );
    return definition?.capabilities.optionalSurfaces.supportsProfiles ?? false;
  }, [selectedTargetRuntimeDefinitions, selectedTargetRuntimeKind]);

  const composerCatalogQuery = useQuery(
    selectedRepoRuntimeRef && !hasSessionTarget
      ? repoRuntimeCatalogQueryOptions(selectedRepoRuntimeRef, loadCatalogForRepo)
      : skippedComposerCatalogQueryOptions(selectedRepoRuntimeRef),
  );
  const composerCatalog = hasSessionTarget ? null : (composerCatalogQuery.data ?? null);
  const isLoadingComposerCatalog = hasSessionTarget
    ? isSessionModelCatalogLoading
    : composerCatalogQuery.isLoading;
  const {
    supportsSlashCommands,
    slashCommandCatalog,
    slashCommands,
    slashCommandsError,
    isSlashCommandsLoading,
  } = useChatComposerSlashCommands({
    promptInputRuntime,
    runtimeSupportsSlashCommands,
    reusablePrompts,
    loadSlashCommandsForRepo,
  });
  const { skillCatalog, skills, skillsError, isSkillsLoading } = useChatComposerSkills({
    promptInputRuntime,
    supportsSkillReferences,
    loadSkillsForRepo,
  });
  useEffect(() => {
    syncDraftSelection({
      composerCatalog,
      roleDefaultSelection,
    });
  }, [composerCatalog, roleDefaultSelection, syncDraftSelection]);

  const { selectionCatalog, selectedModelSelection, selectionForNewSession } = useMemo(() => {
    const source: ChatComposerModelSelectionSource = hasSessionTarget
      ? {
          kind: "session",
          modelCatalog: sessionModelCatalog,
          selectedSessionModel,
          draftSelection,
        }
      : {
          kind: "new_session",
          composerCatalog,
          draftSelection,
          isAwaitingRepoSettingsForWorkspaceRepoPath,
        };

    return resolveChatComposerModelSelections({
      source,
      roleDefaultSelection,
    });
  }, [
    composerCatalog,
    draftSelection,
    hasSessionTarget,
    isAwaitingRepoSettingsForWorkspaceRepoPath,
    roleDefaultSelection,
    selectedSessionModel,
    sessionModelCatalog,
  ]);
  const searchFiles = useMemo(
    () =>
      createChatComposerFileSearch({
        promptInputRuntime,
        supportsFileSearch,
        queryClient,
        loadFileSearchForRepo,
      }),
    [loadFileSearchForRepo, promptInputRuntime, queryClient, supportsFileSearch],
  );
  const isSelectionCatalogLoading = hasSessionTarget
    ? !sessionModelCatalog && isSessionModelCatalogLoading
    : isLoadingComposerCatalog;

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

  const selectedSessionContextUsage = useSelectedSessionContextUsage({
    selectedSession: loadedSession,
    sessionModelCatalog,
    selectedModelEntry,
  });

  const { handleSelectAgentProfile, handleSelectModel, handleSelectVariant } =
    useModelSelectionActions({
      loadedSessionIdentity,
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
    selectedSessionContextUsage,
    handleSelectAgentProfile,
    handleSelectModel,
    handleSelectVariant,
  };
}
