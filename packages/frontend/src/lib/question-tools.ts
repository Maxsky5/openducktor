const normalizeQuestionToolName = (toolName: string): string => toolName.trim().toLowerCase();

export const isQuestionToolName = (toolName: string): boolean => {
  const normalized = normalizeQuestionToolName(toolName);
  return normalized === "question" || normalized.endsWith("_question");
};
