import { isQuestionToolName } from "@/lib/question-tools";
import type { AgentQuestionRequest, AgentSessionState } from "@/types/agent-orchestrator";
import { type SessionMessageOwner, updateLastToolSessionMessage } from "./messages";

type AnsweredQuestion = AgentQuestionRequest["questions"][number] & {
  answers: string[];
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
      const metadataRequestId =
        typeof metadata.requestId === "string"
          ? metadata.requestId
          : typeof metadata.requestID === "string"
            ? metadata.requestID
            : typeof metadata.questionRequestId === "string"
              ? metadata.questionRequestId
              : null;
      return !metadataRequestId || metadataRequestId === requestId;
    },
    (message) => {
      const metadata = message.meta?.kind === "tool" ? (message.meta.metadata ?? {}) : {};
      return {
        ...message,
        meta: {
          ...(message.meta ?? {
            kind: "tool" as const,
            partId: "",
            callId: "",
            tool: "",
            status: "completed" as const,
          }),
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
