import type { ReusablePrompt, RuntimeDescriptor } from "@openducktor/contracts";
import type {
  AgentFileSearchResult,
  AgentModelCatalog,
  AgentModelSelection,
  AgentRole,
  AgentRuntimeCatalog,
  AgentSkillCatalog,
  AgentSlashCommandCatalog,
  AgentSubagentCatalog,
  RuntimeWorkingDirectoryRef,
} from "@openducktor/core";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AgentChatComposerModel } from "@/components/features/agents/agent-chat/agent-chat.types";
import type {
  ModelPickerFavoriteState,
  ModelPickerRuntime,
  ModelPickerSelectionPolicy,
  ModelPickerValue,
} from "@/components/features/agents/model-picker";
import {
  toModelPickerCatalogResource,
  unavailableModelPickerCatalogResource,
} from "@/components/features/agents/model-picker";
import type { ComboboxOption } from "@/components/ui/combobox";
import type { AgentStudioContextUsage } from "@/features/agent-chat-composer/context-usage/context-usage-resolution";
import { useSelectedSessionContextUsage } from "@/features/agent-chat-composer/context-usage/use-selected-session-context-usage";
import { resolveModelSelectionOptions } from "@/features/agent-chat-composer/model-selection/model-selection-options";
import {
  type ChatComposerModelSelectionSource,
  resolveChatComposerModelSelections,
  resolveChatComposerSelectedRuntimeKind,
} from "@/features/agent-chat-composer/model-selection/model-selection-preferences";
import { reportModelUpdateError } from "@/features/agent-chat-composer/model-selection/model-update-error";
import { useDraftModelSelectionState } from "@/features/agent-chat-composer/model-selection/use-draft-model-selection";
import { useModelSelectionActions } from "@/features/agent-chat-composer/model-selection/use-model-selection-actions";
import {
  type ChatComposerPromptInputRuntimeSource,
  resolveChatComposerPromptInputRuntime,
} from "@/features/agent-chat-composer/prompt-input/chat-composer-prompt-input-runtime";
import { createChatComposerFileSearch } from "@/features/agent-chat-composer/prompt-input/create-chat-composer-file-search";
import { resolveRuntimePromptInputSupport } from "@/features/agent-chat-composer/prompt-input/runtime-prompt-input-support";
import { useChatComposerCatalogRefresh } from "@/features/agent-chat-composer/prompt-input/use-chat-composer-catalog-refresh";
import { useChatComposerSkills } from "@/features/agent-chat-composer/prompt-input/use-chat-composer-skills";
import { useChatComposerSlashCommands } from "@/features/agent-chat-composer/prompt-input/use-chat-composer-slash-commands";
import { useChatComposerSubagents } from "@/features/agent-chat-composer/prompt-input/use-chat-composer-subagents";
import { availableDefaultSessionSelectionFor } from "@/features/session-start/session-start-selection";
import { findRuntimeDefinition } from "@/lib/agent-runtime";
import { toAgentSessionIdentity } from "@/lib/agent-session-identity";
import { useRuntimeAvailabilityContext } from "@/state/app-state-contexts";
import { retryRuntimeCatalog } from "@/state/queries/runtime-catalog";
import { useRuntimeModelCatalogs } from "@/state/queries/use-runtime-model-catalogs";
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
  ) => Promise<void> | void;
  favoriteState: ModelPickerFavoriteState;
  loadCatalog?: (runtimeRef: RuntimeWorkingDirectoryRef) => Promise<AgentRuntimeCatalog>;
  loadFileSearch?: (
    runtimeRef: RuntimeWorkingDirectoryRef,
    query: string,
  ) => Promise<AgentFileSearchResult[]>;
};

type AgentStudioChatComposerState = {
  selectionForNewSession: AgentModelSelection | null;
  newSessionCatalog: AgentModelCatalog | null;
  selectedModelSelection: AgentModelSelection | null;
  isSelectedSessionModelSendable: boolean;
  selectedModelDescriptor: AgentModelCatalog["models"][number] | null;
  isSelectionCatalogLoading: boolean;
  supportsProfiles?: boolean;
  supportsAttachments: boolean;
  supportsSlashCommands: boolean;
  supportsFileSearch: boolean;
  supportsSkillReferences: boolean;
  supportsSubagentReferences: boolean;
  slashCommandCatalog: AgentSlashCommandCatalog;
  slashCommands: AgentSlashCommandCatalog["commands"];
  slashCommandsError: string | null;
  isSlashCommandsLoading: boolean;
  retrySlashCommands: (() => void) | null;
  skillCatalog: AgentSkillCatalog;
  skills: AgentSkillCatalog["skills"];
  skillsError: string | null;
  isSkillsLoading: boolean;
  retrySkills: (() => void) | null;
  subagentCatalog: AgentSubagentCatalog;
  subagents: AgentSubagentCatalog["subagents"];
  subagentsError: string | null;
  isSubagentsLoading: boolean;
  retrySubagents: (() => void) | null;
  onCatalogMenuOpen: () => void;
  onAgentSelectorOpen: () => void;
  onVariantSelectorOpen: () => void;
  searchFiles: (query: string) => Promise<AgentFileSearchResult[]>;
  agentProfileOptions: ComboboxOption[];
  modelPicker: AgentChatComposerModel["modelPicker"];
  variantOptions: ComboboxOption[];
  agentAccentColorsByProfileId: Record<string, string>;
  selectedSessionContextUsage: AgentStudioContextUsage;
  handleSelectAgentProfile: (profileId: string) => void;
  handleSelectVariant: (variant: string) => void;
};

const canSelectProfile = (
  hasSessionTarget: boolean,
  runtimeKind: RuntimeDescriptor["kind"] | null | undefined,
  runtimeDefinitions: RuntimeDescriptor[],
): boolean => {
  if (hasSessionTarget) {
    return false;
  }
  if (!runtimeKind) {
    return true;
  }
  const definition = findRuntimeDefinition(runtimeDefinitions, runtimeKind);
  return definition?.capabilities.optionalSurfaces.supportsProfiles ?? false;
};

const listModelPickerRuntimes = (
  hasSessionTarget: boolean,
  availableRuntimeDefinitions: RuntimeDescriptor[],
  allRuntimeDefinitions: RuntimeDescriptor[],
  sessionRuntimeKind: AgentSessionIdentity["runtimeKind"] | undefined,
): RuntimeDescriptor[] => {
  if (!hasSessionTarget) {
    return availableRuntimeDefinitions;
  }
  const availableKinds = new Set(availableRuntimeDefinitions.map((runtime) => runtime.kind));
  return allRuntimeDefinitions.filter(
    (runtime) => runtime.kind === sessionRuntimeKind || availableKinds.has(runtime.kind),
  );
};

const listEnabledModelPickerRuntimes = (
  hasSessionTarget: boolean,
  isRepoRuntimeReady: boolean,
  isModelPickerOpen: boolean,
  runtimeKinds: RuntimeDescriptor["kind"][],
  selectedRuntimeKind: RuntimeDescriptor["kind"] | null | undefined,
): RuntimeDescriptor["kind"][] => {
  if (hasSessionTarget || !isRepoRuntimeReady) {
    return [];
  }
  if (isModelPickerOpen) {
    return runtimeKinds;
  }
  return selectedRuntimeKind ? [selectedRuntimeKind] : [];
};

const pickLoader = <Loader>(load: Loader | undefined, defaultLoad: Loader): Loader =>
  load ?? defaultLoad;

export function useAgentStudioChatComposer({
  workspaceRepoPath,
  selectedSession,
  role,
  reusablePrompts,
  repoSettings,
  updateAgentSessionModel,
  favoriteState,
  loadCatalog,
  loadFileSearch,
}: UseAgentStudioChatComposerArgs): AgentStudioChatComposerState {
  const {
    availableRuntimeDefinitions,
    allRuntimeDefinitions,
    loadRepoRuntimeCatalog,
    loadRepoRuntimeFileSearch,
  } = useRuntimeAvailabilityContext();
  const queryClient = useQueryClient();
  const [isModelPickerOpen, setIsModelPickerOpen] = useState(false);
  const loadCatalogForRepo = pickLoader(loadCatalog, loadRepoRuntimeCatalog);
  const loadFileSearchForRepo = pickLoader(loadFileSearch, loadRepoRuntimeFileSearch);
  const loadedSession = selectedSession.loadedSession;
  const selectedSessionIdentity = selectedSession.identity;
  const selectedSessionModel = selectedSession.selectedModel;
  const sessionModelCatalog = selectedSession.runtimeData.modelCatalog;
  const isSessionModelCatalogLoading = selectedSession.runtimeData.isLoadingModelCatalog;
  const loadedSessionIdentity = loadedSession ? toAgentSessionIdentity(loadedSession) : null;
  const lastSessionModelRepairKeyRef = useRef<string | null>(null);
  const repoReadinessState = selectedSession.runtimeReadiness.state;
  const isRepoRuntimeReady = repoReadinessState === "ready";
  const hasSessionTarget = selectedSessionIdentity !== null;
  const defaultSelection = useMemo(
    () =>
      availableDefaultSessionSelectionFor({
        repoSettings,
        role,
        runtimeDefinitions: availableRuntimeDefinitions,
      }),
    [availableRuntimeDefinitions, repoSettings, role],
  );
  const { draftSelection, explicitDraftSelection, applyDraftSelection } =
    useDraftModelSelectionState({
      contextKey: workspaceRepoPath,
      defaultSelection,
      isDefaultSelectionReady: repoSettings !== null,
      selectionKey: role,
    });
  const selectedRuntimeKind = useMemo(
    () =>
      resolveChatComposerSelectedRuntimeKind({
        selectedSessionModel,
        draftSelection,
        defaultSelection,
        runtimeDefinitions: availableRuntimeDefinitions,
      }),
    [availableRuntimeDefinitions, draftSelection, defaultSelection, selectedSessionModel],
  );
  const selectedTargetRuntimeKind = selectedSessionIdentity?.runtimeKind ?? selectedRuntimeKind;
  const selectedTargetRuntimeDefinitions = hasSessionTarget
    ? allRuntimeDefinitions
    : availableRuntimeDefinitions;
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
  const {
    supportsAttachments,
    runtimeSupportsSlashCommands,
    supportsFileSearch,
    supportsSkillReferences,
    supportsSubagentReferences,
  } = useMemo(
    () =>
      resolveRuntimePromptInputSupport({
        runtimeDefinitions: selectedTargetRuntimeDefinitions,
        runtimeKind: promptInputRuntimeKind,
      }),
    [promptInputRuntimeKind, selectedTargetRuntimeDefinitions],
  );
  const supportsProfiles = useMemo(
    () =>
      canSelectProfile(
        hasSessionTarget,
        selectedTargetRuntimeKind,
        selectedTargetRuntimeDefinitions,
      ),
    [hasSessionTarget, selectedTargetRuntimeDefinitions, selectedTargetRuntimeKind],
  );

  const modelPickerRuntimeDefinitions = useMemo(
    () =>
      listModelPickerRuntimes(
        hasSessionTarget,
        availableRuntimeDefinitions,
        allRuntimeDefinitions,
        selectedSessionIdentity?.runtimeKind,
      ),
    [allRuntimeDefinitions, availableRuntimeDefinitions, hasSessionTarget, selectedSessionIdentity],
  );
  const modelPickerRuntimeKinds = useMemo(
    () => modelPickerRuntimeDefinitions.map((runtime) => runtime.kind),
    [modelPickerRuntimeDefinitions],
  );
  const enabledModelPickerRuntimeKinds = useMemo(
    () =>
      listEnabledModelPickerRuntimes(
        hasSessionTarget,
        isRepoRuntimeReady,
        isModelPickerOpen,
        modelPickerRuntimeKinds,
        selectedRuntimeKind,
      ),
    [
      hasSessionTarget,
      isModelPickerOpen,
      isRepoRuntimeReady,
      modelPickerRuntimeKinds,
      selectedRuntimeKind,
    ],
  );
  const { resources: repoModelPickerResources } = useRuntimeModelCatalogs({
    repoPath: workspaceRepoPath,
    runtimeKinds: modelPickerRuntimeKinds,
    enabledRuntimeKinds: enabledModelPickerRuntimeKinds,
    loadCatalog: loadCatalogForRepo,
  });
  const modelPickerRuntimes = useMemo<ModelPickerRuntime[]>(() => {
    if (!hasSessionTarget) {
      return modelPickerRuntimeDefinitions.map((descriptor) => {
        const resource = repoModelPickerResources.find(
          (candidate) => candidate.runtimeKind === descriptor.kind,
        );
        return {
          descriptor,
          resource: resource
            ? toModelPickerCatalogResource({
                catalog: resource.catalog,
                isFetching: resource.isFetching,
                error: resource.error,
                isAvailable: resource.isEnabled,
                unavailableReason: "This runtime catalog is not available yet.",
                retry: resource.retry,
              })
            : unavailableModelPickerCatalogResource("This runtime catalog is not available yet."),
        };
      });
    }
    return modelPickerRuntimeDefinitions.map((descriptor) => {
      if (descriptor.kind !== selectedSessionIdentity?.runtimeKind) {
        return {
          descriptor,
          resource: unavailableModelPickerCatalogResource(
            "Start a new session to use another runtime.",
          ),
        };
      }
      return {
        descriptor,
        resource: toModelPickerCatalogResource({
          catalog: sessionModelCatalog,
          isFetching: isSessionModelCatalogLoading,
          error: selectedSession.runtimeData.catalogError,
          isAvailable: true,
          unavailableReason: "The current session model catalog is unavailable.",
          retry: async (): Promise<void> => {
            if (!workspaceRepoPath || !selectedSessionIdentity) {
              throw new Error(
                "A repository path and session are required to refresh the session model catalog.",
              );
            }
            await retryRuntimeCatalog({
              queryClient,
              runtimeRef: {
                repoPath: workspaceRepoPath,
                runtimeKind: descriptor.kind,
                workingDirectory: selectedSessionIdentity.workingDirectory,
              },
              loadRuntimeCatalog: loadCatalogForRepo,
            });
          },
        }),
      };
    });
  }, [
    hasSessionTarget,
    isSessionModelCatalogLoading,
    loadCatalogForRepo,
    modelPickerRuntimeDefinitions,
    queryClient,
    repoModelPickerResources,
    selectedSession.runtimeData.catalogError,
    selectedSessionIdentity,
    sessionModelCatalog,
    workspaceRepoPath,
  ]);
  const selectedComposerResource = repoModelPickerResources.find(
    (resource) => resource.runtimeKind === selectedRuntimeKind,
  );
  const composerCatalog = hasSessionTarget ? null : (selectedComposerResource?.catalog ?? null);
  const isLoadingComposerCatalog = hasSessionTarget
    ? isSessionModelCatalogLoading
    : isRepoRuntimeReady && (selectedComposerResource?.isFetching ?? false);
  const {
    supportsSlashCommands,
    slashCommandCatalog,
    slashCommands,
    slashCommandsError,
    isSlashCommandsLoading,
    retrySlashCommands,
  } = useChatComposerSlashCommands({
    promptInputRuntime,
    runtimeSupportsSlashCommands,
    reusablePrompts,
    loadRuntimeCatalog: loadCatalogForRepo,
  });
  const { skillCatalog, skills, skillsError, isSkillsLoading, retrySkills } = useChatComposerSkills(
    {
      promptInputRuntime,
      supportsSkillReferences,
      loadRuntimeCatalog: loadCatalogForRepo,
    },
  );
  const { subagentCatalog, subagents, subagentsError, isSubagentsLoading, retrySubagents } =
    useChatComposerSubagents({
      promptInputRuntime,
      supportsSubagentReferences,
      loadRuntimeCatalog: loadCatalogForRepo,
    });
  const {
    selectionCatalog,
    selectedModelSelection,
    selectionForNewSession,
    sessionModelRepairCommand,
    isSelectedSessionModelSendable,
  } = useMemo(() => {
    const source: ChatComposerModelSelectionSource = selectedSessionIdentity
      ? {
          kind: "session",
          sessionIdentity: loadedSessionIdentity,
          sessionRuntimeKind: selectedSessionIdentity.runtimeKind,
          modelCatalog: sessionModelCatalog,
          selectedSessionModel,
          draftSelection,
        }
      : {
          kind: "new_session",
          composerCatalog,
          draftSelection: explicitDraftSelection,
        };

    return resolveChatComposerModelSelections({
      source,
      defaultSelection,
    });
  }, [
    composerCatalog,
    draftSelection,
    explicitDraftSelection,
    defaultSelection,
    selectedSessionIdentity,
    selectedSessionModel,
    sessionModelCatalog,
    loadedSessionIdentity,
  ]);
  useEffect(() => {
    if (!sessionModelRepairCommand) {
      lastSessionModelRepairKeyRef.current = null;
      return;
    }
    if (lastSessionModelRepairKeyRef.current === sessionModelRepairCommand.key) {
      return;
    }
    lastSessionModelRepairKeyRef.current = sessionModelRepairCommand.key;
    void Promise.resolve(
      updateAgentSessionModel(
        sessionModelRepairCommand.session,
        sessionModelRepairCommand.selection,
      ),
    ).catch(reportModelUpdateError);
  }, [sessionModelRepairCommand, updateAgentSessionModel]);

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
  const refreshCatalogIfStale = useChatComposerCatalogRefresh({
    promptInputRuntime,
    loadRuntimeCatalog: loadCatalogForRepo,
  });
  const isSelectionCatalogLoading = hasSessionTarget
    ? isSessionModelCatalogLoading
    : isLoadingComposerCatalog;

  const { selectedModelEntry, agentProfileOptions, variantOptions, agentAccentColorsByProfileId } =
    useMemo(
      () =>
        resolveModelSelectionOptions({
          liveSession: hasSessionTarget,
          selectionCatalog,
          selectedModelSelection,
        }),
      [hasSessionTarget, selectedModelSelection, selectionCatalog],
    );

  const selectedSessionContextUsage = useSelectedSessionContextUsage({
    selectedSession: loadedSession,
    sessionModelCatalog,
    selectedModelEntry,
  });

  const {
    handleSelectAgentProfile,
    handleSelectModelPair: applyModelPair,
    handleSelectVariant,
  } = useModelSelectionActions({
    loadedSessionIdentity,
    updateAgentSessionModel,
    applyDraftSelection,
    selectedModelSelection,
    selectionCatalog,
    selectedRuntimeKind: selectedTargetRuntimeKind,
  });
  const handleSelectModelPair = useCallback(
    (value: ModelPickerValue): void => {
      const targetRuntime = modelPickerRuntimes.find(
        (runtime) => runtime.descriptor.kind === value.runtimeKind,
      );
      if (targetRuntime?.resource.status !== "ready") {
        return;
      }
      applyModelPair(value, targetRuntime.resource.catalog);
    },
    [applyModelPair, modelPickerRuntimes],
  );
  const modelPickerSelectionPolicy: ModelPickerSelectionPolicy = selectedSessionIdentity
    ? {
        kind: "runtime_locked",
        runtimeKind: selectedSessionIdentity.runtimeKind,
        reason: "An existing session cannot change runtime.",
      }
    : { kind: "editable" };
  const modelPicker: AgentChatComposerModel["modelPicker"] = {
    runtimes: modelPickerRuntimes,
    value: selectedModelSelection?.runtimeKind
      ? {
          runtimeKind: selectedModelSelection.runtimeKind,
          providerId: selectedModelSelection.providerId,
          modelId: selectedModelSelection.modelId,
        }
      : null,
    selectionPolicy: modelPickerSelectionPolicy,
    favoriteState,
    onValueChange: handleSelectModelPair,
    // The selected runtime catalog query stays enabled while the composer is
    // mounted, so an enabled-transition refresh never runs for it. Refresh the
    // cached catalog when the picker opens and the entry is stale.
    onOpenChange: (open: boolean) => {
      setIsModelPickerOpen(open);
      if (open) {
        refreshCatalogIfStale();
      }
    },
  };

  return {
    newSessionCatalog:
      isRepoRuntimeReady && !selectedComposerResource?.error ? composerCatalog : null,
    selectionForNewSession,
    selectedModelSelection,
    isSelectedSessionModelSendable,
    selectedModelDescriptor: selectedModelEntry,
    isSelectionCatalogLoading,
    supportsProfiles,
    supportsAttachments,
    supportsSlashCommands,
    supportsFileSearch,
    supportsSkillReferences,
    supportsSubagentReferences,
    slashCommandCatalog,
    slashCommands,
    slashCommandsError,
    isSlashCommandsLoading,
    retrySlashCommands,
    skillCatalog,
    skills,
    skillsError,
    isSkillsLoading,
    retrySkills,
    subagentCatalog,
    subagents,
    subagentsError,
    isSubagentsLoading,
    retrySubagents,
    onCatalogMenuOpen: refreshCatalogIfStale,
    onAgentSelectorOpen: refreshCatalogIfStale,
    onVariantSelectorOpen: refreshCatalogIfStale,
    searchFiles,
    agentProfileOptions,
    modelPicker,
    variantOptions,
    agentAccentColorsByProfileId,
    selectedSessionContextUsage,
    handleSelectAgentProfile,
    handleSelectVariant,
  };
}
