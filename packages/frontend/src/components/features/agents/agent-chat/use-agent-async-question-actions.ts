import type { AgentAsyncQuestion } from "@openducktor/contracts";
import { useCallback, useMemo, useState } from "react";
import type { AgentSessionIdentity } from "@/types/agent-orchestrator";
import type { AgentOperationsContextValue } from "@/types/state-slices";

export type AgentAsyncQuestionActions = {
  canSubmit: boolean;
  isSubmittingByQuestionId: Record<string, boolean>;
  errorByQuestionId: Record<string, string>;
  onSubmit: (question: AgentAsyncQuestion, answer: string) => Promise<void>;
};

export const useAgentAsyncQuestionActions = ({
  sessionIdentity,
  canSubmit,
  sendAgentMessage,
}: {
  sessionIdentity: AgentSessionIdentity | null;
  canSubmit: boolean;
  sendAgentMessage: AgentOperationsContextValue["sendAgentMessage"];
}): AgentAsyncQuestionActions => {
  const [isSubmittingByQuestionId, setSubmitting] = useState<Record<string, boolean>>({});
  const [errorByQuestionId, setErrors] = useState<Record<string, string>>({});

  const onSubmit = useCallback(
    async (question: AgentAsyncQuestion, answer: string): Promise<void> => {
      const acceptedAnswer = answer.trim();
      if (!sessionIdentity || !canSubmit) {
        throw new Error("This Codex session cannot accept an answer now.");
      }
      if (acceptedAnswer.length === 0) {
        throw new Error("Enter an answer before you send it.");
      }
      setSubmitting((current) => ({ ...current, [question.questionItemId]: true }));
      setErrors((current) => ({ ...current, [question.questionItemId]: "" }));
      try {
        await sendAgentMessage(sessionIdentity, [
          {
            kind: "async_question_reply",
            questionItemId: question.questionItemId,
            question: question.title,
            answer: acceptedAnswer,
          },
        ]);
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause);
        setErrors((current) => ({
          ...current,
          [question.questionItemId]: `${message} Retry, or answer through the main chat composer.`,
        }));
        throw cause;
      } finally {
        setSubmitting((current) => ({ ...current, [question.questionItemId]: false }));
      }
    },
    [canSubmit, sendAgentMessage, sessionIdentity],
  );

  return useMemo(
    () => ({ canSubmit, isSubmittingByQuestionId, errorByQuestionId, onSubmit }),
    [canSubmit, errorByQuestionId, isSubmittingByQuestionId, onSubmit],
  );
};
