import { claudeUnknownRecordSchema } from "./claude-agent-sdk-utils";

type ClaudeContextUsageFields = {
  usedTokens?: number;
  maxTokens?: number;
};

const positiveNumber = (value: unknown): number | undefined => {
  if (!(typeof value === "number") || !Number.isFinite(value) || value <= 0) {
    return undefined;
  }
  return value;
};

export const contextUsageFromClaudeControlResponse = (
  response: unknown,
): ClaudeContextUsageFields => {
  const parsed = claudeUnknownRecordSchema.safeParse(response);
  if (!parsed.success) {
    return {};
  }
  const usedTokens = positiveNumber(parsed.data.totalTokens);
  const maxTokens = positiveNumber(parsed.data.maxTokens);
  return {
    ...(usedTokens !== undefined ? { usedTokens } : undefined),
    ...(maxTokens !== undefined ? { maxTokens } : undefined),
  };
};
