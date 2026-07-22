import type { ChatSettings } from "@openducktor/contracts";
import type { AgentModelSelection } from "@openducktor/core";
import { useMemo } from "react";
import { resolveAgentSessionAccentColor } from "@/components/features/agents/agent-accent-color";
import type { AgentChatModel } from "@/components/features/agents/agent-chat/agent-chat.types";
import type { AgentChatComposerDraft } from "@/components/features/agents/agent-chat/agent-chat-composer-draft";
import {
  type AgentChatDraftScope,
  agentChatDraftScopeKey,
} from "@/components/features/agents/agent-chat/agent-chat-draft-scope";
import type { AgentChatDraftSessionIdentity } from "@/components/features/agents/agent-chat/agent-chat-draft-storage";
import { useAgentChatSurfaceModel } from "@/components/features/agents/agent-chat/use-agent-chat-surface-model";
import type { ComboboxGroup, ComboboxOption } from "@/components/ui/combobox";
import type { AgentStudioContextUsage } from "@/features/agent-chat-composer/context-usage/context-usage-resolution";
import { agentSessionIdentityKey } from "@/lib/agent-session-identity";
import { useAgentSessionReadModelState } from "@/state/app-state-provider";
import type { AgentOperationsContextValue } from "@/types/state-slices";
import { deriveAgentStudioChatSurfaceState } from "./agent-studio-chat-surface-state";
import { toSelectedSessionThreadSession } from "./agent-studio-thread-session";
import type { AgentStudioSelectedSessionContext } from "./selected-session/selected-session-context";

export type AgentStudioChatSessionActionsContext = {
  isStarting: boolean;
  isSending: boolean;
  isSessionWorking: boolean;
  isWaitingInput: boolean;
  busySendBlockedReason: string | null;
  canUseKickoffPrompt: boolean;
  kickoffLabel: string;
  canStopSession: boolean;
  startLaunchKickoff: () => Promise<void>;
  onSend: (draft: AgentChatComposerDraft) => Promise<boolean>;
  stopAgentSession: AgentOperationsContextValue["stopAgentSession"];
};

export type AgentStudioChatModelSelectionContext = {
  selectedModelSelection: AgentModelSelection | null;
  selectedModelDescriptor?: AgentChatModel["composer"]["selectedModelDescriptor"];
  isSelectionCatalogLoading: boolean;
  supportsProfiles?: boolean;
  supportsSlashCommands: boolean;
  supportsFileSearch: boolean;
  supportsSkillReferences: boolean;
  supportsSubagentReferences: boolean;
  slashCommandCatalog: AgentChatModel["composer"]["slashCommandCatalog"];
  slashCommands: AgentChatModel["composer"]["slashCommands"];
  slashCommandsError: string | null;
  isSlashCommandsLoading: boolean;
  skillCatalog: AgentChatModel["composer"]["skillCatalog"];
  skills: AgentChatModel["composer"]["skills"];
  skillsError: string | null;
  isSkillsLoading: boolean;
  subagentCatalog: AgentChatModel["composer"]["subagentCatalog"];
  subagents: AgentChatModel["composer"]["subagents"];
  subagentsError: string | null;
  isSubagentsLoading: boolean;
  searchFiles: AgentChatModel["composer"]["searchFiles"];
  agentOptions: ComboboxOption[];
  modelOptions: ComboboxOption[];
  modelGroups: ComboboxGroup[];
  variantOptions: ComboboxOption[];
  onSelectAgent: (agent: string) => void;
  onSelectModel: (model: string) => void;
  onSelectVariant: (variant: string) => void;
  agentAccentColorsByProfileId: Record<string, string>;
  selectedSessionContextUsage: AgentStudioContextUsage;
};

export type AgentStudioChatComposerContext = {
  draftScope: AgentChatDraftScope;
  workspaceId: string | null;
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
  const selectedSessionState = selectedSession.selectedSession;
  const { sessionReadModelLoadState, reloadSessionReadModel } = useAgentSessionReadModelState();
  const selectedSessionIdentity = selectedSessionState.identity;
  const selectedSessionModel = selectedSessionState.selectedModel;
  const selectedSessionRuntimeData = selectedSessionState.runtimeData;
  const activeThreadSession = useMemo(
    () =>
      toSelectedSessionThreadSession({
        identity: selectedSessionIdentity,
        activityState: selectedSessionState.activityState,
        loadedSession: selectedSessionState.loadedSession,
      }),
    [
      selectedSessionIdentity,
      selectedSessionState.activityState,
      selectedSessionState.loadedSession,
    ],
  );
  const pendingApprovalRequests = selectedSession.pendingInput.pendingApprovalRequests;
  const pendingQuestionRequests = selectedSession.pendingInput.pendingQuestionRequests;
  const sessionAccentColor = useMemo(
    () =>
      resolveAgentSessionAccentColor({
        agentName: selectedSessionModel?.profileId,
        agentColors: modelSelection.agentAccentColorsByProfileId,
        runtimeKind: selectedSessionIdentity?.runtimeKind ?? null,
      }),
    [
      modelSelection.agentAccentColorsByProfileId,
      selectedSessionIdentity?.runtimeKind,
      selectedSessionModel?.profileId,
    ],
  );
  const chatContextUsage = useMemo(
    () => toChatContextUsage(modelSelection.selectedSessionContextUsage),
    [modelSelection.selectedSessionContextUsage],
  );
  const selectedSessionTranscriptState = selectedSessionState.transcriptState;
  const selectedSessionAuxiliaryError = selectedSessionState.sessionAuxiliaryError;
  const runtimeReadiness = selectedSessionState.runtimeReadiness;
  const pendingQuestions = selectedSession.pendingInput.pendingQuestions;
  const approvals = selectedSession.pendingInput.approvals;
  const selectedSessionKey = selectedSessionIdentity
    ? agentSessionIdentityKey(selectedSessionIdentity)
    : null;
  const draftPersistenceIdentity = useMemo<AgentChatDraftSessionIdentity | null>(() => {
    if (!composer.workspaceId || !selectedSessionIdentity) {
      return null;
    }

    return {
      workspaceId: composer.workspaceId,
      externalSessionId: selectedSessionIdentity.externalSessionId,
      runtimeKind: selectedSessionIdentity.runtimeKind,
      workingDirectory: selectedSessionIdentity.workingDirectory,
    };
  }, [composer.workspaceId, selectedSessionIdentity]);
  const surfaceState = useMemo(
    () =>
      deriveAgentStudioChatSurfaceState({
        taskId: selectedSession.taskId,
        selectedSessionKey,
        transcriptState: selectedSessionTranscriptState,
        workflow: {
          selectedRoleAvailable: selectedSession.workflow.selectedRoleAvailable,
          selectedRoleReadOnlyReason: selectedSession.workflow.selectedRoleReadOnlyReason,
        },
        isStarting: sessionActions.isStarting,
        canUseKickoffPrompt: sessionActions.canUseKickoffPrompt,
        kickoffLabel: sessionActions.kickoffLabel,
        startLaunchKickoff: sessionActions.startLaunchKickoff,
      }),
    [
      selectedSessionKey,
      selectedSession.taskId,
      selectedSession.workflow.selectedRoleAvailable,
      selectedSession.workflow.selectedRoleReadOnlyReason,
      selectedSessionTranscriptState,
      sessionActions.canUseKickoffPrompt,
      sessionActions.isStarting,
      sessionActions.kickoffLabel,
      sessionActions.startLaunchKickoff,
    ],
  );
  const failedTranscriptAction = useMemo(() => {
    if (
      selectedSessionTranscriptState.kind !== "failed" ||
      selectedSessionState.loadedSession !== null ||
      (sessionReadModelLoadState.kind !== "failed" && selectedSessionAuxiliaryError === null)
    ) {
      return null;
    }

    return {
      label: "Retry",
      onAction: reloadSessionReadModel,
    };
  }, [
    reloadSessionReadModel,
    selectedSessionState.loadedSession,
    selectedSessionAuxiliaryError,
    selectedSessionTranscriptState.kind,
    sessionReadModelLoadState.kind,
  ]);

  const composerConfig = useMemo(
    () => ({
      taskId: selectedSession.taskId,
      displayedSessionKey: selectedSessionKey,
      selectedSession: selectedSessionIdentity
        ? {
            ...selectedSessionIdentity,
            selectedModel: selectedSessionModel,
          }
        : null,
      isSessionModelCatalogLoading: selectedSessionRuntimeData.isLoadingModelCatalog,
      isSessionWorking: sessionActions.isSessionWorking,
      isWaitingInput: sessionActions.isWaitingInput,
      waitingInputPlaceholder: selectedSession.pendingInput.waitingInputPlaceholder,
      busySendBlockedReason: sessionActions.busySendBlockedReason,
      canStopSession: sessionActions.canStopSession,
      stopAgentSession: sessionActions.stopAgentSession,
      isReadOnly: surfaceState.composerReadOnly,
      readOnlyReason: surfaceState.composerReadOnlyReason,
      draftStateKey: agentChatDraftScopeKey(composer.draftScope),
      draftScope: composer.draftScope,
      draftPersistenceIdentity,
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
      supportsSubagentReferences: modelSelection.supportsSubagentReferences,
      slashCommandCatalog: modelSelection.slashCommandCatalog,
      slashCommands: modelSelection.slashCommands,
      slashCommandsError: modelSelection.slashCommandsError,
      isSlashCommandsLoading: modelSelection.isSlashCommandsLoading,
      skillCatalog: modelSelection.skillCatalog,
      skills: modelSelection.skills,
      skillsError: modelSelection.skillsError,
      isSkillsLoading: modelSelection.isSkillsLoading,
      subagentCatalog: modelSelection.subagentCatalog,
      subagents: modelSelection.subagents,
      subagentsError: modelSelection.subagentsError,
      isSubagentsLoading: modelSelection.isSubagentsLoading,
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
      chatContextUsage,
      composer.draftScope,
      draftPersistenceIdentity,
      modelSelection.agentOptions,
      modelSelection.isSelectionCatalogLoading,
      modelSelection.isSlashCommandsLoading,
      modelSelection.isSkillsLoading,
      modelSelection.isSubagentsLoading,
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
      modelSelection.subagentCatalog,
      modelSelection.subagents,
      modelSelection.subagentsError,
      modelSelection.supportsFileSearch,
      modelSelection.supportsProfiles,
      modelSelection.supportsSkillReferences,
      modelSelection.supportsSlashCommands,
      modelSelection.supportsSubagentReferences,
      modelSelection.variantOptions,
      selectedSession.pendingInput.waitingInputPlaceholder,
      selectedSessionIdentity,
      selectedSessionModel,
      selectedSessionKey,
      selectedSessionRuntimeData.isLoadingModelCatalog,
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
    sessionKey: selectedSessionKey,
    session: activeThreadSession,
    transcriptState: selectedSessionTranscriptState,
    chatSettings,
    sessionAuxiliaryError: selectedSessionAuxiliaryError ?? selectedSessionRuntimeData.error,
    runtimeReadiness,
    emptyState: surfaceState.emptyState,
    pendingApprovalRequests,
    pendingQuestionRequests,
    todos: selectedSessionRuntimeData.todos,
    sessionAccentColor,
    pendingQuestions,
    approvals,
    composer: composerConfig,
    sessionAgentColors: modelSelection.agentAccentColorsByProfileId,
    subagentPendingApprovalCountBySessionKey,
    subagentPendingQuestionCountBySessionKey,
    failedTranscriptAction,
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
