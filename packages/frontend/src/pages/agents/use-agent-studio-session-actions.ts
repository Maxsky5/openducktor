import type {
  GitBranch,
  GitTargetBranch,
  ReusablePrompt,
  RuntimeApprovalReplyOutcome,
  RuntimeDescriptor,
  TaskCard,
} from "@openducktor/contracts";
import type { AgentModelCatalog, AgentModelSelection, AgentRole } from "@openducktor/core";
import { useCallback } from "react";
import type { SessionStartModalModel } from "@/components/features/agents";
import type { AgentChatComposerDraft } from "@/components/features/agents/agent-chat/agent-chat-composer-draft";
import { useAgentSessionApprovalActions } from "@/components/features/agents/agent-chat/use-agent-session-approval-actions";
import { useAgentSessionQuestionActions } from "@/components/features/agents/agent-chat/use-agent-session-question-actions";
import type { HumanReviewFeedbackModalModel } from "@/features/human-review-feedback/human-review-feedback-types";
import type {
  RunSessionStartWorkflow,
  SessionStartLaunchRequest,
  SessionStartWorkflowResult,
} from "@/features/session-start";
import { LAUNCH_ACTION_LABELS, type SessionLaunchActionId } from "@/features/session-start";
import type { AgentSessionSummary } from "@/state/agent-sessions-store";
import type { AgentApprovalRequest, AgentQuestionRequest } from "@/types/agent-orchestrator";
import type { AgentOperationsContextValue, RepoSettingsInput } from "@/types/state-slices";
import type { AgentStudioQuickActionOption } from "./agent-studio-quick-actions";
import type { SessionCreateOption } from "./agents-page-session-tabs";
import type { AgentStudioQueryUpdate as QueryUpdate } from "./query-sync/agent-studio-navigation";
import type { AgentStudioSelectedSessionState } from "./selected-session/selected-session-state";
import { deriveAgentStudioSessionActionState } from "./session-actions/agent-studio-session-action-state";
import { useAgentStudioSelectionActions } from "./session-actions/use-agent-studio-selection-actions";
import { useAgentStudioSendAction } from "./session-actions/use-agent-studio-send-action";
import {
  canStartAgentStudioSessionRole,
  canUseAgentStudioKickoffPrompt,
} from "./session-start/agent-studio-session-start-availability";
import { useAgentStudioSessionStartFlow } from "./session-start/use-agent-studio-session-start-flow";
import type { SelectAgentStudioSelection } from "./shell/agent-studio-selection-state";

export type { NewSessionStartDecision, NewSessionStartRequest } from "@/features/session-start";

const EMPTY_PENDING_APPROVAL_REQUESTS = Object.freeze([]) as readonly AgentApprovalRequest[];
const EMPTY_PENDING_QUESTION_REQUESTS = Object.freeze([]) as readonly AgentQuestionRequest[];

type UseAgentStudioSessionActionsArgs = {
  activeWorkspaceId: string | null;
  branches?: GitBranch[];
  taskId: string;
  role: AgentRole;
  launchActionId: SessionLaunchActionId;
  selectedSession: AgentStudioSelectedSessionState;
  runtimeDefinitions: RuntimeDescriptor[];
  selectedModelDescriptor?: AgentModelCatalog["models"][number] | null;
  supportsAttachments: boolean;
  sessionsForTask: AgentSessionSummary[];
  selectedTask: TaskCard | null;
  isSelectedSessionModelSendable: boolean;
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
  isSending: boolean;
  isSubmittingQuestionByRequestId: Record<string, boolean>;
  isSubmittingApprovalByRequestId: Record<string, boolean>;
  approvalReplyErrorByRequestId: Record<string, string>;
  isSessionWorking: boolean;
  isWaitingInput: boolean;
  busySendBlockedReason: string | null;
  canUseKickoffPrompt: boolean;
  kickoffLabel: string;
  canStopSession: boolean;
  startLaunchKickoff: () => Promise<void>;
  onSend: (draft: AgentChatComposerDraft) => Promise<boolean>;
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
  taskId,
  role,
  launchActionId,
  selectedSession,
  runtimeDefinitions,
  selectedModelDescriptor,
  supportsAttachments,
  sessionsForTask,
  selectedTask,
  isSelectedSessionModelSendable,
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
    scheduleQueryUpdate,
  });

  const { isSending, onSend } = useAgentStudioSendAction({
    workspaceId: activeWorkspaceId,
    taskId,
    role,
    selectedSessionIdentity,
    selectedSessionModel: selectedSession.selectedModel,
    sessionState,
    isSessionModelCatalogLoading: selectedSession.runtimeData.isLoadingModelCatalog,
    isSelectedSessionModelSendable,
    agentStudioReady,
    canStartNewSession,
    reusablePrompts,
    isStarting,
    selectedModelDescriptor,
    supportsAttachments,
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
      pendingQuestions: loadedSession?.pendingQuestions ?? EMPTY_PENDING_QUESTION_REQUESTS,
      canAnswerQuestions: agentStudioReady,
      answerAgentQuestion,
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
    isSubmittingApprovalByRequestId,
    approvalReplyErrorByRequestId,
    isSessionWorking,
    isWaitingInput: sessionState.isWaitingInput,
    busySendBlockedReason,
    canUseKickoffPrompt,
    kickoffLabel,
    canStopSession,
    startLaunchKickoff,
    onSend,
    onSubmitQuestionAnswers,
    onReplyApproval,
    handleWorkflowStepSelect,
    handleSessionSelectionChange,
    handleCreateSession,
    handlePrepareMessageFirstSession,
    handleQuickAction,
  };
}
