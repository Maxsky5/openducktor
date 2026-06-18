import { useCallback, useMemo, useState } from "react";
import { agentSessionIdentityKey, toAgentSessionIdentity } from "@/lib/agent-session-identity";
import type { AgentSessionIdentity } from "@/types/agent-orchestrator";
import type { AgentOperationsContextValue } from "@/types/state-slices";
import {
  type AgentSessionRequestState,
  removeAgentSessionRequestValue,
  selectPendingAgentSessionRequestValues,
  setAgentSessionRequestValue,
} from "./agent-session-request-state";

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
    AgentSessionRequestState<boolean>
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

      setSubmittingQuestionBySessionKey((current) =>
        setAgentSessionRequestValue(current, sessionKey, requestId, true),
      );
      try {
        await answerAgentQuestion(sessionActionTarget, requestId, answers);
      } finally {
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
  };
}
