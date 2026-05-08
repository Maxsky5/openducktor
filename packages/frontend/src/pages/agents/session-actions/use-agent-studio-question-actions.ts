import { useCallback, useEffect, useState } from "react";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import type { AgentStateContextValue } from "@/types/state-slices";

type UseAgentStudioQuestionActionsArgs = {
  activeExternalSessionId: string | null;
  agentStudioReady: boolean;
  pendingQuestions: AgentSessionState["pendingQuestions"];
  answerAgentQuestion: AgentStateContextValue["answerAgentQuestion"];
};

export function useAgentStudioQuestionActions({
  activeExternalSessionId,
  agentStudioReady,
  pendingQuestions,
  answerAgentQuestion,
}: UseAgentStudioQuestionActionsArgs): {
  isSubmittingQuestionByRequestId: Record<string, boolean>;
  onSubmitQuestionAnswers: (requestId: string, answers: string[][]) => Promise<void>;
} {
  const [submittingQuestionBySessionId, setSubmittingQuestionBySessionId] = useState<
    Record<string, Record<string, boolean>>
  >({});

  const onSubmitQuestionAnswers = useCallback(
    async (requestId: string, answers: string[][]): Promise<void> => {
      if (!activeExternalSessionId || !agentStudioReady) {
        return;
      }
      const sessionId = activeExternalSessionId;

      setSubmittingQuestionBySessionId((current) => ({
        ...current,
        [sessionId]: {
          ...(current[sessionId] ?? {}),
          [requestId]: true,
        },
      }));
      try {
        await answerAgentQuestion(sessionId, requestId, answers);
      } finally {
        setSubmittingQuestionBySessionId((current) => {
          const sessionRequests = current[sessionId];
          if (!sessionRequests?.[requestId]) {
            return current;
          }
          const nextSessionRequests = { ...sessionRequests };
          delete nextSessionRequests[requestId];
          const next = { ...current };
          if (Object.keys(nextSessionRequests).length === 0) {
            delete next[sessionId];
          } else {
            next[sessionId] = nextSessionRequests;
          }
          return next;
        });
      }
    },
    [activeExternalSessionId, agentStudioReady, answerAgentQuestion],
  );

  useEffect(() => {
    if (!activeExternalSessionId) {
      return;
    }
    const activeRequestIds = new Set(pendingQuestions.map((entry) => entry.requestId));
    setSubmittingQuestionBySessionId((current) => {
      const sessionRequests = current[activeExternalSessionId];
      if (!sessionRequests) {
        return current;
      }
      let changed = false;
      const next: Record<string, boolean> = {};
      for (const [requestId, isSubmitting] of Object.entries(sessionRequests)) {
        if (!activeRequestIds.has(requestId)) {
          changed = true;
          continue;
        }
        next[requestId] = isSubmitting;
      }
      if (!changed) {
        return current;
      }
      const nextBySession = { ...current };
      if (Object.keys(next).length === 0) {
        delete nextBySession[activeExternalSessionId];
      } else {
        nextBySession[activeExternalSessionId] = next;
      }
      return nextBySession;
    });
  }, [activeExternalSessionId, pendingQuestions]);

  return {
    isSubmittingQuestionByRequestId: activeExternalSessionId
      ? (submittingQuestionBySessionId[activeExternalSessionId] ?? {})
      : {},
    onSubmitQuestionAnswers,
  };
}
