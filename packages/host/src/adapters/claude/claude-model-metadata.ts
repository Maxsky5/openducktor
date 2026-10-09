import type { ModelInfo } from "@anthropic-ai/claude-agent-sdk";

export const findClaudeModel = (
  models: ModelInfo[],
  modelId: string | undefined,
): ModelInfo | undefined => {
  if (modelId === undefined) return undefined;
  return models.find((model) => model.value === modelId || model.resolvedModel === modelId);
};
