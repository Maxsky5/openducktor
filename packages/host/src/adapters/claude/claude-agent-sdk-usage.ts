import { isUnknownRecord } from "@openducktor/core";

type ClaudeContextUsageFields = {
  usedTokens?: number;
  maxTokens?: number;
};

const positiveNumber = (value: unknown): number | undefined => {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return undefined;
  }
  return value;
};

export const contextUsageFromClaudeControlResponse = (
  response: unknown,
): ClaudeContextUsageFields => {
  if (!isUnknownRecord(response)) {
    return {};
  }
  const usedTokens = positiveNumber(response.totalTokens);
  const maxTokens = positiveNumber(response.maxTokens);
  return {
    ...(usedTokens !== undefined ? { usedTokens } : undefined),
    ...(maxTokens !== undefined ? { maxTokens } : undefined),
  };
};
