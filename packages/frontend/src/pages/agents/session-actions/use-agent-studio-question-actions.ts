import { useCallback, useMemo, useState } from "react";
import { agentSessionIdentityKey } from "@/lib/agent-session-identity";
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
  const [submittingQuestionBySessionKey, setSubmittingQuestionBySessionKey] = useState<
    Record<string, Record<string, boolean>>
  >({});

  const onSubmitQuestionAnswers = useCallback(
    async (requestId: string, answers: string[][]): Promise<void> => {
      if (!activeSession || !agentStudioReady) {
        return;
      }
      const sessionKey = agentSessionIdentityKey(activeSession);

      setSubmittingQuestionBySessionKey((current) => ({
        ...current,
        [sessionKey]: {
          ...(current[sessionKey] ?? {}),
          [requestId]: true,
        },
      }));
      try {
        await answerAgentQuestion(activeSession, requestId, answers);
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
    [activeSession, agentStudioReady, answerAgentQuestion],
  );

  const isSubmittingQuestionByRequestId = useMemo(() => {
    if (!activeSession) {
      return {};
    }

    const sessionRequests =
      submittingQuestionBySessionKey[agentSessionIdentityKey(activeSession)] ?? {};
    const activeRequestIds = new Set(pendingQuestions.map((entry) => entry.requestId));
    return Object.fromEntries(
      Object.entries(sessionRequests).filter(([requestId]) => activeRequestIds.has(requestId)),
    );
  }, [activeSession, pendingQuestions, submittingQuestionBySessionKey]);

  return {
    isSubmittingQuestionByRequestId,
    onSubmitQuestionAnswers,
  };
}
