import type { RuntimeApprovalReplyOutcome } from "@openducktor/contracts";
import type { AgentModelCatalog, AgentSessionTodoItem } from "@openducktor/core";
import { type MutableRefObject, type RefObject, useCallback, useMemo, useState } from "react";
import type { AgentApprovalRequest, AgentQuestionRequest } from "@/types/agent-orchestrator";
import type {
  AgentChatEmptyStateModel,
  AgentChatRuntimePresentation,
  AgentChatThreadModel,
  AgentChatTranscriptPresentation,
} from "./agent-chat.types";

// SAFETY: The surrounding boundary constructs or validates every member required by `Record<string, number>`.
const EMPTY_SUBAGENT_PENDING_APPROVAL_COUNTS = Object.freeze({}) as Record<string, number>;
// SAFETY: The surrounding boundary constructs or validates every member required by `Record<string, number>`.
const EMPTY_SUBAGENT_PENDING_QUESTION_COUNTS = Object.freeze({}) as Record<string, number>;

export type AgentChatPendingQuestionActions = {
  canSubmit: boolean;
  isSubmittingByRequestId: Record<string, boolean>;
  onSubmit: (requestId: string, answers: string[][]) => Promise<void>;
};

export type AgentChatPendingApprovalActions = {
  canReply: boolean;
  isSubmittingByRequestId: Record<string, boolean>;
  errorByRequestId: Record<string, string>;
  onReply: (requestId: string, outcome: RuntimeApprovalReplyOutcome) => Promise<void>;
};

type AgentChatThreadComposerActivity = {
  isStarting: boolean;
  isSending: boolean;
} | null;

type UseAgentChatThreadModelArgs = {
  modelCatalog: AgentModelCatalog | null;
  transcript: AgentChatTranscriptPresentation;
  interactionEnabled: boolean;
  runtimePresentation: AgentChatRuntimePresentation;
  isSessionWorking: boolean;
  composerActivity: AgentChatThreadComposerActivity;
  sessionAuxiliaryError: string | null;
  emptyState: AgentChatEmptyStateModel | null;
  pendingApprovalRequests: readonly AgentApprovalRequest[];
  pendingQuestionRequests: readonly AgentQuestionRequest[];
  todos: readonly AgentSessionTodoItem[];
  sessionAccentColor?: string | undefined;
  pendingQuestions: AgentChatPendingQuestionActions;
  approvals: AgentChatPendingApprovalActions;
  sessionAgentColors: Record<string, string>;
  subagentPendingApprovalCountBySessionKey: Record<string, number> | undefined;
  subagentPendingQuestionCountBySessionKey: Record<string, number> | undefined;
  messagesContainerRef: RefObject<HTMLDivElement | null>;
  scrollToBottomOnSendRef: MutableRefObject<(() => void) | null>;
  syncBottomAfterComposerLayoutRef: MutableRefObject<(() => void) | null>;
};

export function useAgentChatThreadModel({
  modelCatalog,
  transcript,
  interactionEnabled,
  runtimePresentation,
  isSessionWorking,
  composerActivity,
  sessionAuxiliaryError,
  emptyState,
  pendingApprovalRequests,
  pendingQuestionRequests,
  todos,
  sessionAccentColor,
  pendingQuestions,
  approvals,
  sessionAgentColors,
  subagentPendingApprovalCountBySessionKey,
  subagentPendingQuestionCountBySessionKey,
  messagesContainerRef,
  scrollToBottomOnSendRef,
  syncBottomAfterComposerLayoutRef,
}: UseAgentChatThreadModelArgs): AgentChatThreadModel {
  const { displayedSessionKey } = transcript;
  const [todoPanelCollapsedBySessionKey, setTodoPanelCollapsedBySessionKey] = useState<
    Record<string, boolean>
  >({});
  const activeTodoPanelCollapsed = displayedSessionKey
    ? (todoPanelCollapsedBySessionKey[displayedSessionKey] ?? true)
    : true;

  const handleToggleTodoPanel = useCallback((): void => {
    if (!displayedSessionKey) {
      return;
    }
    setTodoPanelCollapsedBySessionKey((current) => ({
      ...current,
      [displayedSessionKey]: !(current[displayedSessionKey] ?? true),
    }));
  }, [displayedSessionKey]);

  const canSubmitQuestionAnswers = interactionEnabled && pendingQuestions.canSubmit;
  const canReplyToApprovalRequests = interactionEnabled && approvals.canReply;

  return useMemo(
    () => ({
      modelCatalog,
      transcript,
      runtimePresentation,
      isSessionWorking,
      isInteractionEnabled: interactionEnabled,
      emptyState,
      isStarting: composerActivity?.isStarting ?? false,
      isSending: composerActivity?.isSending ?? false,
      sessionAgentColors,
      pendingApprovalRequests,
      pendingQuestionRequests,
      subagentPendingApprovalCountBySessionKey:
        subagentPendingApprovalCountBySessionKey ?? EMPTY_SUBAGENT_PENDING_APPROVAL_COUNTS,
      subagentPendingQuestionCountBySessionKey:
        subagentPendingQuestionCountBySessionKey ?? EMPTY_SUBAGENT_PENDING_QUESTION_COUNTS,
      todos,
      sessionAccentColor,
      canSubmitQuestionAnswers,
      isSubmittingQuestionByRequestId: pendingQuestions.isSubmittingByRequestId,
      onSubmitQuestionAnswers: pendingQuestions.onSubmit,
      canReplyToApprovals: canReplyToApprovalRequests,
      isSubmittingApprovalByRequestId: approvals.isSubmittingByRequestId,
      approvalReplyErrorByRequestId: approvals.errorByRequestId,
      onReplyApproval: approvals.onReply,
      sessionAuxiliaryError,
      todoPanelCollapsed: activeTodoPanelCollapsed,
      onToggleTodoPanel: handleToggleTodoPanel,
      messagesContainerRef,
      scrollToBottomOnSendRef,
      syncBottomAfterComposerLayoutRef,
    }),
    [
      activeTodoPanelCollapsed,
      approvals,
      canReplyToApprovalRequests,
      canSubmitQuestionAnswers,
      composerActivity,
      emptyState,
      handleToggleTodoPanel,
      interactionEnabled,
      isSessionWorking,
      messagesContainerRef,
      modelCatalog,
      pendingApprovalRequests,
      pendingQuestionRequests,
      pendingQuestions,
      runtimePresentation,
      scrollToBottomOnSendRef,
      sessionAccentColor,
      sessionAgentColors,
      todos,
      sessionAuxiliaryError,
      subagentPendingApprovalCountBySessionKey,
      subagentPendingQuestionCountBySessionKey,
      syncBottomAfterComposerLayoutRef,
      transcript,
    ],
  );
}
