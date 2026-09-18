import { pendingInputIdentity } from "@/lib/pending-input-identity";
import type { AgentQuestionRequest } from "@/types/agent-orchestrator";

type AgentQuestion = AgentQuestionRequest["questions"][number];

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

export const buildQuestionContentEntries = (
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

export const buildQuestionCardKey = (
  externalSessionId: string,
  request: AgentQuestionRequest,
): string => `${externalSessionId}:${pendingInputIdentity(request)}`;
