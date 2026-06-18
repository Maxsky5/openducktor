import type { RuntimeApprovalReplyOutcome } from "@openducktor/contracts";
import { useMemo } from "react";
import { matchesAgentSessionIdentity, toAgentSessionIdentity } from "@/lib/agent-session-identity";
import {
  hasAgentSessionPendingApprovals,
  hasAgentSessionPendingQuestions,
} from "@/lib/agent-session-waiting-input";
import type {
  AgentApprovalRequest,
  AgentQuestionRequest,
  AgentSessionIdentity,
  AgentSessionState,
} from "@/types/agent-orchestrator";
import { useAgentSessionApprovalActions } from "../use-agent-session-approval-actions";
import { useAgentSessionQuestionActions } from "../use-agent-session-question-actions";

const EMPTY_PENDING_APPROVALS: readonly AgentApprovalRequest[] = Object.freeze([]);
const EMPTY_PENDING_QUESTIONS: readonly AgentQuestionRequest[] = Object.freeze([]);

type UseRuntimeTranscriptInteractionsArgs = {
  liveSession: AgentSessionState | null;
  target: AgentSessionIdentity | null;
  isRuntimeReady: boolean;
  replyAgentApproval: (
    session: AgentSessionIdentity,
    requestId: string,
    outcome: RuntimeApprovalReplyOutcome,
  ) => Promise<void>;
  answerAgentQuestion: (
    session: AgentSessionIdentity,
    requestId: string,
    answers: string[][],
  ) => Promise<void>;
};

type RuntimeTranscriptInteractions = {
  pendingApprovalRequests: readonly AgentApprovalRequest[];
  pendingQuestionRequests: readonly AgentQuestionRequest[];
  pendingQuestions: {
    canSubmit: boolean;
    isSubmittingByRequestId: Record<string, boolean>;
    onSubmit: (requestId: string, answers: string[][]) => Promise<void>;
  };
  approvals: {
    canReply: boolean;
    isSubmittingByRequestId: Record<string, boolean>;
    errorByRequestId: Record<string, string>;
    onReply: (requestId: string, outcome: RuntimeApprovalReplyOutcome) => Promise<void>;
  };
};

export function useRuntimeTranscriptInteractions({
  liveSession,
  target,
  isRuntimeReady,
  replyAgentApproval,
  answerAgentQuestion,
}: UseRuntimeTranscriptInteractionsArgs): RuntimeTranscriptInteractions {
  const matchedLiveSession = matchesAgentSessionIdentity(liveSession, target) ? liveSession : null;
  const matchedSessionIdentity = matchedLiveSession
    ? toAgentSessionIdentity(matchedLiveSession)
    : null;
  const canReplyToRuntimeRequest = isRuntimeReady && matchedSessionIdentity !== null;
  const pendingApprovalRequests: readonly AgentApprovalRequest[] =
    matchedLiveSession?.pendingApprovals ?? EMPTY_PENDING_APPROVALS;
  const { isSubmittingApprovalByRequestId, approvalReplyErrorByRequestId, onReplyApproval } =
    useAgentSessionApprovalActions({
      sessionIdentity: matchedSessionIdentity,
      pendingApprovals: pendingApprovalRequests,
      canReplyToApprovals: isRuntimeReady,
      replyAgentApproval,
    });

  const pendingQuestionRequests: readonly AgentQuestionRequest[] =
    matchedLiveSession?.pendingQuestions ?? EMPTY_PENDING_QUESTIONS;
  const pendingQuestionRequestIds = useMemo(
    () => pendingQuestionRequests.map((request) => request.requestId),
    [pendingQuestionRequests],
  );
  const { isSubmittingQuestionByRequestId, onSubmitQuestionAnswers } =
    useAgentSessionQuestionActions({
      sessionIdentity: matchedSessionIdentity,
      pendingQuestionRequestIds,
      canAnswerQuestions: isRuntimeReady,
      answerAgentQuestion,
    });

  return {
    pendingApprovalRequests,
    pendingQuestionRequests,
    pendingQuestions: {
      canSubmit:
        canReplyToRuntimeRequest &&
        hasAgentSessionPendingQuestions({ pendingQuestions: pendingQuestionRequests }),
      isSubmittingByRequestId: isSubmittingQuestionByRequestId,
      onSubmit: onSubmitQuestionAnswers,
    },
    approvals: {
      canReply:
        canReplyToRuntimeRequest &&
        hasAgentSessionPendingApprovals({ pendingApprovals: pendingApprovalRequests }),
      isSubmittingByRequestId: isSubmittingApprovalByRequestId,
      errorByRequestId: approvalReplyErrorByRequestId,
      onReply: onReplyApproval,
    },
  };
}
