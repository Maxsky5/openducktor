import type { AgentChatSend } from "@openducktor/frontend-core/sessions/send/agent-chat.types";
import { useAgentChatSend } from "@openducktor/frontend-core/sessions/send/use-agent-chat-send";
import { useStableAgentSessionIdentity } from "@openducktor/frontend-core/lib/use-stable-agent-session-identity";
import { agentSessionIdentityKey } from "@openducktor/frontend-core/lib/agent-session-identity";
import {
  getAgentSessionActivityStateFromSession,
  isAgentSessionActivityWorking,
} from "@openducktor/frontend-core/lib/agent-session-activity-state";
import type {
  GitBranch,
  ReusablePrompt,
  RuntimeApprovalReplyOutcome,
  RuntimeDescriptor,
  TaskCard,
} from "@openducktor/contracts";
import type { AgentModelCatalog, AgentModelSelection, AgentRole } from "@openducktor/core";
import { useCallback } from "react";
import type { SessionStartModalModel } from "@openducktor/frontend-core/sessions/start/session-start-modal-model";
import { hasSettledLatestTurn } from "@openducktor/frontend-core/lib/agent-session-interrupted-turn";
import { isRoleAvailableForTask } from "@openducktor/frontend-core/lib/task-agent-workflows";
import { useInterruptedTurnResume } from "@openducktor/frontend-core/sessions/session-view/use-interrupted-turn-resume";
import { useAgentSessionApprovalActions } from "@openducktor/frontend-core/sessions/pending-input/use-agent-session-approval-actions";
import { useAgentSessionQuestionActions } from "@openducktor/frontend-core/sessions/pending-input/use-agent-session-question-actions";
import type { HumanReviewFeedbackModalModel } from "@openducktor/frontend-core/tasks/workflow/human-review-feedback-types";
import type {
  RunSessionStartWorkflow,
  SessionStartLaunchRequest,
} from "@openducktor/frontend-core/sessions/start/session-start-orchestration";
import type { SessionStartWorkflowResult } from "@openducktor/frontend-core/sessions/start/session-start-workflow";
import { LAUNCH_ACTION_LABELS } from "@openducktor/frontend-core/sessions/start/session-start-prompts";
import { type SessionLaunchActionId } from "@openducktor/frontend-core/lib/session-launch-actions";
import type { AgentSessionSummary } from "@openducktor/frontend-core/sessions/agent-sessions-store";
import type {
  AgentApprovalRequest,
  AgentQuestionRequest,
} from "@openducktor/frontend-core/types/agent-orchestrator";
import type { AgentOperationsContextValue, RepoSettingsInput } from "@/types/state-slices";
import type { AgentStudioQuickActionOption } from "@openducktor/frontend-core/sessions/start/agent-studio-quick-actions";
import type { SessionCreateOption } from "./agents-page-session-tabs";
import type { AgentStudioQueryUpdate as QueryUpdate } from "./query-sync/agent-studio-navigation";
import type { AgentStudioSelectedSessionState } from "./selected-session/selected-session-state";
import { deriveAgentStudioSessionActionState } from "./session-actions/agent-studio-session-action-state";
import { useAgentStudioSelectionActions } from "./session-actions/use-agent-studio-selection-actions";
import { useAgentStudioSendTarget } from "./session-actions/use-agent-studio-send-target";
import {
  canStartAgentStudioSessionRole,
  canUseAgentStudioKickoffPrompt,
} from "./session-start/agent-studio-session-start-availability";
import { useAgentStudioSessionStartFlow } from "./session-start/use-agent-studio-session-start-flow";
import type { SelectAgentStudioSelection } from "./shell/agent-studio-selection-state";

export type {
  NewSessionStartDecision,
  NewSessionStartRequest,
} from "@openducktor/frontend-core/sessions/start/session-start-types";

const EMPTY_PENDING_APPROVAL_REQUESTS = Object.freeze(new Array<AgentApprovalRequest>());
const EMPTY_PENDING_QUESTION_REQUESTS = Object.freeze(new Array<AgentQuestionRequest>());

type UseAgentStudioSessionActionsArgs = {
  activeWorkspaceId: string | null;
  branches?: GitBranch[];
  favoriteState: SessionStartModalModel["favoriteState"];
  taskId: string;
  role: AgentRole;
  launchActionId: SessionLaunchActionId;
  selectedSession: AgentStudioSelectedSessionState;
  runtimeDefinitions: RuntimeDescriptor[];
  selectedModelDescriptor?: AgentModelCatalog["models"][number] | null;
  isSelectionCatalogLoading: boolean;
  supportsAttachments: boolean;
  sessionsForTask: AgentSessionSummary[];
  selectedTask: TaskCard | null;
  assertCanPrepareSession: Parameters<
    typeof useAgentStudioSendTarget
  >[0]["assertCanPrepareSession"];
  agentStudioReady: boolean;
  isActiveTaskReady: boolean;
  selectionForNewSession: AgentModelSelection | null;
  reusablePrompts: ReusablePrompt[];
  repoSettings: RepoSettingsInput | null;
  workspaceRepoPath: string | null;
  runSessionStartWorkflow: RunSessionStartWorkflow;
  sendAgentMessage: AgentOperationsContextValue["sendAgentMessage"];
  continueInterruptedTurn: AgentOperationsContextValue["continueInterruptedTurn"];
  replyAgentApproval: AgentOperationsContextValue["replyAgentApproval"];
  answerAgentQuestion: AgentOperationsContextValue["answerAgentQuestion"];
  scheduleQueryUpdate: (updates: QueryUpdate) => void;
  selectAgentStudioSelection: SelectAgentStudioSelection;
};

export type UseAgentStudioSessionActionsResult = {
  isStarting: boolean;
  sessionStartModal: SessionStartModalModel | null;
  humanReviewFeedbackModal: HumanReviewFeedbackModalModel | null;
  startSessionRequest: (
    request: SessionStartLaunchRequest,
  ) => Promise<SessionStartWorkflowResult | undefined>;
  isSubmittingQuestionByRequestId: Record<string, boolean>;
  isSubmittingApprovalByRequestId: Record<string, boolean>;
  approvalReplyErrorByRequestId: Record<string, string>;
  isSessionWorking: boolean;
  isWaitingInput: boolean;
  messageDelivery: AgentChatSend;
  canUseKickoffPrompt: boolean;
  kickoffLabel: string;
  canStopSession: boolean;
  canResumeSession: boolean;
  isResumingSession: boolean;
  resumeSessionError: string | null;
  persistentResumeError: string | null;
  onResumeSession: () => void;
  startLaunchKickoff: () => Promise<void>;
  onSubmitQuestionAnswers: (requestId: string, answers: string[][]) => Promise<void>;
  onReplyApproval: (requestId: string, outcome: RuntimeApprovalReplyOutcome) => Promise<void>;
  handleWorkflowStepSelect: (role: AgentRole, sessionValue: string | null) => void;
  handleSessionSelectionChange: (nextValue: string) => void;
  handleCreateSession: (option: SessionCreateOption) => void;
  handlePrepareMessageFirstSession: (option: SessionCreateOption) => void;
  handleQuickAction: (option: AgentStudioQuickActionOption) => void;
};

export function useAgentStudioSessionActions({
  activeWorkspaceId,
  branches = [],
  favoriteState,
  taskId,
  role,
  launchActionId,
  selectedSession,
  runtimeDefinitions,
  selectedModelDescriptor,
  isSelectionCatalogLoading,
  supportsAttachments,
  sessionsForTask,
  selectedTask,
  assertCanPrepareSession,
  agentStudioReady,
  isActiveTaskReady,
  selectionForNewSession,
  reusablePrompts,
  repoSettings,
  workspaceRepoPath,
  runSessionStartWorkflow,
  sendAgentMessage,
  continueInterruptedTurn,
  replyAgentApproval,
  answerAgentQuestion,
  scheduleQueryUpdate,
  selectAgentStudioSelection,
}: UseAgentStudioSessionActionsArgs): UseAgentStudioSessionActionsResult {
  const sessionState = deriveAgentStudioSessionActionState({
    selectedSession,
    runtimeDefinitions,
  });
  const loadedSession = selectedSession.loadedSession;
  const selectedSessionIdentity = selectedSession.identity;
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
  const sessionStartInput: Parameters<typeof useAgentStudioSessionStartFlow>[0] = {
    branches,
    favoriteState,
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
    scheduleQueryUpdate,
  };

  const {
    isStarting,
    sessionStartModal,
    humanReviewFeedbackModal,
    startSessionRequest,
    startPreparedSession,
    startLaunchKickoff,
    handleCreateSession,
    handleQuickAction,
  } = useAgentStudioSessionStartFlow(sessionStartInput);

  const stableSelectedSessionIdentity = useStableAgentSessionIdentity(selectedSessionIdentity);
  const sendTarget = useAgentStudioSendTarget({
    workspaceId: activeWorkspaceId,
    taskId,
    role,
    selectedSessionIdentity: stableSelectedSessionIdentity,
    isCatalogLoading: isSelectionCatalogLoading,
    launchActionId,
    selectionForNewSession,
    selectedTask,
    startPreparedSession,
    scheduleQueryUpdate,
    canStartSession: canStartRole(role),
    assertCanPrepareSession,
    agentStudioReady:
      agentStudioReady && (selectedSessionIdentity === null || selectedSession.preparation.ready),
    isStarting,
  });
  const messageDelivery = useAgentChatSend({
    identity: stableSelectedSessionIdentity,
    repoPath: workspaceRepoPath,
    runtimeDescriptor: sessionState.runtimeDescriptor,
    modelCatalog: selectedSession.runtimeData.modelCatalog,
    messages: loadedSession?.messages.items,
    isSessionWorking: sessionState.isSessionWorking,
    foregroundTurnActive: loadedSession?.foregroundTurnActive,
    isWaitingInput: sessionState.isWaitingInput,
    selectedModelDescriptor,
    draftRules: { reusablePrompts, supportsAttachments },
    sendAgentMessage,
    target: sendTarget,
  });

  const isSessionWorking = sessionState.isSessionWorking;
  const isSessionInteractionBusy = isSessionWorking || messageDelivery.isSending;

  const canPrepareMessageFirstSession = useCallback(
    (option: SessionCreateOption): boolean => {
      if (option.disabled || (selectedSessionIdentity !== null && isSessionInteractionBusy)) {
        return false;
      }
      // A draft can choose another runtime before its first Send.
      return (
        Boolean(taskId) && isActiveTaskReady && isRoleAvailableForTask(selectedTask, option.role)
      );
    },
    [isActiveTaskReady, isSessionInteractionBusy, selectedSessionIdentity, selectedTask, taskId],
  );

  const { isSubmittingQuestionByRequestId, onSubmitQuestionAnswers } =
    useAgentSessionQuestionActions({
      sessionIdentity: selectedSessionIdentity,
      pendingQuestions: loadedSession?.pendingQuestions ?? EMPTY_PENDING_QUESTION_REQUESTS,
      canAnswerQuestions: agentStudioReady,
      answerAgentQuestion,
      sessionScope:
        loadedSession?.sessionAssociation.kind === "unbound"
          ? undefined
          : loadedSession?.sessionAssociation,
    });
  const { isSubmittingApprovalByRequestId, approvalReplyErrorByRequestId, onReplyApproval } =
    useAgentSessionApprovalActions({
      sessionIdentity: selectedSessionIdentity,
      pendingApprovals: loadedSession?.pendingApprovals ?? EMPTY_PENDING_APPROVAL_REQUESTS,
      canReplyToApprovals: agentStudioReady,
      replyAgentApproval,
    });

  const {
    handleWorkflowStepSelect,
    handleSessionSelectionChange,
    handlePrepareMessageFirstSession,
  } = useAgentStudioSelectionActions({
    taskId,
    sessionsForTask,
    canPrepareMessageFirstSession,
    selectAgentStudioSelection,
  });

  const canUseKickoffPrompt = canUseAgentStudioKickoffPrompt({
    canStartSession: canStartRole(role),
    launchActionId,
  });
  const kickoffLabel = LAUNCH_ACTION_LABELS[launchActionId];
  const canStopSession =
    selectedSessionIdentity !== null &&
    isAgentSessionActivityWorking(
      loadedSession
        ? getAgentSessionActivityStateFromSession(loadedSession)
        : selectedSession.activityState,
    );
  const canResumeSession = sessionState.canResumeSession;

  const selectedSessionKey =
    selectedSessionIdentity === null ? null : agentSessionIdentityKey(selectedSessionIdentity);
  const { resume, isSessionResuming, resumeErrorForSession, persistentResumeErrorForSession } =
    useInterruptedTurnResume(continueInterruptedTurn, {
      sessionKey: selectedSessionKey,
      isLatestTurnSettled: hasSettledLatestTurn(loadedSession?.messages.items ?? []),
    });
  const isResumingSession = selectedSessionKey !== null && isSessionResuming(selectedSessionKey);
  const resumeSessionError =
    selectedSessionKey === null ? null : resumeErrorForSession(selectedSessionKey);
  const persistentResumeError =
    selectedSessionKey === null ? null : persistentResumeErrorForSession(selectedSessionKey);

  const onResumeSession = useCallback((): void => {
    if (selectedSessionIdentity === null) {
      return;
    }
    resume(selectedSessionIdentity);
  }, [resume, selectedSessionIdentity]);

  return {
    isStarting,
    sessionStartModal,
    humanReviewFeedbackModal,
    startSessionRequest,
    isSubmittingQuestionByRequestId,
    isSubmittingApprovalByRequestId,
    approvalReplyErrorByRequestId,
    isSessionWorking,
    isWaitingInput: sessionState.isWaitingInput,
    messageDelivery,
    canUseKickoffPrompt,
    kickoffLabel,
    canStopSession,
    canResumeSession,
    isResumingSession,
    resumeSessionError,
    persistentResumeError,
    onResumeSession,
    startLaunchKickoff,
    onSubmitQuestionAnswers,
    onReplyApproval,
    handleWorkflowStepSelect,
    handleSessionSelectionChange,
    handleCreateSession,
    handlePrepareMessageFirstSession,
    handleQuickAction,
  };
}
