import type { AgentAsyncQuestion } from "@openducktor/contracts";
import type { AgentQuestionRequest } from "@/types/agent-orchestrator";

const ASYNC_REQUEST_PREFIX = "async:";

const toAsyncQuestionRequest = (
  sourceMessageId: string,
  questions: readonly AgentAsyncQuestion[],
): AgentQuestionRequest => ({
  requestId: `${ASYNC_REQUEST_PREFIX}${sourceMessageId}`,
  asyncQuestionItemIds: questions.map((question) => question.questionItemId),
  questions: questions.map((question) => ({
    header: "",
    question: question.title,
    options: (question.options ?? []).map((option) => ({ label: option, description: "" })),
  })),
});

export const toAgentQuestionRequests = (
  questions: readonly AgentQuestionRequest[],
  asyncQuestions: readonly AgentAsyncQuestion[],
): readonly AgentQuestionRequest[] => {
  if (asyncQuestions.length === 0) {
    return questions;
  }

  const asyncByMessage = new Map<string, AgentAsyncQuestion[]>();
  for (const question of asyncQuestions) {
    const messageQuestions = asyncByMessage.get(question.sourceMessageId) ?? [];
    messageQuestions.push(question);
    asyncByMessage.set(question.sourceMessageId, messageQuestions);
  }

  return [
    ...questions,
    ...[...asyncByMessage].map(([sourceMessageId, messageQuestions]) =>
      toAsyncQuestionRequest(
        sourceMessageId,
        messageQuestions.toSorted((left, right) => left.questionIndex - right.questionIndex),
      ),
    ),
  ];
};
