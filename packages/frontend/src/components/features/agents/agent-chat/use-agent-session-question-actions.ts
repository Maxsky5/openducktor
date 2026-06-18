import { useCallback, useMemo, useState } from "react";
import { agentSessionIdentityKey, toAgentSessionIdentity } from "@/lib/agent-session-identity";
import type { AgentSessionIdentity } from "@/types/agent-orchestrator";
import type { AgentOperationsContextValue } from "@/types/state-slices";

type UseAgentSessionQuestionActionsArgs = {
  sessionIdentity: AgentSessionIdentity | null;
  pendingQuestionRequestIds: readonly string[];
  canAnswerQuestions: boolean;
  answerAgentQuestion: AgentOperationsContextValue["answerAgentQuestion"];
};

export function useAgentSessionQuestionActions({
  sessionIdentity,
  pendingQuestionRequestIds,
  canAnswerQuestions,
  answerAgentQuestion,
}: UseAgentSessionQuestionActionsArgs): {
  isSubmittingQuestionByRequestId: Record<string, boolean>;
  onSubmitQuestionAnswers: (requestId: string, answers: string[][]) => Promise<void>;
} {
  const [submittingQuestionBySessionKey, setSubmittingQuestionBySessionKey] = useState<
    Record<string, Record<string, boolean>>
  >({});
  const sessionExternalSessionId = sessionIdentity?.externalSessionId ?? null;
  const sessionRuntimeKind = sessionIdentity?.runtimeKind ?? null;
  const sessionWorkingDirectory = sessionIdentity?.workingDirectory ?? null;
  const sessionKey = sessionIdentity ? agentSessionIdentityKey(sessionIdentity) : null;

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

      setSubmittingQuestionBySessionKey((current) => ({
        ...current,
        [sessionKey]: {
          ...(current[sessionKey] ?? {}),
          [requestId]: true,
        },
      }));
      try {
        await answerAgentQuestion(sessionActionTarget, requestId, answers);
      } finally {
        setSubmittingQuestionBySessionKey((current) => {
          const sessionRequests = current[sessionKey];
          if (!sessionRequests?.[requestId]) {
            return current;
          }
          const nextSessionRequests = { ...sessionRequests };
          delete nextSessionRequests[requestId];
          const next = { ...current };
          if (Object.keys(nextSessionRequests).length === 0) {
            delete next[sessionKey];
          } else {
            next[sessionKey] = nextSessionRequests;
          }
          return next;
        });
      }
    },
    [
      answerAgentQuestion,
      canAnswerQuestions,
      sessionExternalSessionId,
      sessionKey,
      sessionRuntimeKind,
      sessionWorkingDirectory,
    ],
  );

  const isSubmittingQuestionByRequestId = useMemo(() => {
    if (!sessionKey) {
      return {};
    }

    const sessionRequests = submittingQuestionBySessionKey[sessionKey] ?? {};
    const activeRequestIds = new Set(pendingQuestionRequestIds);
    return Object.fromEntries(
      Object.entries(sessionRequests).filter(([requestId]) => activeRequestIds.has(requestId)),
    );
  }, [pendingQuestionRequestIds, sessionKey, submittingQuestionBySessionKey]);

  return {
    isSubmittingQuestionByRequestId,
    onSubmitQuestionAnswers,
  };
}
