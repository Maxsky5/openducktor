import type { AgentQuestionRequest } from "@/types/agent-orchestrator";

type AgentQuestion = AgentQuestionRequest["questions"][number];

type AgentQuestionRenderEntry = {
  question: AgentQuestion;
  key: string;
};

const buildQuestionBaseKey = (requestId: string, question: AgentQuestion): string => {
  const optionsKey = question.options
    .map((option) => `${option.label}:${option.description}`)
    .join("|");
  const headerKey = question.header.trim();
  const promptKey = question.question.trim();

  return [
    requestId,
    headerKey,
    promptKey,
    optionsKey,
    question.multiple ? "multiple" : "single",
    question.custom ? "custom" : "default",
  ].join(":");
};

export const buildQuestionRenderEntries = (
  requestId: string,
  questions: AgentQuestionRequest["questions"],
): AgentQuestionRenderEntry[] => {
  const countsByBaseKey = new Map<string, number>();

  return questions.map((question) => {
    const baseKey = buildQuestionBaseKey(requestId, question);
    const nextCount = (countsByBaseKey.get(baseKey) ?? 0) + 1;
    countsByBaseKey.set(baseKey, nextCount);

    return {
      question,
      key: `${baseKey}:${nextCount}`,
    };
  });
};
