import type { AgentSessionScope } from "@openducktor/core";
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
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
  sessionScope?: AgentSessionScope | null | undefined;
};

export function useAgentSessionQuestionActions({
  sessionIdentity,
  pendingQuestions,
  canAnswerQuestions,
  answerAgentQuestion,
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
  useLayoutEffect(() => {
    pendingQuestionByRequestIdRef.current = pendingQuestionByRequestId;
  }, [pendingQuestionByRequestId]);
  const submittingQuestionKeysRef = useRef(new Set<string>());

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
      const submitKey = `${sessionKey}\u0000${requestId}`;
      if (submittingQuestionKeysRef.current.has(submitKey)) {
        return;
      }
      submittingQuestionKeysRef.current.add(submitKey);

      setSubmittingQuestionBySessionKey((current) =>
        setAgentSessionRequestValue(current, sessionKey, requestId, true),
      );
      try {
        await answerAgentQuestion(sessionActionTarget, request, answers, sessionScope ?? undefined);
      } finally {
        submittingQuestionKeysRef.current.delete(submitKey);
        setSubmittingQuestionBySessionKey((current) =>
          removeAgentSessionRequestValue(current, sessionKey, requestId),
        );
      }
    },
    [
      answerAgentQuestion,
      canAnswerQuestions,
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
