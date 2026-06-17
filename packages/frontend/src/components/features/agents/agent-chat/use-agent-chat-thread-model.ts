import type { RuntimeApprovalReplyOutcome, RuntimeDescriptor } from "@openducktor/contracts";
import { type MutableRefObject, type RefObject, useCallback, useMemo, useState } from "react";
import { findRuntimeDefinition } from "@/lib/agent-runtime";
import type { RepoRuntimeReadiness } from "@/lib/use-repo-runtime-readiness";
import type { AgentSessionTranscriptState } from "@/state/operations/agent-orchestrator/transcript/session-transcript-state";
import type { AgentChatEmptyStateModel, AgentChatThreadModel } from "./agent-chat.types";
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
  transcriptState: AgentSessionTranscriptState;
  runtimeReadiness: RepoRuntimeReadiness;
  isSessionWorking: boolean;
  hasComposer: boolean;
  composerActivity: AgentChatThreadComposerActivity;
  runtimeDefinitions: RuntimeDescriptor[];
  sessionAuxiliaryError: string | null;
  emptyState: AgentChatEmptyStateModel | null;
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
  transcriptState,
  runtimeReadiness,
  isSessionWorking,
  hasComposer,
  composerActivity,
  runtimeDefinitions,
  sessionAuxiliaryError,
  emptyState,
  pendingQuestions,
  approvals,
  sessionAgentColors,
  subagentPendingApprovalCountBySessionKey,
  subagentPendingQuestionCountBySessionKey,
  messagesContainerRef,
  scrollToBottomOnSendRef,
  syncBottomAfterComposerLayoutRef,
}: UseAgentChatThreadModelArgs): AgentChatThreadModel {
  const { threadSession, displayedSessionKey, shouldResetTranscriptWindow, transcriptNotice } =
    threadState;
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

  const canSubmitQuestionAnswers = runtimeReadiness.isReady && pendingQuestions.canSubmit;
  const canReplyToApprovalRequests = runtimeReadiness.isReady && approvals.canReply;
  const runtimeSupportedApprovalReplyOutcomes = useMemo(() => {
    const runtimeKind = threadSession?.runtimeKind;
    if (!runtimeKind) {
      return null;
    }
    return (
      findRuntimeDefinition(runtimeDefinitions, runtimeKind)?.capabilities.approvals
        .supportedReplyOutcomes ?? null
    );
  }, [runtimeDefinitions, threadSession?.runtimeKind]);

  return useMemo(
    () => ({
      session: threadSession,
      displayedSessionKey,
      transcriptState,
      runtimeReadiness,
      isSessionWorking,
      isInteractionEnabled: hasComposer && runtimeReadiness.isReady,
      emptyState,
      isStarting: composerActivity?.isStarting ?? false,
      isSending: composerActivity?.isSending ?? false,
      sessionAgentColors,
      subagentPendingApprovalCountBySessionKey:
        subagentPendingApprovalCountBySessionKey ?? EMPTY_SUBAGENT_PENDING_APPROVAL_COUNTS,
      subagentPendingQuestionCountBySessionKey:
        subagentPendingQuestionCountBySessionKey ?? EMPTY_SUBAGENT_PENDING_QUESTION_COUNTS,
      canSubmitQuestionAnswers,
      isSubmittingQuestionByRequestId: pendingQuestions.isSubmittingByRequestId,
      onSubmitQuestionAnswers: pendingQuestions.onSubmit,
      canReplyToApprovals: canReplyToApprovalRequests,
      runtimeSupportedApprovalReplyOutcomes,
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
      isSessionWorking,
      messagesContainerRef,
      pendingQuestions,
      runtimeReadiness,
      runtimeSupportedApprovalReplyOutcomes,
      scrollToBottomOnSendRef,
      sessionAgentColors,
      transcriptState,
      sessionAuxiliaryError,
      shouldResetTranscriptWindow,
      subagentPendingApprovalCountBySessionKey,
      subagentPendingQuestionCountBySessionKey,
      syncBottomAfterComposerLayoutRef,
      threadSession,
      transcriptNotice,
    ],
  );
}
