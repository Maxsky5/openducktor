import type { RuntimeApprovalReplyOutcome, RuntimeDescriptor } from "@openducktor/contracts";
import { type MutableRefObject, type RefObject, useCallback, useMemo, useState } from "react";
import { findRuntimeDefinition } from "@/lib/agent-runtime";
import type { RepoRuntimeReadiness } from "@/lib/use-repo-runtime-readiness";
import type { AgentSessionTranscriptState } from "@/state/operations/agent-orchestrator/lifecycle/session-view-lifecycle";
import type {
  AgentChatEmptyStateModel,
  AgentChatThreadModel,
  AgentChatThreadSession,
} from "./agent-chat.types";

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
  threadSession: AgentChatThreadSession | null;
  activeSessionKey: string | null;
  transcriptState: AgentSessionTranscriptState;
  runtimeReadiness: RepoRuntimeReadiness;
  isSessionWorking: boolean;
  hasComposer: boolean;
  composerActivity: AgentChatThreadComposerActivity;
  runtimeDefinitions: RuntimeDescriptor[];
  sessionRuntimeDataError: string | null;
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
  threadSession,
  activeSessionKey,
  transcriptState,
  runtimeReadiness,
  isSessionWorking,
  hasComposer,
  composerActivity,
  runtimeDefinitions,
  sessionRuntimeDataError,
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
  const [todoPanelCollapsedBySessionKey, setTodoPanelCollapsedBySessionKey] = useState<
    Record<string, boolean>
  >({});
  const activeTodoPanelCollapsed = activeSessionKey
    ? (todoPanelCollapsedBySessionKey[activeSessionKey] ?? true)
    : true;

  const handleToggleTodoPanel = useCallback((): void => {
    if (!activeSessionKey) {
      return;
    }
    setTodoPanelCollapsedBySessionKey((current) => ({
      ...current,
      [activeSessionKey]: !(current[activeSessionKey] ?? true),
    }));
  }, [activeSessionKey]);

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
      sessionRuntimeDataError,
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
      hasComposer,
      isSessionWorking,
      messagesContainerRef,
      pendingQuestions,
      runtimeReadiness,
      runtimeSupportedApprovalReplyOutcomes,
      scrollToBottomOnSendRef,
      sessionAgentColors,
      transcriptState,
      sessionRuntimeDataError,
      subagentPendingApprovalCountBySessionKey,
      subagentPendingQuestionCountBySessionKey,
      syncBottomAfterComposerLayoutRef,
      threadSession,
    ],
  );
}
