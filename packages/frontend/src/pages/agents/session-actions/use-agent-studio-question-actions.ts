import { useCallback, useMemo, useState } from "react";
import { agentSessionIdentityKey } from "@/lib/agent-session-identity";
import type { AgentSessionIdentity } from "@/types/agent-orchestrator";
import type { AgentOperationsContextValue } from "@/types/state-slices";

type UseAgentStudioQuestionActionsArgs = {
  sessionIdentity: AgentSessionIdentity | null;
  pendingQuestionRequestIds: readonly string[];
  agentStudioReady: boolean;
  answerAgentQuestion: AgentOperationsContextValue["answerAgentQuestion"];
};

export function useAgentStudioQuestionActions({
  sessionIdentity,
  pendingQuestionRequestIds,
  agentStudioReady,
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
      if (!sessionIdentity || !agentStudioReady) {
        return;
      }
      const sessionKey = agentSessionIdentityKey(sessionIdentity);

      setSubmittingQuestionBySessionKey((current) => ({
        ...current,
        [sessionKey]: {
          ...(current[sessionKey] ?? {}),
          [requestId]: true,
        },
      }));
      try {
        await answerAgentQuestion(sessionIdentity, requestId, answers);
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
    [agentStudioReady, answerAgentQuestion, sessionIdentity],
  );

  const isSubmittingQuestionByRequestId = useMemo(() => {
    if (!sessionIdentity) {
      return {};
    }

    const sessionRequests =
      submittingQuestionBySessionKey[agentSessionIdentityKey(sessionIdentity)] ?? {};
    const activeRequestIds = new Set(pendingQuestionRequestIds);
    return Object.fromEntries(
      Object.entries(sessionRequests).filter(([requestId]) => activeRequestIds.has(requestId)),
    );
  }, [pendingQuestionRequestIds, sessionIdentity, submittingQuestionBySessionKey]);

  return {
    isSubmittingQuestionByRequestId,
    onSubmitQuestionAnswers,
  };
}
