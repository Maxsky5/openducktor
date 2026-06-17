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
} from "@/types/agent-orchestrator";
import type { AgentChatThreadSession } from "../agent-chat.types";
import { useAgentSessionApprovalActions } from "../use-agent-session-approval-actions";
import { useAgentSessionQuestionActions } from "../use-agent-session-question-actions";

const EMPTY_PENDING_APPROVALS: readonly AgentApprovalRequest[] = Object.freeze([]);
const EMPTY_PENDING_QUESTIONS: readonly AgentQuestionRequest[] = Object.freeze([]);

type UseRuntimeTranscriptInteractionsArgs = {
  session: AgentChatThreadSession | null;
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
  session: AgentChatThreadSession | null;
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
  session,
  target,
  isRuntimeReady,
  replyAgentApproval,
  answerAgentQuestion,
}: UseRuntimeTranscriptInteractionsArgs): RuntimeTranscriptInteractions {
  const matchedSessionIdentity = matchesAgentSessionIdentity(session, target)
    ? toAgentSessionIdentity(session)
    : null;
  const canReplyToRuntimeRequest = isRuntimeReady && matchedSessionIdentity !== null;
  const pendingApprovalRequests: readonly AgentApprovalRequest[] =
    session?.pendingApprovals ?? EMPTY_PENDING_APPROVALS;
  const { isSubmittingApprovalByRequestId, approvalReplyErrorByRequestId, onReplyApproval } =
    useAgentSessionApprovalActions({
      sessionIdentity: matchedSessionIdentity,
      pendingApprovals: pendingApprovalRequests,
      canReplyToApprovals: isRuntimeReady,
      replyAgentApproval,
    });

  const pendingQuestionRequests: readonly AgentQuestionRequest[] =
    session?.pendingQuestions ?? EMPTY_PENDING_QUESTIONS;
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
    session,
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
