import { hasRuntimeType } from "@openducktor/contracts";
import { isRecord } from "./claude-agent-sdk-utils";

type ClaudeContextUsageFields = {
  usedTokens?: number;
  maxTokens?: number;
};

const positiveNumber = (value: unknown): number | undefined => {
  if (!hasRuntimeType(value, "number") || !Number.isFinite(value) || value <= 0) {
    return undefined;
  }
  return value;
};

export const contextUsageFromClaudeControlResponse = (
  response: unknown,
): ClaudeContextUsageFields => {
  if (!isRecord(response)) {
    return {};
  }
  const usedTokens = positiveNumber(response.totalTokens);
  const maxTokens = positiveNumber(response.maxTokens);
  return {
    ...(usedTokens !== undefined ? { usedTokens } : undefined),
    ...(maxTokens !== undefined ? { maxTokens } : undefined),
  };
};
