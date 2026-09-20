import type { AgentAsyncQuestion, RuntimeApprovalReplyOutcome } from "@openducktor/contracts";
import type { AgentSessionScope } from "@openducktor/core";
import { useMemo } from "react";
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
import { toAgentQuestionRequests } from "@/lib/agent-question-requests";

type UseRuntimeTranscriptInteractionsArgs = {
  target: AgentSessionIdentity | null;
  pendingApprovalRequests: readonly AgentApprovalRequest[];
  pendingQuestionRequests: readonly AgentQuestionRequest[];
  pendingAsyncQuestions: readonly AgentAsyncQuestion[];
  isRuntimeReady: boolean;
  replyAgentApproval: AgentOperationsContextValue["replyAgentApproval"];
  answerAgentQuestion: AgentOperationsContextValue["answerAgentQuestion"];
  sendAgentMessage: AgentOperationsContextValue["sendAgentMessage"];
  sessionScope?: AgentSessionScope | null | undefined;
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
  pendingAsyncQuestions,
  isRuntimeReady,
  replyAgentApproval,
  answerAgentQuestion,
  sendAgentMessage,
  sessionScope,
}: UseRuntimeTranscriptInteractionsArgs): RuntimeTranscriptInteractions {
  const canReplyToRuntimeRequest = isRuntimeReady && target !== null;
  const { isSubmittingApprovalByRequestId, approvalReplyErrorByRequestId, onReplyApproval } =
    useAgentSessionApprovalActions({
      sessionIdentity: target,
      pendingApprovals: pendingApprovalRequests,
      canReplyToApprovals: isRuntimeReady,
      replyAgentApproval,
    });

  const questionRequests = useMemo(
    () => toAgentQuestionRequests(pendingQuestionRequests, pendingAsyncQuestions),
    [pendingAsyncQuestions, pendingQuestionRequests],
  );
  const { isSubmittingQuestionByRequestId, onSubmitQuestionAnswers } =
    useAgentSessionQuestionActions({
      sessionIdentity: target,
      pendingQuestions: questionRequests,
      canAnswerQuestions: isRuntimeReady,
      answerAgentQuestion,
      sendAgentMessage,
      sessionScope,
    });

  return {
    pendingApprovalRequests,
    pendingQuestionRequests: questionRequests,
    pendingQuestions: {
      canSubmit:
        canReplyToRuntimeRequest &&
        hasAgentSessionPendingQuestions({ pendingQuestions: questionRequests }),
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
