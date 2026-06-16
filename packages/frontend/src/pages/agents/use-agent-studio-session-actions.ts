import type { GitBranch, GitTargetBranch, ReusablePrompt, TaskCard } from "@openducktor/contracts";
import type { AgentModelCatalog, AgentModelSelection, AgentRole } from "@openducktor/core";
import { useCallback } from "react";
import type { SessionStartModalModel } from "@/components/features/agents";
import type { AgentChatComposerDraft } from "@/components/features/agents/agent-chat/agent-chat-composer-draft";
import type { HumanReviewFeedbackModalModel } from "@/features/human-review-feedback/human-review-feedback-types";
import type {
  SessionStartLaunchRequest,
  SessionStartWorkflowResult,
} from "@/features/session-start";
import { LAUNCH_ACTION_LABELS, type SessionLaunchActionId } from "@/features/session-start";
import type { AgentSessionSummary } from "@/state/agent-sessions-store";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import type { AgentStateContextValue, RepoSettingsInput } from "@/types/state-slices";
import type { AgentStudioQuickActionOption } from "./agent-studio-quick-actions";
import type { SessionCreateOption } from "./agents-page-session-tabs";
import type { AgentStudioQueryUpdate as QueryUpdate } from "./query-sync/agent-studio-navigation";
import { useAgentStudioQuestionActions } from "./session-actions/use-agent-studio-question-actions";
import { useAgentStudioSelectionActions } from "./session-actions/use-agent-studio-selection-actions";
import { useAgentStudioSendAction } from "./session-actions/use-agent-studio-send-action";
import { useAgentStudioSessionActionState } from "./session-actions/use-agent-studio-session-action-state";
import {
  canExposeAgentStudioKickoff,
  canStartAgentStudioSessionRole,
} from "./session-start/agent-studio-session-start-availability";
import { useAgentStudioSessionStartFlow } from "./session-start/use-agent-studio-session-start-flow";
import type { AgentStudioSelectionIntent } from "./shell/agent-studio-selection-intent";

export type { NewSessionStartDecision, NewSessionStartRequest } from "@/features/session-start";

export type AgentSessionActionState = Pick<
  AgentSessionState,
  | "externalSessionId"
  | "role"
  | "status"
  | "selectedModel"
  | "pendingApprovals"
  | "pendingQuestions"
  | "runtimeKind"
>;

type UseAgentStudioSessionActionsArgs = {
  activeWorkspaceId: string | null;
  branches?: GitBranch[];
  taskId: string;
  role: AgentRole;
  launchActionId: SessionLaunchActionId;
  activeSession: AgentSessionState | null;
  activeSessionIsLoadingModelCatalog: boolean;
  activeSessionRuntimeDescriptor?: AgentModelCatalog["runtime"] | null;
  selectedModelSelection: AgentModelSelection | null;
  selectedModelDescriptor?: AgentModelCatalog["models"][number] | null;
  sessionsForTask: AgentSessionSummary[];
  selectedTask: TaskCard | null;
  agentStudioReady: boolean;
  isActiveTaskReady: boolean;
  selectionForNewSession: AgentModelSelection | null;
  reusablePrompts: ReusablePrompt[];
  repoSettings: RepoSettingsInput | null;
  workspaceRepoPath: string | null;
  startAgentSession: AgentStateContextValue["startAgentSession"];
  settleStartedAgentSession: AgentStateContextValue["settleStartedAgentSession"];
  sendAgentMessage: AgentStateContextValue["sendAgentMessage"];
  humanRequestChangesTask: (taskId: string, note?: string) => Promise<void>;
  setTaskTargetBranch?: (taskId: string, targetBranch: GitTargetBranch) => Promise<void>;
  answerAgentQuestion: AgentStateContextValue["answerAgentQuestion"];
  updateQuery: (updates: QueryUpdate) => void;
  scheduleSelectionIntent?: (intent: AgentStudioSelectionIntent) => void;
};

export type UseAgentStudioSessionActionsResult = {
  isStarting: boolean;
  sessionStartModal: SessionStartModalModel | null;
  humanReviewFeedbackModal: HumanReviewFeedbackModalModel | null;
  startSessionRequest: (
    request: SessionStartLaunchRequest,
  ) => Promise<SessionStartWorkflowResult | undefined>;
  isSending: boolean;
  isSubmittingQuestionByRequestId: Record<string, boolean>;
  isSessionWorking: boolean;
  isWaitingInput: boolean;
  busySendBlockedReason: string | null;
  canKickoffNewSession: boolean;
  kickoffLabel: string;
  canStopSession: boolean;
  startLaunchKickoff: () => Promise<void>;
  onSend: (draft: AgentChatComposerDraft) => Promise<boolean>;
  onSubmitQuestionAnswers: (requestId: string, answers: string[][]) => Promise<void>;
  handleWorkflowStepSelect: (role: AgentRole, sessionValue: string | null) => void;
  handleSessionSelectionChange: (nextValue: string) => void;
  handleCreateSession: (option: SessionCreateOption) => void;
  handlePrepareMessageFirstSession: (option: SessionCreateOption) => void;
  handleQuickAction: (option: AgentStudioQuickActionOption) => void;
};

export function useAgentStudioSessionActions({
  activeWorkspaceId,
  branches = [],
  taskId,
  role,
  launchActionId,
  activeSession,
  activeSessionIsLoadingModelCatalog,
  activeSessionRuntimeDescriptor = null,
  selectedModelSelection,
  selectedModelDescriptor,
  sessionsForTask,
  selectedTask,
  agentStudioReady,
  isActiveTaskReady,
  selectionForNewSession,
  reusablePrompts,
  repoSettings,
  workspaceRepoPath,
  startAgentSession,
  settleStartedAgentSession,
  sendAgentMessage,
  humanRequestChangesTask,
  setTaskTargetBranch,
  answerAgentQuestion,
  updateQuery,
  scheduleSelectionIntent,
}: UseAgentStudioSessionActionsArgs): UseAgentStudioSessionActionsResult {
  const sessionState = useAgentStudioSessionActionState({
    activeSession,
    activeSessionIsLoadingModelCatalog,
    activeSessionRuntimeDescriptor,
    role,
    selectedModelSelection,
  });
  const canStartRole = useCallback(
    (nextRole: AgentRole): boolean =>
      canStartAgentStudioSessionRole({
        taskId,
        role: nextRole,
        selectedTask,
        agentStudioReady,
        isActiveTaskReady,
      }),
    [agentStudioReady, isActiveTaskReady, selectedTask, taskId],
  );
  const canStartNewSession = canStartRole(role);

  const {
    isStarting,
    sessionStartModal,
    humanReviewFeedbackModal,
    startSessionRequest,
    startSession,
    startLaunchKickoff,
    handleCreateSession,
    handleQuickAction,
  } = useAgentStudioSessionStartFlow({
    branches,
    taskId,
    role,
    launchActionId,
    activeSession,
    sessionsForTask,
    selectedTask,
    canStartRole,
    isSessionWorking: sessionState.isSessionBusy,
    selectionForNewSession,
    repoSettings,
    workspaceId: activeWorkspaceId,
    workspaceRepoPath,
    startAgentSession,
    settleStartedAgentSession,
    sendAgentMessage,
    humanRequestChangesTask,
    ...(setTaskTargetBranch ? { setTaskTargetBranch } : {}),
    updateQuery,
  });

  const { isSending, onSend } = useAgentStudioSendAction({
    workspaceId: activeWorkspaceId,
    taskId,
    role,
    activeSession,
    activeSessionIsLoadingModelCatalog: sessionState.activeSessionIsLoadingModelCatalog,
    activeSessionSelectedModel: sessionState.activeSessionSelectedModel,
    agentStudioReady,
    canStartNewSession,
    canQueueBusyFollowups: sessionState.canQueueBusyFollowups,
    reusablePrompts,
    isStarting,
    isWaitingInput: sessionState.isWaitingInput,
    busySendBlockedReason: sessionState.busySendBlockedReason,
    selectedModelDescriptor,
    sendAgentMessage,
    startSession,
  });

  const isSessionWorking = sessionState.isSessionBusy || isSending;
  const busySendBlockedReason = sessionState.busySendBlockedReason;

  const canPrepareMessageFirstSession = useCallback(
    (option: SessionCreateOption): boolean => {
      if (option.disabled || (sessionState.hasActiveSession && isSessionWorking)) {
        return false;
      }
      return canStartRole(option.role);
    },
    [canStartRole, isSessionWorking, sessionState.hasActiveSession],
  );

  const { isSubmittingQuestionByRequestId, onSubmitQuestionAnswers } =
    useAgentStudioQuestionActions({
      activeSession,
      agentStudioReady,
      answerAgentQuestion,
    });

  const {
    handleWorkflowStepSelect,
    handleSessionSelectionChange,
    handlePrepareMessageFirstSession,
  } = useAgentStudioSelectionActions({
    taskId,
    sessionsForTask,
    canPrepareMessageFirstSession,
    updateQuery,
    scheduleSelectionIntent,
  });

  const canKickoffNewSession = canExposeAgentStudioKickoff({
    canStartSession: canStartNewSession,
    launchActionId,
    hasActiveSession: sessionState.hasActiveSession,
  });
  const kickoffLabel = LAUNCH_ACTION_LABELS[launchActionId];
  const canStopSession = sessionState.hasActiveSession && isSessionWorking;

  return {
    isStarting,
    sessionStartModal,
    humanReviewFeedbackModal,
    startSessionRequest,
    isSending,
    isSubmittingQuestionByRequestId,
    isSessionWorking,
    isWaitingInput: sessionState.isWaitingInput,
    busySendBlockedReason,
    canKickoffNewSession,
    kickoffLabel,
    canStopSession,
    startLaunchKickoff,
    onSend,
    onSubmitQuestionAnswers,
    handleWorkflowStepSelect,
    handleSessionSelectionChange,
    handleCreateSession,
    handlePrepareMessageFirstSession,
    handleQuickAction,
  };
}
