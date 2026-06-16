import type { ChatSettings } from "@openducktor/contracts";
import type { AgentModelSelection } from "@openducktor/core";
import { useMemo } from "react";
import type { AgentChatModel } from "@/components/features/agents/agent-chat/agent-chat.types";
import type { AgentChatComposerDraft } from "@/components/features/agents/agent-chat/agent-chat-composer-draft";
import { toAgentChatThreadSession } from "@/components/features/agents/agent-chat/agent-chat-thread-session";
import type { AgentChatComposerConfig } from "@/components/features/agents/agent-chat/use-agent-chat-composer-model";
import { useAgentChatSurfaceModel } from "@/components/features/agents/agent-chat/use-agent-chat-surface-model";
import type { ComboboxGroup, ComboboxOption } from "@/components/ui/combobox";
import type { AgentStudioContextUsage } from "@/features/agent-chat-composer/context-usage/context-usage-resolution";
import type { AgentStateContextValue } from "@/types/state-slices";
import { deriveAgentStudioChatSurfaceState } from "./agent-studio-chat-surface-state";
import type { AgentStudioSelectedSessionContext } from "./selected-session/selected-session-context";

export type AgentStudioChatSessionActionsContext = {
  isStarting: boolean;
  isSending: boolean;
  isSessionWorking: boolean;
  isWaitingInput: boolean;
  busySendBlockedReason: string | null;
  canKickoffNewSession: boolean;
  kickoffLabel: string;
  canStopSession: boolean;
  startLaunchKickoff: () => Promise<void>;
  onSend: (draft: AgentChatComposerDraft) => Promise<boolean>;
  stopAgentSession: AgentStateContextValue["stopAgentSession"];
};

export type AgentStudioChatModelSelectionContext = {
  selectedModelSelection: AgentModelSelection | null;
  selectedModelDescriptor?: AgentChatModel["composer"]["selectedModelDescriptor"];
  isSelectionCatalogLoading: boolean;
  supportsProfiles?: boolean;
  supportsSlashCommands: boolean;
  supportsFileSearch: boolean;
  supportsSkillReferences: boolean;
  slashCommandCatalog: AgentChatModel["composer"]["slashCommandCatalog"];
  slashCommands: AgentChatModel["composer"]["slashCommands"];
  slashCommandsError: string | null;
  isSlashCommandsLoading: boolean;
  skillCatalog: AgentChatModel["composer"]["skillCatalog"];
  skills: AgentChatModel["composer"]["skills"];
  skillsError: string | null;
  isSkillsLoading: boolean;
  searchFiles: AgentChatModel["composer"]["searchFiles"];
  agentOptions: ComboboxOption[];
  modelOptions: ComboboxOption[];
  modelGroups: ComboboxGroup[];
  variantOptions: ComboboxOption[];
  onSelectAgent: (agent: string) => void;
  onSelectModel: (model: string) => void;
  onSelectVariant: (variant: string) => void;
  activeSessionAgentColors: Record<string, string>;
  activeSessionContextUsage: AgentStudioContextUsage;
};

export type AgentStudioChatComposerContext = {
  draftStateKey: string;
};

type UseAgentStudioChatModelArgs = {
  selectedSession: AgentStudioSelectedSessionContext;
  sessionActions: AgentStudioChatSessionActionsContext;
  modelSelection: AgentStudioChatModelSelectionContext;
  chatSettings: ChatSettings;
  composer: AgentStudioChatComposerContext;
};

const toChatContextUsage = (
  selectedSessionContextUsage: AgentStudioContextUsage,
): AgentChatModel["composer"]["contextUsage"] => {
  if (selectedSessionContextUsage === null) {
    return null;
  }

  return {
    totalTokens: selectedSessionContextUsage.totalTokens,
    contextWindow: selectedSessionContextUsage.contextWindow,
    ...(typeof selectedSessionContextUsage.outputLimit === "number"
      ? { outputLimit: selectedSessionContextUsage.outputLimit }
      : {}),
  };
};

export function useAgentStudioChatModel({
  selectedSession,
  sessionActions,
  modelSelection,
  chatSettings,
  composer,
}: UseAgentStudioChatModelArgs): AgentChatModel {
  const subagentPendingApprovalCountBySessionKey =
    selectedSession.pendingInput.subagentPendingApprovalCountBySessionKey;
  const subagentPendingQuestionCountBySessionKey =
    selectedSession.pendingInput.subagentPendingQuestionCountBySessionKey;
  const activeComposerSession = useMemo<AgentChatComposerConfig["activeSession"]>(() => {
    if (!selectedSession.activeSession) {
      return null;
    }

    return {
      externalSessionId: selectedSession.activeSession.externalSessionId,
      runtimeKind: selectedSession.activeSession.runtimeKind,
      workingDirectory: selectedSession.activeSession.workingDirectory,
      selectedModel: selectedSession.activeSession.selectedModel,
      isLoadingModelCatalog: selectedSession.runtime.isLoadingModelCatalog,
    };
  }, [selectedSession.activeSession, selectedSession.runtime.isLoadingModelCatalog]);
  const activeThreadSession = useMemo(
    () =>
      selectedSession.activeSession
        ? toAgentChatThreadSession(
            selectedSession.activeSession,
            selectedSession.runtime.sessionTodos,
          )
        : null,
    [selectedSession.activeSession, selectedSession.runtime.sessionTodos],
  );
  const chatContextUsage = useMemo(
    () => toChatContextUsage(modelSelection.activeSessionContextUsage),
    [modelSelection.activeSessionContextUsage],
  );
  const selectedSessionTranscriptState = selectedSession.runtime.transcriptState;
  const runtimeReadiness = selectedSession.runtime.runtimeReadiness;
  const pendingQuestions = selectedSession.pendingInput.pendingQuestions;
  const approvals = selectedSession.pendingInput.approvals;
  const surfaceState = useMemo(
    () =>
      deriveAgentStudioChatSurfaceState({
        selectedSession: {
          taskId: selectedSession.taskId,
          activeSession: selectedSession.activeSession,
          workflow: {
            selectedRoleAvailable: selectedSession.workflow.selectedRoleAvailable,
            selectedRoleReadOnlyReason: selectedSession.workflow.selectedRoleReadOnlyReason,
          },
        },
        transcriptState: selectedSessionTranscriptState,
        sessionActions: {
          isStarting: sessionActions.isStarting,
          canKickoffNewSession: sessionActions.canKickoffNewSession,
          kickoffLabel: sessionActions.kickoffLabel,
          startLaunchKickoff: sessionActions.startLaunchKickoff,
        },
      }),
    [
      selectedSession.activeSession,
      selectedSession.taskId,
      selectedSession.workflow.selectedRoleAvailable,
      selectedSession.workflow.selectedRoleReadOnlyReason,
      selectedSessionTranscriptState,
      sessionActions.canKickoffNewSession,
      sessionActions.isStarting,
      sessionActions.kickoffLabel,
      sessionActions.startLaunchKickoff,
    ],
  );

  const composerConfig = useMemo(
    () => ({
      taskId: selectedSession.taskId,
      activeSession: activeComposerSession,
      isSessionWorking: sessionActions.isSessionWorking,
      isWaitingInput: sessionActions.isWaitingInput,
      waitingInputPlaceholder: selectedSession.pendingInput.waitingInputPlaceholder,
      busySendBlockedReason: sessionActions.busySendBlockedReason,
      canStopSession: sessionActions.canStopSession,
      stopAgentSession: sessionActions.stopAgentSession,
      isReadOnly: surfaceState.composerReadOnly,
      readOnlyReason: surfaceState.composerReadOnlyReason,
      draftStateKey: composer.draftStateKey,
      onSend: sessionActions.onSend,
      isSending: sessionActions.isSending,
      isStarting: sessionActions.isStarting,
      contextUsage: chatContextUsage,
      selectedModelSelection: modelSelection.selectedModelSelection,
      selectedModelDescriptor: modelSelection.selectedModelDescriptor,
      isSelectionCatalogLoading: modelSelection.isSelectionCatalogLoading,
      supportsProfiles: modelSelection.supportsProfiles ?? true,
      supportsSlashCommands: modelSelection.supportsSlashCommands,
      supportsFileSearch: modelSelection.supportsFileSearch,
      supportsSkillReferences: modelSelection.supportsSkillReferences,
      slashCommandCatalog: modelSelection.slashCommandCatalog,
      slashCommands: modelSelection.slashCommands,
      slashCommandsError: modelSelection.slashCommandsError,
      isSlashCommandsLoading: modelSelection.isSlashCommandsLoading,
      skillCatalog: modelSelection.skillCatalog,
      skills: modelSelection.skills,
      skillsError: modelSelection.skillsError,
      isSkillsLoading: modelSelection.isSkillsLoading,
      searchFiles: modelSelection.searchFiles,
      agentOptions: modelSelection.agentOptions,
      modelOptions: modelSelection.modelOptions,
      modelGroups: modelSelection.modelGroups,
      variantOptions: modelSelection.variantOptions,
      onSelectAgent: modelSelection.onSelectAgent,
      onSelectModel: modelSelection.onSelectModel,
      onSelectVariant: modelSelection.onSelectVariant,
    }),
    [
      activeComposerSession,
      chatContextUsage,
      composer.draftStateKey,
      modelSelection.agentOptions,
      modelSelection.isSelectionCatalogLoading,
      modelSelection.isSlashCommandsLoading,
      modelSelection.isSkillsLoading,
      modelSelection.modelGroups,
      modelSelection.modelOptions,
      modelSelection.onSelectAgent,
      modelSelection.onSelectModel,
      modelSelection.onSelectVariant,
      modelSelection.searchFiles,
      modelSelection.selectedModelDescriptor,
      modelSelection.selectedModelSelection,
      modelSelection.slashCommandCatalog,
      modelSelection.slashCommands,
      modelSelection.slashCommandsError,
      modelSelection.skillCatalog,
      modelSelection.skills,
      modelSelection.skillsError,
      modelSelection.supportsFileSearch,
      modelSelection.supportsProfiles,
      modelSelection.supportsSkillReferences,
      modelSelection.supportsSlashCommands,
      modelSelection.variantOptions,
      selectedSession.pendingInput.waitingInputPlaceholder,
      selectedSession.taskId,
      surfaceState.composerReadOnly,
      surfaceState.composerReadOnlyReason,
      sessionActions.busySendBlockedReason,
      sessionActions.canStopSession,
      sessionActions.isSending,
      sessionActions.isSessionWorking,
      sessionActions.isStarting,
      sessionActions.isWaitingInput,
      sessionActions.onSend,
      sessionActions.stopAgentSession,
    ],
  );

  const surfaceModel = useAgentChatSurfaceModel({
    session: activeThreadSession,
    transcriptState: selectedSessionTranscriptState,
    chatSettings,
    isSessionWorking: sessionActions.isSessionWorking,
    runtimeDefinitions: selectedSession.runtime.runtimeDefinitions,
    sessionAuxiliaryError: selectedSession.runtime.sessionRuntimeDataError,
    runtimeReadiness,
    emptyState: surfaceState.emptyState,
    pendingQuestions,
    approvals,
    composer: composerConfig,
    sessionAgentColors: modelSelection.activeSessionAgentColors,
    subagentPendingApprovalCountBySessionKey,
    subagentPendingQuestionCountBySessionKey,
  });
  const composerModel = surfaceModel.composer;

  if (!composerModel) {
    throw new Error("Interactive Agent Studio chat is missing a composer model.");
  }

  return useMemo(
    () =>
      ({
        ...surfaceModel,
        composer: composerModel,
      }) satisfies AgentChatModel,
    [composerModel, surfaceModel],
  );
}
