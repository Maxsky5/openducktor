import type { RuntimeApprovalReplyOutcome } from "@openducktor/contracts";
import type { AgentModelCatalog, AgentSessionTodoItem } from "@openducktor/core";
import { type MutableRefObject, type RefObject, useCallback, useMemo, useState } from "react";
import type { AgentApprovalRequest, AgentQuestionRequest } from "@/types/agent-orchestrator";
import type {
  AgentChatEmptyStateModel,
  AgentChatRuntimePresentation,
  AgentChatThreadModel,
} from "./agent-chat.types";
import type { AgentChatThreadState } from "./agent-chat-thread-state";

const EMPTY_SUBAGENT_PENDING_APPROVAL_COUNTS = Object.freeze({}) as Record<string, number>;
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
  threadState: AgentChatThreadState;
  modelCatalog: AgentModelCatalog | null;
  interactionEnabled: boolean;
  runtimePresentation: AgentChatRuntimePresentation;
  isSessionWorking: boolean;
  hasComposer: boolean;
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
  threadState,
  modelCatalog,
  interactionEnabled,
  runtimePresentation,
  isSessionWorking,
  hasComposer,
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
  const {
    threadSession,
    transcriptTarget,
    displayedSessionKey,
    shouldResetTranscriptWindow,
    transcriptNotice,
  } = threadState;
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
      session: threadSession,
      modelCatalog,
      transcriptTarget,
      displayedSessionKey,
      runtimePresentation,
      isSessionWorking,
      isInteractionEnabled: hasComposer && interactionEnabled,
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
      shouldResetTranscriptWindow,
      transcriptNotice,
      todoPanelCollapsed: activeTodoPanelCollapsed,
      onToggleTodoPanel: handleToggleTodoPanel,
      messagesContainerRef,
      scrollToBottomOnSendRef,
      syncBottomAfterComposerLayoutRef,
    }),
    [
      activeTodoPanelCollapsed,
      displayedSessionKey,
      approvals,
      canReplyToApprovalRequests,
      canSubmitQuestionAnswers,
      composerActivity,
      emptyState,
      handleToggleTodoPanel,
      hasComposer,
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
      shouldResetTranscriptWindow,
      subagentPendingApprovalCountBySessionKey,
      subagentPendingQuestionCountBySessionKey,
      syncBottomAfterComposerLayoutRef,
      threadSession,
      transcriptTarget,
      transcriptNotice,
    ],
  );
}
