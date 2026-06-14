import { useCallback, useMemo, useState } from "react";
import type { AgentSessionIdentity, AgentSessionState } from "@/types/agent-orchestrator";
import type { AgentStateContextValue } from "@/types/state-slices";

type UseAgentStudioQuestionActionsArgs = {
  activeSession: AgentSessionIdentity | null;
  agentStudioReady: boolean;
  pendingQuestions: AgentSessionState["pendingQuestions"];
  answerAgentQuestion: AgentStateContextValue["answerAgentQuestion"];
};

export function useAgentStudioQuestionActions({
  activeSession,
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
      if (!activeSession || !agentStudioReady) {
        return;
      }
      const sessionId = activeSession.externalSessionId;

      setSubmittingQuestionBySessionId((current) => ({
        ...current,
        [sessionId]: {
          ...(current[sessionId] ?? {}),
          [requestId]: true,
        },
      }));
      try {
        await answerAgentQuestion(activeSession, requestId, answers);
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
    [activeSession, agentStudioReady, answerAgentQuestion],
  );

  const isSubmittingQuestionByRequestId = useMemo(() => {
    if (!activeSession) {
      return {};
    }

    const sessionRequests = submittingQuestionBySessionId[activeSession.externalSessionId] ?? {};
    const activeRequestIds = new Set(pendingQuestions.map((entry) => entry.requestId));
    return Object.fromEntries(
      Object.entries(sessionRequests).filter(([requestId]) => activeRequestIds.has(requestId)),
    );
  }, [activeSession, pendingQuestions, submittingQuestionBySessionId]);

  return {
    isSubmittingQuestionByRequestId,
    onSubmitQuestionAnswers,
  };
}
