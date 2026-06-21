import type { RuntimeApprovalReplyOutcome } from "@openducktor/contracts";
import {
  hasAgentSessionPendingApprovals,
  hasAgentSessionPendingQuestions,
} from "@/lib/agent-session-waiting-input";
import type {
  AgentApprovalRequest,
  AgentQuestionRequest,
  AgentSessionIdentity,
} from "@/types/agent-orchestrator";
import type { AgentOperationsContextValue } from "@/types/state-slices";
import { useAgentSessionApprovalActions } from "../use-agent-session-approval-actions";
import { useAgentSessionQuestionActions } from "../use-agent-session-question-actions";

type UseRuntimeTranscriptInteractionsArgs = {
  target: AgentSessionIdentity | null;
  pendingApprovalRequests: readonly AgentApprovalRequest[];
  pendingQuestionRequests: readonly AgentQuestionRequest[];
  isRuntimeReady: boolean;
  replyAgentApproval: AgentOperationsContextValue["replyAgentApproval"];
  answerAgentQuestion: AgentOperationsContextValue["answerAgentQuestion"];
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
  target,
  pendingApprovalRequests,
  pendingQuestionRequests,
  isRuntimeReady,
  replyAgentApproval,
  answerAgentQuestion,
}: UseRuntimeTranscriptInteractionsArgs): RuntimeTranscriptInteractions {
  const canReplyToRuntimeRequest = isRuntimeReady && target !== null;
  const { isSubmittingApprovalByRequestId, approvalReplyErrorByRequestId, onReplyApproval } =
    useAgentSessionApprovalActions({
      sessionIdentity: target,
      pendingApprovals: pendingApprovalRequests,
      canReplyToApprovals: isRuntimeReady,
      replyAgentApproval,
    });

  const { isSubmittingQuestionByRequestId, onSubmitQuestionAnswers } =
    useAgentSessionQuestionActions({
      sessionIdentity: target,
      pendingQuestions: pendingQuestionRequests,
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
