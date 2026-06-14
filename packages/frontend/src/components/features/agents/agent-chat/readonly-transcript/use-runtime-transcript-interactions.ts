import type { RuntimeApprovalReplyOutcome } from "@openducktor/contracts";
import { useCallback, useReducer } from "react";
import type { AgentApprovalRequest, AgentQuestionRequest } from "@/types/agent-orchestrator";
import type { AgentChatThreadSession } from "../agent-chat.types";
import { useAgentSessionApprovalActions } from "../use-agent-session-approval-actions";
import {
  matchesRuntimeSessionTranscriptTarget,
  type RuntimeSessionTranscriptTarget,
  runtimeSessionTranscriptTargetKey,
} from "./runtime-session-transcript-target";

const EMPTY_PENDING_APPROVALS: readonly AgentApprovalRequest[] = Object.freeze([]);
const EMPTY_PENDING_QUESTIONS: readonly AgentQuestionRequest[] = Object.freeze([]);

type RuntimeTranscriptInteractionState = {
  sessionKey: string | null;
  isSubmittingQuestionByRequestId: Record<string, boolean>;
};

type RuntimeTranscriptInteractionAction =
  | { type: "questionSubmitStarted"; requestId: string; sessionKey: string | null }
  | { type: "questionSubmitFinished"; requestId: string; sessionKey: string | null };

const createRuntimeTranscriptInteractionState = (
  sessionKey: string | null,
): RuntimeTranscriptInteractionState => ({
  sessionKey,
  isSubmittingQuestionByRequestId: {},
});

const getRuntimeTranscriptInteractionStateForSession = (
  state: RuntimeTranscriptInteractionState,
  sessionKey: string | null,
): RuntimeTranscriptInteractionState => {
  if (state.sessionKey === sessionKey) {
    return state;
  }

  return createRuntimeTranscriptInteractionState(sessionKey);
};

const runtimeTranscriptInteractionReducer = (
  state: RuntimeTranscriptInteractionState,
  action: RuntimeTranscriptInteractionAction,
): RuntimeTranscriptInteractionState => {
  const currentState = getRuntimeTranscriptInteractionStateForSession(state, action.sessionKey);

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

const getRuntimeTranscriptInteractionSessionKey = (
  session: AgentChatThreadSession | null,
  target: RuntimeSessionTranscriptTarget | null,
): string | null => {
  if (session) {
    return runtimeSessionTranscriptTargetKey(session);
  }

  if (!target) {
    return null;
  }

  return runtimeSessionTranscriptTargetKey(target);
};

type UseRuntimeTranscriptInteractionsArgs = {
  session: AgentChatThreadSession | null;
  target: RuntimeSessionTranscriptTarget | null;
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
  const sessionKey = getRuntimeTranscriptInteractionSessionKey(session, target);
  const [interactionState, dispatchInteractionState] = useReducer(
    runtimeTranscriptInteractionReducer,
    sessionKey,
    createRuntimeTranscriptInteractionState,
  );
  const currentInteractionState = getRuntimeTranscriptInteractionStateForSession(
    interactionState,
    sessionKey,
  );
  const { isSubmittingQuestionByRequestId } = currentInteractionState;
  const matchedExternalSessionId = matchesRuntimeSessionTranscriptTarget(session, target)
    ? session.externalSessionId
    : null;
  const canReplyToRuntimeRequest = isRuntimeReady && matchedExternalSessionId !== null;
  const pendingApprovalRequests: readonly AgentApprovalRequest[] =
    session?.pendingApprovals ?? EMPTY_PENDING_APPROVALS;
  const { isSubmittingApprovalByRequestId, approvalReplyErrorByRequestId, onReplyApproval } =
    useAgentSessionApprovalActions({
      activeExternalSessionId: matchedExternalSessionId,
      pendingApprovals: pendingApprovalRequests,
      agentStudioReady: isRuntimeReady,
      replyAgentApproval,
    });

  const pendingQuestionRequests: readonly AgentQuestionRequest[] =
    session?.pendingQuestions ?? EMPTY_PENDING_QUESTIONS;
  const replyTranscriptQuestion = useCallback(
    async (requestId: string, answers: string[][]): Promise<void> => {
      if (!matchedExternalSessionId) {
        throw new Error("Runtime transcript question target is unavailable.");
      }
      dispatchInteractionState({
        type: "questionSubmitStarted",
        requestId,
        sessionKey,
      });
      try {
        await answerAgentQuestion(matchedExternalSessionId, requestId, answers);
      } finally {
        dispatchInteractionState({
          type: "questionSubmitFinished",
          requestId,
          sessionKey,
        });
      }
    },
    [answerAgentQuestion, matchedExternalSessionId, sessionKey],
  );

  return {
    session,
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
