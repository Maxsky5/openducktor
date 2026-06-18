import type {
  GitBranch,
  GitTargetBranch,
  ReusablePrompt,
  RuntimeDescriptor,
  TaskCard,
} from "@openducktor/contracts";
import type { AgentModelCatalog, AgentModelSelection, AgentRole } from "@openducktor/core";
import { useCallback, useMemo } from "react";
import type { SessionStartModalModel } from "@/components/features/agents";
import type { AgentChatComposerDraft } from "@/components/features/agents/agent-chat/agent-chat-composer-draft";
import { useAgentSessionQuestionActions } from "@/components/features/agents/agent-chat/use-agent-session-question-actions";
import type { HumanReviewFeedbackModalModel } from "@/features/human-review-feedback/human-review-feedback-types";
import type {
  RunSessionStartWorkflow,
  SessionStartLaunchRequest,
  SessionStartWorkflowResult,
} from "@/features/session-start";
import { LAUNCH_ACTION_LABELS, type SessionLaunchActionId } from "@/features/session-start";
import type { AgentSessionSummary } from "@/state/agent-sessions-store";
import type { AgentSessionIdentity, AgentSessionState } from "@/types/agent-orchestrator";
import type { AgentSessionActivityState } from "@/types/agent-session-activity";
import type { SelectedSessionRuntimeData } from "@/types/selected-session-runtime-data";
import type { AgentOperationsContextValue, RepoSettingsInput } from "@/types/state-slices";
import type { AgentStudioQuickActionOption } from "./agent-studio-quick-actions";
import type { SessionCreateOption } from "./agents-page-session-tabs";
import type { AgentStudioQueryUpdate as QueryUpdate } from "./query-sync/agent-studio-navigation";
import { deriveAgentStudioSessionActionState } from "./session-actions/agent-studio-session-action-state";
import { useAgentStudioSelectionActions } from "./session-actions/use-agent-studio-selection-actions";
import { useAgentStudioSendAction } from "./session-actions/use-agent-studio-send-action";
import {
  canStartAgentStudioSessionRole,
  canUseAgentStudioKickoffPrompt,
} from "./session-start/agent-studio-session-start-availability";
import { useAgentStudioSessionStartFlow } from "./session-start/use-agent-studio-session-start-flow";
import type { AgentStudioSelectionIntent } from "./shell/agent-studio-selection-intent";

export type { NewSessionStartDecision, NewSessionStartRequest } from "@/features/session-start";

const EMPTY_PENDING_QUESTION_REQUEST_IDS: readonly string[] = Object.freeze([]);

type UseAgentStudioSessionActionsArgs = {
  activeWorkspaceId: string | null;
  branches?: GitBranch[];
  taskId: string;
  role: AgentRole;
  launchActionId: SessionLaunchActionId;
  selectedSessionIdentity: AgentSessionIdentity | null;
  selectedSessionActivityState: AgentSessionActivityState | null;
  selectedSessionModel: AgentSessionState["selectedModel"];
  loadedSession: AgentSessionState | null;
  sessionRuntimeData: SelectedSessionRuntimeData;
  runtimeDefinitions: RuntimeDescriptor[];
  selectedModelDescriptor?: AgentModelCatalog["models"][number] | null;
  sessionsForTask: AgentSessionSummary[];
  selectedTask: TaskCard | null;
  agentStudioReady: boolean;
  isActiveTaskReady: boolean;
  selectionForNewSession: AgentModelSelection | null;
  reusablePrompts: ReusablePrompt[];
  repoSettings: RepoSettingsInput | null;
  workspaceRepoPath: string | null;
  runSessionStartWorkflow: RunSessionStartWorkflow;
  sendAgentMessage: AgentOperationsContextValue["sendAgentMessage"];
  humanRequestChangesTask: (taskId: string, note?: string) => Promise<void>;
  setTaskTargetBranch?: (taskId: string, targetBranch: GitTargetBranch) => Promise<void>;
  answerAgentQuestion: AgentOperationsContextValue["answerAgentQuestion"];
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
  canUseKickoffPrompt: boolean;
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
  selectedSessionIdentity,
  selectedSessionActivityState,
  selectedSessionModel,
  loadedSession,
  sessionRuntimeData,
  runtimeDefinitions,
  selectedModelDescriptor,
  sessionsForTask,
  selectedTask,
  agentStudioReady,
  isActiveTaskReady,
  selectionForNewSession,
  reusablePrompts,
  repoSettings,
  workspaceRepoPath,
  runSessionStartWorkflow,
  sendAgentMessage,
  humanRequestChangesTask,
  setTaskTargetBranch,
  answerAgentQuestion,
  updateQuery,
  scheduleSelectionIntent,
}: UseAgentStudioSessionActionsArgs): UseAgentStudioSessionActionsResult {
  const sessionState = deriveAgentStudioSessionActionState({
    selectedSessionIdentity,
    selectedSessionActivityState,
    sessionRuntimeData,
    runtimeDefinitions,
  });
  const loadedSessionPendingQuestionRequestIds = useMemo(
    () =>
      loadedSession?.pendingQuestions.map((pendingQuestion) => pendingQuestion.requestId) ??
      EMPTY_PENDING_QUESTION_REQUEST_IDS,
    [loadedSession],
  );
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
    selectedSessionIdentity,
    loadedSession,
    sessionsForTask,
    selectedTask,
    canStartRole,
    isSessionWorking: sessionState.isSessionWorking,
    selectionForNewSession,
    repoSettings,
    workspaceId: activeWorkspaceId,
    workspaceRepoPath,
    runSessionStartWorkflow,
    humanRequestChangesTask,
    ...(setTaskTargetBranch ? { setTaskTargetBranch } : {}),
    updateQuery,
  });

  const { isSending, onSend } = useAgentStudioSendAction({
    workspaceId: activeWorkspaceId,
    taskId,
    role,
    selectedSessionIdentity,
    selectedSessionModel,
    sessionState,
    isSessionModelCatalogLoading: sessionRuntimeData.isLoadingModelCatalog,
    agentStudioReady,
    canStartNewSession,
    reusablePrompts,
    isStarting,
    selectedModelDescriptor,
    sendAgentMessage,
    startSession,
  });

  const isSessionWorking = sessionState.isSessionWorking;
  const isSessionInteractionBusy = isSessionWorking || isSending;
  const busySendBlockedReason = sessionState.busySendBlockedReason;

  const canPrepareMessageFirstSession = useCallback(
    (option: SessionCreateOption): boolean => {
      if (option.disabled || (selectedSessionIdentity !== null && isSessionInteractionBusy)) {
        return false;
      }
      return canStartRole(option.role);
    },
    [canStartRole, isSessionInteractionBusy, selectedSessionIdentity],
  );

  const { isSubmittingQuestionByRequestId, onSubmitQuestionAnswers } =
    useAgentSessionQuestionActions({
      sessionIdentity: selectedSessionIdentity,
      pendingQuestionRequestIds: loadedSessionPendingQuestionRequestIds,
      canAnswerQuestions: agentStudioReady,
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

  const canUseKickoffPrompt = canUseAgentStudioKickoffPrompt({
    canStartSession: canStartNewSession,
    launchActionId,
  });
  const kickoffLabel = LAUNCH_ACTION_LABELS[launchActionId];
  const canStopSession = selectedSessionIdentity !== null && isSessionWorking;

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
    canUseKickoffPrompt,
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
