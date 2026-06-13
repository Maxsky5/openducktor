import type { GitBranch, GitTargetBranch, ReusablePrompt, TaskCard } from "@openducktor/contracts";
import type { AgentModelCatalog, AgentModelSelection, AgentRole } from "@openducktor/core";
import { useCallback } from "react";
import type { SessionStartModalModel } from "@/components/features/agents";
import type { AgentChatComposerDraft } from "@/components/features/agents/agent-chat/agent-chat-composer-draft";
import type { HumanReviewFeedbackModalModel } from "@/features/human-review-feedback/human-review-feedback-types";
import type { SessionStartLaunchRequest } from "@/features/session-start";
import {
  getSessionLaunchAction,
  LAUNCH_ACTION_LABELS,
  type SessionLaunchActionId,
} from "@/features/session-start";
import type { AgentSessionSummary } from "@/state/agent-sessions-store";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import type {
  ActiveWorkspace,
  AgentStateContextValue,
  RepoSettingsInput,
} from "@/types/state-slices";
import type { AgentStudioQuickActionOption } from "./agent-studio-quick-actions";
import type { SessionCreateOption } from "./agents-page-session-tabs";
import { useAgentStudioQuestionActions } from "./session-actions/use-agent-studio-question-actions";
import { useAgentStudioSelectionActions } from "./session-actions/use-agent-studio-selection-actions";
import { useAgentStudioSendAction } from "./session-actions/use-agent-studio-send-action";
import { useAgentStudioSessionActionState } from "./session-actions/use-agent-studio-session-action-state";
import {
  canStartSessionForRole,
  type QueryUpdate,
} from "./use-agent-studio-session-action-helpers";
import { useAgentStudioSessionStartFlow } from "./use-agent-studio-session-start-flow";

export type { NewSessionStartDecision, NewSessionStartRequest } from "@/features/session-start";

export type AgentSessionActionState = Pick<
  AgentSessionState,
  | "externalSessionId"
  | "role"
  | "status"
  | "selectedModel"
  | "isLoadingModelCatalog"
  | "pendingApprovals"
  | "pendingQuestions"
  | "modelCatalog"
  | "runtimeKind"
>;

type UseAgentStudioSessionActionsArgs = {
  activeWorkspace: ActiveWorkspace | null;
  branches?: GitBranch[];
  taskId: string;
  role: AgentRole;
  launchActionId: SessionLaunchActionId;
  activeSession: AgentSessionState | null;
  selectedModelSelection: AgentModelSelection | null;
  selectedModelDescriptor?: AgentModelCatalog["models"][number] | null;
  sessionsForTask: AgentSessionSummary[];
  selectedTask: TaskCard | null;
  agentStudioReady: boolean;
  isActiveTaskReady: boolean;
  isSessionSelectionResolving: boolean;
  selectionForNewSession: AgentModelSelection | null;
  reusablePrompts: ReusablePrompt[];
  repoSettings: RepoSettingsInput | null;
  startAgentSession: AgentStateContextValue["startAgentSession"];
  settleStartedAgentSession: AgentStateContextValue["settleStartedAgentSession"];
  sendAgentMessage: AgentStateContextValue["sendAgentMessage"];
  humanRequestChangesTask: (taskId: string, note?: string) => Promise<void>;
  setTaskTargetBranch?: (taskId: string, targetBranch: GitTargetBranch) => Promise<void>;
  answerAgentQuestion: AgentStateContextValue["answerAgentQuestion"];
  updateQuery: (updates: QueryUpdate) => void;
  scheduleSelectionIntent?: (intent: {
    taskId: string;
    externalSessionId: string | null;
    role: AgentRole;
  }) => void;
  onContextSwitchIntent?: () => void;
};

export type UseAgentStudioSessionActionsResult = {
  isStarting: boolean;
  sessionStartModal: SessionStartModalModel | null;
  humanReviewFeedbackModal: HumanReviewFeedbackModalModel | null;
  startSessionRequest: (request: SessionStartLaunchRequest) => Promise<string | undefined>;
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
  handleWorkflowStepSelect: (role: AgentRole, externalSessionId: string | null) => void;
  handleSessionSelectionChange: (nextValue: string) => void;
  handleCreateSession: (option: SessionCreateOption) => void;
  handlePrepareMessageFirstSession: (option: SessionCreateOption) => void;
  handleQuickAction: (option: AgentStudioQuickActionOption) => void;
};

export function useAgentStudioSessionActions({
  activeWorkspace,
  branches = [],
  taskId,
  role,
  launchActionId,
  activeSession,
  selectedModelSelection,
  selectedModelDescriptor,
  sessionsForTask,
  selectedTask,
  agentStudioReady,
  isActiveTaskReady,
  isSessionSelectionResolving,
  selectionForNewSession,
  reusablePrompts,
  repoSettings,
  startAgentSession,
  settleStartedAgentSession,
  sendAgentMessage,
  humanRequestChangesTask,
  setTaskTargetBranch,
  answerAgentQuestion,
  updateQuery,
  scheduleSelectionIntent,
  onContextSwitchIntent,
}: UseAgentStudioSessionActionsArgs): UseAgentStudioSessionActionsResult {
  const sessionState = useAgentStudioSessionActionState({
    activeSession,
    role,
    selectedModelSelection,
  });
  const startFlowSessionWorking = sessionState.isSessionBusy;
  const getBusySendBlockedReason = (isSessionWorking: boolean): string | null => {
    if (
      !sessionState.hasActiveSession ||
      !isSessionWorking ||
      sessionState.isWaitingInput ||
      sessionState.supportsQueuedUserMessages
    ) {
      return null;
    }

    return `${sessionState.activeRuntimeLabel} does not support queued messages while the session is working.`;
  };
  const sendBlockedReasonBeforeCurrentSend = getBusySendBlockedReason(startFlowSessionWorking);

  const {
    isStarting,
    sessionStartModal,
    humanReviewFeedbackModal,
    startSessionRequest,
    startSession,
    startLaunchKickoff,
    handleCreateSession: startFlowHandleCreateSession,
    handleQuickAction: startFlowHandleQuickAction,
  } = useAgentStudioSessionStartFlow({
    activeWorkspace,
    branches,
    taskId,
    role,
    launchActionId,
    activeSession,
    sessionsForTask,
    selectedTask,
    agentStudioReady,
    isActiveTaskReady,
    isSessionWorking: startFlowSessionWorking,
    selectionForNewSession,
    repoSettings,
    startAgentSession,
    settleStartedAgentSession,
    sendAgentMessage,
    humanRequestChangesTask,
    ...(setTaskTargetBranch ? { setTaskTargetBranch } : {}),
    updateQuery,
    ...(onContextSwitchIntent ? { onContextSwitchIntent } : {}),
  });

  const { isSending, onSend } = useAgentStudioSendAction({
    activeWorkspace,
    taskId,
    role,
    activeExternalSessionId: sessionState.activeExternalSessionId,
    activeSessionIsLoadingModelCatalog: sessionState.activeSessionIsLoadingModelCatalog,
    activeSessionSelectedModel: sessionState.activeSessionSelectedModel,
    agentStudioReady,
    canQueueBusyFollowups: sessionState.canQueueBusyFollowups,
    reusablePrompts,
    isStarting,
    isWaitingInput: sessionState.isWaitingInput,
    busySendBlockedReason: sendBlockedReasonBeforeCurrentSend,
    selectedTask,
    selectedModelDescriptor,
    sendAgentMessage,
    startSession,
  });

  const isSessionWorking = sessionState.isSessionBusy || isSending;
  const busySendBlockedReason = getBusySendBlockedReason(sessionState.isSessionBusy);

  const handleQuickAction = useCallback(
    (option: AgentStudioQuickActionOption): void => {
      if (isSessionWorking) {
        return;
      }
      startFlowHandleQuickAction(option);
    },
    [isSessionWorking, startFlowHandleQuickAction],
  );

  const handleCreateSession = useCallback(
    (option: SessionCreateOption): void => {
      if (sessionState.hasActiveSession && isSessionWorking) {
        return;
      }
      startFlowHandleCreateSession(option);
    },
    [sessionState.hasActiveSession, isSessionWorking, startFlowHandleCreateSession],
  );

  const { isSubmittingQuestionByRequestId, onSubmitQuestionAnswers } =
    useAgentStudioQuestionActions({
      activeExternalSessionId: sessionState.activeExternalSessionId,
      agentStudioReady,
      pendingQuestions: sessionState.activeSessionPendingQuestions,
      answerAgentQuestion,
    });

  const {
    handleWorkflowStepSelect,
    handleSessionSelectionChange,
    handlePrepareMessageFirstSession,
  } = useAgentStudioSelectionActions({
    taskId,
    activeExternalSessionId: sessionState.activeExternalSessionId,
    activeSessionRole: sessionState.activeSessionRole,
    activeSessionExists: sessionState.hasActiveSession,
    agentStudioReady,
    isActiveTaskReady,
    isSessionWorking,
    sessionsForTask,
    selectedTask,
    updateQuery,
    scheduleSelectionIntent,
    onContextSwitchIntent,
  });

  const selectedRoleAvailable = selectedTask ? canStartSessionForRole(selectedTask, role) : false;
  const selectedLaunchAction = getSessionLaunchAction(launchActionId);
  const canKickoffNewSession =
    agentStudioReady &&
    Boolean(taskId) &&
    isActiveTaskReady &&
    !isSessionSelectionResolving &&
    !sessionState.hasActiveSession &&
    selectedRoleAvailable &&
    Boolean(selectedLaunchAction.kickoffTemplateId);
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
