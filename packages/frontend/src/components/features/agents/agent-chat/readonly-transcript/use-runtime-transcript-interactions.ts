import type { RuntimeApprovalReplyOutcome } from "@openducktor/contracts";
import { useCallback, useReducer } from "react";
import type { AgentApprovalRequest, AgentQuestionRequest } from "@/types/agent-orchestrator";
import type { AgentChatThreadSession } from "../agent-chat.types";
import { useAgentSessionApprovalActions } from "../use-agent-session-approval-actions";
import type { RuntimeSessionTranscriptSource } from "./runtime-session-transcript-source";
import { getRuntimeTranscriptIdentityKey } from "./runtime-transcript-identity";

const EMPTY_PENDING_APPROVALS: readonly AgentApprovalRequest[] = Object.freeze([]);
const EMPTY_PENDING_QUESTIONS: readonly AgentQuestionRequest[] = Object.freeze([]);

type RuntimeTranscriptInteractionState = {
  transcriptIdentityKey: string | null;
  isSubmittingQuestionByRequestId: Record<string, boolean>;
};

type RuntimeTranscriptInteractionAction =
  | { type: "questionSubmitStarted"; requestId: string; transcriptIdentityKey: string | null }
  | { type: "questionSubmitFinished"; requestId: string; transcriptIdentityKey: string | null };

const createRuntimeTranscriptInteractionState = (
  transcriptIdentityKey: string | null,
): RuntimeTranscriptInteractionState => ({
  transcriptIdentityKey,
  isSubmittingQuestionByRequestId: {},
});

const getRuntimeTranscriptInteractionStateForIdentity = (
  state: RuntimeTranscriptInteractionState,
  transcriptIdentityKey: string | null,
): RuntimeTranscriptInteractionState => {
  if (state.transcriptIdentityKey === transcriptIdentityKey) {
    return state;
  }

  return createRuntimeTranscriptInteractionState(transcriptIdentityKey);
};

const runtimeTranscriptInteractionReducer = (
  state: RuntimeTranscriptInteractionState,
  action: RuntimeTranscriptInteractionAction,
): RuntimeTranscriptInteractionState => {
  const currentState = getRuntimeTranscriptInteractionStateForIdentity(
    state,
    action.transcriptIdentityKey,
  );

  switch (action.type) {
    case "questionSubmitStarted":
      return {
        ...currentState,
        isSubmittingQuestionByRequestId: {
          ...currentState.isSubmittingQuestionByRequestId,
          [action.requestId]: true,
        },
      };
    case "questionSubmitFinished": {
      const isSubmittingQuestionByRequestId = { ...currentState.isSubmittingQuestionByRequestId };
      delete isSubmittingQuestionByRequestId[action.requestId];
      return { ...currentState, isSubmittingQuestionByRequestId };
    }
  }
};

type UseRuntimeTranscriptInteractionsArgs = {
  session: AgentChatThreadSession | null;
  source: RuntimeSessionTranscriptSource | null;
  externalSessionId: string | null;
  isRuntimeReady: boolean;
  replyAgentApproval: (
    externalSessionId: string,
    requestId: string,
    outcome: RuntimeApprovalReplyOutcome,
  ) => Promise<void>;
  answerAgentQuestion: (
    externalSessionId: string,
    requestId: string,
    answers: string[][],
  ) => Promise<void>;
};

type RuntimeTranscriptInteractions = {
  session: AgentChatThreadSession | null;
  visiblePendingApprovals: readonly AgentApprovalRequest[];
  visiblePendingQuestions: readonly AgentQuestionRequest[];
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
  source,
  externalSessionId,
  isRuntimeReady,
  replyAgentApproval,
  answerAgentQuestion,
}: UseRuntimeTranscriptInteractionsArgs): RuntimeTranscriptInteractions {
  const transcriptIdentityKey = getRuntimeTranscriptIdentityKey({ externalSessionId, source });
  const [interactionState, dispatchInteractionState] = useReducer(
    runtimeTranscriptInteractionReducer,
    transcriptIdentityKey,
    createRuntimeTranscriptInteractionState,
  );
  const currentInteractionState = getRuntimeTranscriptInteractionStateForIdentity(
    interactionState,
    transcriptIdentityKey,
  );
  const { isSubmittingQuestionByRequestId } = currentInteractionState;
  const visiblePendingApprovals = session?.pendingApprovals ?? EMPTY_PENDING_APPROVALS;
  const visiblePendingQuestions = session?.pendingQuestions ?? EMPTY_PENDING_QUESTIONS;
  const activeSessionId = session?.externalSessionId ?? null;
  const sessionMatchesTranscript =
    activeSessionId !== null && activeSessionId === externalSessionId;
  const canReplyToRuntimeRequest = isRuntimeReady && sessionMatchesTranscript;
  const pendingApprovalRequests: readonly AgentApprovalRequest[] =
    session?.pendingApprovals ?? EMPTY_PENDING_APPROVALS;
  const replyTranscriptApproval = useCallback(
    async (
      targetExternalSessionId: string,
      requestId: string,
      outcome: RuntimeApprovalReplyOutcome,
    ): Promise<void> => {
      if (!targetExternalSessionId) {
        throw new Error("Runtime transcript approval target is unavailable.");
      }
      await replyAgentApproval(targetExternalSessionId, requestId, outcome);
    },
    [replyAgentApproval],
  );
  const { isSubmittingApprovalByRequestId, approvalReplyErrorByRequestId, onReplyApproval } =
    useAgentSessionApprovalActions({
      activeExternalSessionId: sessionMatchesTranscript ? activeSessionId : null,
      pendingApprovals: pendingApprovalRequests,
      agentStudioReady: isRuntimeReady,
      replyAgentApproval: replyTranscriptApproval,
    });

  const pendingQuestionRequests: readonly AgentQuestionRequest[] =
    session?.pendingQuestions ?? EMPTY_PENDING_QUESTIONS;
  const replyTranscriptQuestion = useCallback(
    async (requestId: string, answers: string[][]): Promise<void> => {
      if (!activeSessionId || !sessionMatchesTranscript) {
        throw new Error("Runtime transcript question target is unavailable.");
      }
      dispatchInteractionState({
        type: "questionSubmitStarted",
        requestId,
        transcriptIdentityKey,
      });
      try {
        await answerAgentQuestion(activeSessionId, requestId, answers);
      } finally {
        dispatchInteractionState({
          type: "questionSubmitFinished",
          requestId,
          transcriptIdentityKey,
        });
      }
    },
    [activeSessionId, answerAgentQuestion, sessionMatchesTranscript, transcriptIdentityKey],
  );

  return {
    session,
    visiblePendingApprovals,
    visiblePendingQuestions,
    pendingQuestions: {
      canSubmit: canReplyToRuntimeRequest && pendingQuestionRequests.length > 0,
      isSubmittingByRequestId: isSubmittingQuestionByRequestId,
      onSubmit: replyTranscriptQuestion,
    },
    approvals: {
      canReply: canReplyToRuntimeRequest && pendingApprovalRequests.length > 0,
      isSubmittingByRequestId: isSubmittingApprovalByRequestId,
      errorByRequestId: approvalReplyErrorByRequestId,
      onReply: onReplyApproval,
    },
  };
}
