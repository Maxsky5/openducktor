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
  const [isSubmittingQuestionByRequestId, setIsSubmittingQuestionByRequestId] = useState<
    Record<string, boolean>
  >({});

  const onSubmitQuestionAnswers = useCallback(
    async (requestId: string, answers: string[][]): Promise<void> => {
      if (!activeExternalSessionId || !agentStudioReady) {
        return;
      }

      setIsSubmittingQuestionByRequestId((current) => ({
        ...current,
        [requestId]: true,
      }));
      try {
        await answerAgentQuestion(activeExternalSessionId, requestId, answers);
      } finally {
        setIsSubmittingQuestionByRequestId((current) => {
          if (!current[requestId]) {
            return current;
          }
          const next = { ...current };
          delete next[requestId];
          return next;
        });
      }
    },
    [activeExternalSessionId, agentStudioReady, answerAgentQuestion],
  );

  useEffect(() => {
    setIsSubmittingQuestionByRequestId((current) => {
      if (activeExternalSessionId === null && Object.keys(current).length === 0) {
        return current;
      }
      return {};
    });
  }, [activeExternalSessionId]);

  useEffect(() => {
    const activeRequestIds = new Set(pendingQuestions.map((entry) => entry.requestId));
    setIsSubmittingQuestionByRequestId((current) => {
      let changed = false;
      const next: Record<string, boolean> = {};
      for (const [requestId, isSubmitting] of Object.entries(current)) {
        if (!activeRequestIds.has(requestId)) {
          changed = true;
          continue;
        }
        next[requestId] = isSubmitting;
      }
      return changed ? next : current;
    });
  }, [pendingQuestions]);

  return { isSubmittingQuestionByRequestId, onSubmitQuestionAnswers };
}
