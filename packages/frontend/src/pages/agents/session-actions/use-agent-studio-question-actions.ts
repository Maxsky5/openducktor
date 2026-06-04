import { useCallback, useMemo, useState } from "react";
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

  const isSubmittingQuestionByRequestId = useMemo(() => {
    if (!activeExternalSessionId) {
      return {};
    }

    const sessionRequests = submittingQuestionBySessionId[activeExternalSessionId] ?? {};
    const activeRequestIds = new Set(pendingQuestions.map((entry) => entry.requestId));
    return Object.fromEntries(
      Object.entries(sessionRequests).filter(([requestId]) => activeRequestIds.has(requestId)),
    );
  }, [activeExternalSessionId, pendingQuestions, submittingQuestionBySessionId]);

  return {
    isSubmittingQuestionByRequestId,
    onSubmitQuestionAnswers,
  };
}
