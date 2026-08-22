import { hasRuntimeType } from "@openducktor/contracts";
import { isRecord } from "./claude-agent-sdk-utils";
import type { JsonValue } from "@openducktor/contracts";

type ClaudeContextUsageFields = {
  usedTokens?: number;
  maxTokens?: number;
};

const positiveNumber = (value: JsonValue | undefined): number | undefined => {
  if (!hasRuntimeType(value, "number") || !Number.isFinite(value) || value <= 0) {
    return undefined;
  }
  return value;
};

export const contextUsageFromClaudeControlResponse = (
  response: JsonValue | undefined,
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
