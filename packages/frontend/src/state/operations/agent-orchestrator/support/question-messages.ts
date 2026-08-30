import type { AgentToolData } from "@openducktor/contracts";
import { z } from "zod";
import { isQuestionToolName } from "@/lib/question-tools";
import type { AgentQuestionRequest, AgentSessionState } from "@/types/agent-orchestrator";
import { type SessionMessageOwner, updateLastToolSessionMessage } from "./messages";

type AnsweredQuestion = AgentQuestionRequest["questions"][number] & {
  answers: string[];
};

const stringValueSchema = z.string();
const readMetadataRequestId = (metadata: AgentToolData): string | null => {
  for (const key of ["requestId", "requestID", "questionRequestId"]) {
    const result = stringValueSchema.safeParse(metadata[key]);
    if (result.success) {
      return result.data;
    }
  }
  return null;
};

export const annotateQuestionToolMessage = (
  session: SessionMessageOwner,
  requestId: string,
  answeredQuestionsWithAnswers: AnsweredQuestion[],
  answers: string[][],
): AgentSessionState["messages"] => {
  return updateLastToolSessionMessage(
    session,
    (message) => {
      if (message.meta?.kind !== "tool" || !isQuestionToolName(message.meta.tool)) {
        return false;
      }

      const metadata = message.meta.metadata ?? {};
      const metadataRequestId = readMetadataRequestId(metadata);
      return !metadataRequestId || metadataRequestId === requestId;
    },
    (message) => {
      if (message.meta?.kind !== "tool") {
        return message;
      }

      const metadata = message.meta.metadata ?? {};
      return {
        ...message,
        meta: {
          ...message.meta,
          metadata: {
            ...metadata,
            requestId,
            questions: answeredQuestionsWithAnswers,
            answers,
          },
        },
      };
    },
  );
};

export const applyQuestionAnswerToSession = (
  session: AgentSessionState,
  requestId: string,
  answers: string[][],
): Pick<AgentSessionState, "pendingQuestions" | "messages"> => {
  const answeredRequest = session.pendingQuestions.find((entry) => entry.requestId === requestId);
  const pendingQuestions = session.pendingQuestions.filter(
    (entry) => entry.requestId !== requestId,
  );
  if (!answeredRequest || answeredRequest.questions.length === 0) {
    return {
      pendingQuestions,
      messages: session.messages,
    };
  }

  const answeredQuestionsWithAnswers = answeredRequest.questions.map((question, index) => ({
    ...question,
    answers: answers[index] ?? [],
  }));
  return {
    pendingQuestions,
    messages: annotateQuestionToolMessage(
      session,
      requestId,
      answeredQuestionsWithAnswers,
      answers,
    ),
  };
};
