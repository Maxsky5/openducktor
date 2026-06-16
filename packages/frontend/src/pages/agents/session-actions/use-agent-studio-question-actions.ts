import { useCallback, useMemo, useState } from "react";
import { agentSessionIdentityKey, toAgentSessionIdentity } from "@/lib/agent-session-identity";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import type { AgentStateContextValue } from "@/types/state-slices";

type AgentStudioQuestionSession = Pick<
  AgentSessionState,
  "externalSessionId" | "runtimeKind" | "workingDirectory" | "pendingQuestions"
>;

type UseAgentStudioQuestionActionsArgs = {
  activeSession: AgentStudioQuestionSession | null;
  agentStudioReady: boolean;
  answerAgentQuestion: AgentStateContextValue["answerAgentQuestion"];
};

export function useAgentStudioQuestionActions({
  activeSession,
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
      if (!activeSession || !agentStudioReady) {
        return;
      }
      const sessionIdentity = toAgentSessionIdentity(activeSession);
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
    [activeSession, agentStudioReady, answerAgentQuestion],
  );

  const isSubmittingQuestionByRequestId = useMemo(() => {
    if (!activeSession) {
      return {};
    }

    const sessionRequests =
      submittingQuestionBySessionKey[agentSessionIdentityKey(activeSession)] ?? {};
    const activeRequestIds = new Set(
      activeSession.pendingQuestions.map((entry) => entry.requestId),
    );
    return Object.fromEntries(
      Object.entries(sessionRequests).filter(([requestId]) => activeRequestIds.has(requestId)),
    );
  }, [activeSession, submittingQuestionBySessionKey]);

  return {
    isSubmittingQuestionByRequestId,
    onSubmitQuestionAnswers,
  };
}
