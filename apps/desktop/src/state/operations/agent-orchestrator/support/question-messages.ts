import type { AgentChatMessage, AgentQuestionRequest } from "@/types/agent-orchestrator";

type AnsweredQuestion = AgentQuestionRequest["questions"][number] & {
  answers: string[];
};

export const annotateQuestionToolMessage = (
  messages: AgentChatMessage[],
  requestId: string,
  answeredQuestionsWithAnswers: AnsweredQuestion[],
  answers: string[][],
): AgentChatMessage[] => {
  const nextMessages = [...messages];
  for (let index = nextMessages.length - 1; index >= 0; index -= 1) {
    const message = nextMessages[index];
    if (!message || message.role !== "tool" || message.meta?.kind !== "tool") {
      continue;
    }

    const toolName = message.meta.tool.toLowerCase();
    const isQuestionTool =
      toolName === "question" || toolName.endsWith("_question") || toolName.includes("question");
    if (!isQuestionTool) {
      continue;
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
    if (metadataRequestId && metadataRequestId !== requestId) {
      continue;
    }

    nextMessages[index] = {
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
    break;
  }

  return nextMessages;
};
