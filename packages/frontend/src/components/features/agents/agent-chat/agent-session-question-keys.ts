import type { AgentQuestionRequest } from "@/types/agent-orchestrator";

type AgentQuestion = AgentQuestionRequest["questions"][number];

type AgentQuestionRenderEntry = {
  question: AgentQuestion;
  key: string;
};

type AgentQuestionContentEntry = {
  question: AgentQuestion;
  contentKey: string;
};

const buildQuestionBaseKey = (question: AgentQuestion): string => {
  const optionsKey = question.options
    .map((option) => `${option.label}:${option.description}`)
    .join("|");
  const headerKey = question.header.trim();
  const promptKey = question.question.trim();

  return [
    headerKey,
    promptKey,
    optionsKey,
    question.multiple ? "multiple" : "single",
    question.custom ? "custom" : "default",
  ].join(":");
};

const buildQuestionContentEntries = (
  questions: AgentQuestionRequest["questions"],
): AgentQuestionContentEntry[] => {
  const countsByBaseKey = new Map<string, number>();

  return questions.map((question) => {
    const baseKey = buildQuestionBaseKey(question);
    const nextCount = (countsByBaseKey.get(baseKey) ?? 0) + 1;
    countsByBaseKey.set(baseKey, nextCount);

    return {
      question,
      contentKey: `${baseKey}:${nextCount}`,
    };
  });
};

export const buildQuestionRenderEntries = (
  requestId: string,
  questions: AgentQuestionRequest["questions"],
): AgentQuestionRenderEntry[] =>
  buildQuestionContentEntries(questions).map(({ question, contentKey }) => ({
    question,
    key: `${requestId}:${contentKey}`,
  }));

export const buildQuestionDraftKey = (request: AgentQuestionRequest): string => {
  const origin = request.source ? `subagent:${request.source.childExternalSessionId}` : "direct";
  const contentKeys = buildQuestionContentEntries(request.questions).map(
    ({ contentKey }) => contentKey,
  );
  return `${origin}::${contentKeys.join("::")}`;
};
