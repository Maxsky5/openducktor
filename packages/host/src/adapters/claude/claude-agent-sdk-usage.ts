import type { SDKControlGetContextUsageResponse } from "@anthropic-ai/claude-agent-sdk";

type ClaudeContextUsageFields = {
  usedTokens?: number;
  maxTokens?: number;
};

const positiveNumber = (value: number): number | undefined => {
  if (!Number.isFinite(value) || value <= 0) {
    return undefined;
  }
  return value;
};

export const contextUsageFromClaudeControlResponse = (
  response: Pick<SDKControlGetContextUsageResponse, "maxTokens" | "totalTokens">,
): ClaudeContextUsageFields => {
  const usedTokens = positiveNumber(response.totalTokens);
  const maxTokens = positiveNumber(response.maxTokens);
  const usage: ClaudeContextUsageFields = {};
  if (usedTokens !== undefined) {
    usage.usedTokens = usedTokens;
  }
  if (maxTokens !== undefined) {
    usage.maxTokens = maxTokens;
  }
  return usage;
};
