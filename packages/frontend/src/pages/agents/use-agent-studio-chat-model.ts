import type { ChatSettings } from "@openducktor/contracts";
import type { AgentModelSelection } from "@openducktor/core";
import { useMemo } from "react";
import type {
  AgentChatEmptyStateModel,
  AgentChatModel,
} from "@/components/features/agents/agent-chat/agent-chat.types";
import type { AgentChatComposerDraft } from "@/components/features/agents/agent-chat/agent-chat-composer-draft";
import { toAgentChatThreadSession } from "@/components/features/agents/agent-chat/agent-chat-thread-session";
import type { AgentChatComposerConfig } from "@/components/features/agents/agent-chat/use-agent-chat-composer-model";
import { useAgentChatSurfaceModel } from "@/components/features/agents/agent-chat/use-agent-chat-surface-model";
import type { ComboboxGroup, ComboboxOption } from "@/components/ui/combobox";
import type { AgentStudioContextUsage } from "@/features/agent-chat-composer/context-usage/context-usage-resolution";
import type { AgentStateContextValue } from "@/types/state-slices";
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

const buildAgentStudioChatEmptyState = ({
  taskId,
  transcriptStateKind,
  isStarting,
  canKickoff,
  kickoffLabel,
  startLaunchKickoff,
}: {
  taskId: string;
  transcriptStateKind: AgentStudioSelectedSessionContext["runtime"]["lifecycle"]["transcriptState"]["kind"];
  isStarting: boolean;
  canKickoff: boolean;
  kickoffLabel: string;
  startLaunchKickoff: () => Promise<void>;
}): AgentChatEmptyStateModel | null => {
  if (!taskId) {
    return {
      title: "Select a task to begin.",
    };
  }

  if (transcriptStateKind !== "empty") {
    return null;
  }

  if (isStarting) {
    return {
      title: "Initializing session...",
    };
  }

  if (canKickoff) {
    return {
      title: "Send a message to start a new session automatically.",
      actionLabel: kickoffLabel,
      onAction: (): void => {
        void startLaunchKickoff();
      },
    };
  }

  return {
    title: "Send a message to start a new session automatically.",
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
      pendingApprovals: selectedSession.activeSession.pendingApprovals,
      pendingQuestions: selectedSession.activeSession.pendingQuestions,
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
  const selectedSessionLifecycle = selectedSession.runtime.lifecycle;
  const runtimeReadiness = selectedSession.runtime.runtimeReadiness;
  const pendingQuestions = selectedSession.pendingInput.pendingQuestions;
  const approvals = selectedSession.pendingInput.approvals;
  const composerReadOnly =
    !selectedSession.activeSession && !selectedSession.workflow.selectedRoleAvailable;
  const composerReadOnlyReason = composerReadOnly
    ? selectedSession.workflow.selectedRoleReadOnlyReason
    : null;
  const emptyState = useMemo(
    () =>
      buildAgentStudioChatEmptyState({
        taskId: selectedSession.taskId,
        transcriptStateKind: selectedSessionLifecycle.transcriptState.kind,
        isStarting: sessionActions.isStarting,
        canKickoff: sessionActions.canKickoffNewSession,
        kickoffLabel: sessionActions.kickoffLabel,
        startLaunchKickoff: sessionActions.startLaunchKickoff,
      }),
    [
      selectedSession.taskId,
      selectedSessionLifecycle.transcriptState.kind,
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
      busySendBlockedReason: sessionActions.busySendBlockedReason,
      canStopSession: sessionActions.canStopSession,
      stopAgentSession: sessionActions.stopAgentSession,
      isReadOnly: composerReadOnly,
      readOnlyReason: composerReadOnlyReason,
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
      composerReadOnly,
      composerReadOnlyReason,
      selectedSession.taskId,
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
    sessionLifecycle: selectedSessionLifecycle,
    chatSettings,
    isSessionWorking: sessionActions.isSessionWorking,
    runtimeDefinitions: selectedSession.runtime.runtimeDefinitions,
    sessionRuntimeDataError: selectedSession.runtime.sessionRuntimeDataError,
    runtimeReadiness,
    emptyState,
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
