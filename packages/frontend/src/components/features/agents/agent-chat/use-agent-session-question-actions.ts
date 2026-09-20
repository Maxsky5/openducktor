import type { AgentSessionScope, AgentUserMessagePart } from "@openducktor/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { agentSessionIdentityKey, toAgentSessionIdentity } from "@/lib/agent-session-identity";
import type { AgentQuestionRequest, AgentSessionIdentity } from "@/types/agent-orchestrator";
import type { AgentOperationsContextValue } from "@/types/state-slices";
import {
  type AgentSessionRequestState,
  removeAgentSessionRequestValue,
  selectPendingAgentSessionRequestValues,
  setAgentSessionRequestValue,
} from "./agent-session-request-state";

type UseAgentSessionQuestionActionsArgs = {
  sessionIdentity: AgentSessionIdentity | null;
  pendingQuestions: readonly AgentQuestionRequest[];
  canAnswerQuestions: boolean;
  answerAgentQuestion: AgentOperationsContextValue["answerAgentQuestion"];
  sendAgentMessage: AgentOperationsContextValue["sendAgentMessage"];
  sessionScope?: AgentSessionScope | null | undefined;
};

const toAsyncQuestionReplyParts = (
  request: AgentQuestionRequest,
  answers: string[][],
): AgentUserMessagePart[] | null => {
  const questionItemIds = request.asyncQuestionItemIds;
  if (!questionItemIds) {
    return null;
  }
  if (questionItemIds.length !== request.questions.length) {
    throw new Error("The pending question data is incomplete. Reload the session and try again.");
  }

  return request.questions.map((question, index) => {
    const answer = answers[index]?.[0]?.trim() ?? "";
    const questionItemId = questionItemIds[index];
    if (!questionItemId || answer.length === 0) {
      throw new Error("Answer each question before you submit.");
    }
    return {
      kind: "async_question_reply",
      questionItemId,
      question: question.question,
      answer,
    };
  });
};

export function useAgentSessionQuestionActions({
  sessionIdentity,
  pendingQuestions,
  canAnswerQuestions,
  answerAgentQuestion,
  sendAgentMessage,
  sessionScope,
}: UseAgentSessionQuestionActionsArgs) {
  const [submittingQuestionBySessionKey, setSubmittingQuestionBySessionKey] = useState<
    AgentSessionRequestState<boolean>
  >({});
  const sessionExternalSessionId = sessionIdentity?.externalSessionId ?? null;
  const sessionRuntimeKind = sessionIdentity?.runtimeKind ?? null;
  const sessionWorkingDirectory = sessionIdentity?.workingDirectory ?? null;
  const sessionKey = sessionIdentity ? agentSessionIdentityKey(sessionIdentity) : null;
  const pendingQuestionRequestIds = useMemo(
    () => pendingQuestions.map((request) => request.requestId),
    [pendingQuestions],
  );
  const pendingQuestionByRequestId = useMemo(
    () => new Map(pendingQuestions.map((request) => [request.requestId, request])),
    [pendingQuestions],
  );
  const pendingQuestionByRequestIdRef = useRef(pendingQuestionByRequestId);
  useEffect(() => {
    pendingQuestionByRequestIdRef.current = pendingQuestionByRequestId;
  }, [pendingQuestionByRequestId]);

  const onSubmitQuestionAnswers = useCallback(
    async (requestId: string, answers: string[][]): Promise<void> => {
      if (
        !sessionKey ||
        sessionExternalSessionId === null ||
        sessionRuntimeKind === null ||
        sessionWorkingDirectory === null ||
        !canAnswerQuestions
      ) {
        return;
      }
      const sessionActionTarget = toAgentSessionIdentity({
        externalSessionId: sessionExternalSessionId,
        runtimeKind: sessionRuntimeKind,
        workingDirectory: sessionWorkingDirectory,
      });
      const request = pendingQuestionByRequestIdRef.current.get(requestId);
      if (!request) {
        return;
      }

      setSubmittingQuestionBySessionKey((current) =>
        setAgentSessionRequestValue(current, sessionKey, requestId, true),
      );
      try {
        const replyParts = toAsyncQuestionReplyParts(request, answers);
        if (replyParts) {
          await sendAgentMessage(
            sessionActionTarget,
            replyParts,
            sessionScope ? { sessionScope } : undefined,
          );
        } else {
          await answerAgentQuestion(sessionActionTarget, request, answers);
        }
      } finally {
        setSubmittingQuestionBySessionKey((current) =>
          removeAgentSessionRequestValue(current, sessionKey, requestId),
        );
      }
    },
    [
      answerAgentQuestion,
      canAnswerQuestions,
      sendAgentMessage,
      sessionExternalSessionId,
      sessionKey,
      sessionRuntimeKind,
      sessionScope,
      sessionWorkingDirectory,
    ],
  );

  const isSubmittingQuestionByRequestId = useMemo(() => {
    if (!sessionKey) {
      return {};
    }

    return selectPendingAgentSessionRequestValues(
      submittingQuestionBySessionKey,
      sessionKey,
      pendingQuestionRequestIds,
    );
  }, [pendingQuestionRequestIds, sessionKey, submittingQuestionBySessionKey]);

  return {
    isSubmittingQuestionByRequestId,
    onSubmitQuestionAnswers,
  } satisfies {
    isSubmittingQuestionByRequestId: Record<string, boolean>;
    onSubmitQuestionAnswers: (requestId: string, answers: string[][]) => Promise<void>;
  };
}
