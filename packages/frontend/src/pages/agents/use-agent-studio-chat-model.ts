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
import { toAgentChatThreadSession } from "@/components/features/agents/agent-chat/agent-chat-thread-session";
import { useAgentChatSurfaceModel } from "@/components/features/agents/agent-chat/use-agent-chat-surface-model";
import type { ComboboxGroup, ComboboxOption } from "@/components/ui/combobox";
import type { AgentStudioContextUsage } from "@/features/agent-chat-composer/context-usage/context-usage-resolution";
import { agentSessionIdentityKey } from "@/lib/agent-session-identity";
import type { AgentApprovalRequest, AgentQuestionRequest } from "@/types/agent-orchestrator";
import type { AgentOperationsContextValue } from "@/types/state-slices";
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
  agentAccentColorsByProfileId: Record<string, string>;
  selectedSessionContextUsage: AgentStudioContextUsage;
};

export type AgentStudioChatComposerContext = {
  draftScope: AgentChatDraftScope;
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

const EMPTY_PENDING_APPROVALS = Object.freeze([]) as readonly AgentApprovalRequest[];
const EMPTY_PENDING_QUESTIONS = Object.freeze([]) as readonly AgentQuestionRequest[];

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
  const activeThreadSession = useMemo(
    () =>
      selectedSession.loadedSession
        ? toAgentChatThreadSession(selectedSession.loadedSession)
        : null,
    [selectedSession.loadedSession],
  );
  const pendingApprovalRequests =
    selectedSession.loadedSession?.pendingApprovals ?? EMPTY_PENDING_APPROVALS;
  const pendingQuestionRequests =
    selectedSession.loadedSession?.pendingQuestions ?? EMPTY_PENDING_QUESTIONS;
  const sessionAccentColor = useMemo(
    () =>
      resolveAgentSessionAccentColor({
        agentName: selectedSession.loadedSession?.selectedModel?.profileId,
        agentColors: modelSelection.agentAccentColorsByProfileId,
        runtimeKind: activeThreadSession?.runtimeKind ?? null,
      }),
    [
      activeThreadSession?.runtimeKind,
      modelSelection.agentAccentColorsByProfileId,
      selectedSession.loadedSession?.selectedModel?.profileId,
    ],
  );
  const chatContextUsage = useMemo(
    () => toChatContextUsage(modelSelection.selectedSessionContextUsage),
    [modelSelection.selectedSessionContextUsage],
  );
  const selectedSessionTranscriptState = selectedSession.transcriptState;
  const runtimeReadiness = selectedSession.runtime.runtimeReadiness;
  const pendingQuestions = selectedSession.pendingInput.pendingQuestions;
  const approvals = selectedSession.pendingInput.approvals;
  const selectedSessionKey = selectedSession.selectedSessionIdentity
    ? agentSessionIdentityKey(selectedSession.selectedSessionIdentity)
    : null;
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
        canKickoffNewSession: sessionActions.canKickoffNewSession,
        kickoffLabel: sessionActions.kickoffLabel,
        startLaunchKickoff: sessionActions.startLaunchKickoff,
      }),
    [
      selectedSessionKey,
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
      displayedSessionKey: selectedSessionKey,
      loadedSession: selectedSession.loadedSession,
      isSessionModelCatalogLoading: selectedSession.runtime.runtimeData.isLoadingModelCatalog,
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
      chatContextUsage,
      composer.draftScope,
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
      selectedSession.loadedSession,
      selectedSessionKey,
      selectedSession.runtime.runtimeData.isLoadingModelCatalog,
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
    runtimeDefinitions: selectedSession.runtime.runtimeDefinitions,
    sessionAuxiliaryError: selectedSession.runtime.runtimeData.error,
    runtimeReadiness,
    emptyState: surfaceState.emptyState,
    pendingApprovalRequests,
    pendingQuestionRequests,
    todos: selectedSession.runtime.runtimeData.todos,
    sessionAccentColor,
    pendingQuestions,
    approvals,
    composer: composerConfig,
    sessionAgentColors: modelSelection.agentAccentColorsByProfileId,
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
