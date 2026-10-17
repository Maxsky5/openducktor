import type { AgentModelCatalog } from "@openducktor/core";
import { findTurnCatalogModel } from "@/lib/model-catalog-selection";
import type { AgentSessionContextUsage } from "@/types/agent-orchestrator";

export type AgentStudioContextUsage = {
  totalTokens: number;
  contextWindow: number;
  outputLimit?: number;
} | null;

const pickPositiveNumber = (...values: Array<number | undefined>): number | undefined => {
  for (const value of values) {
    if (value !== undefined && value > 0) {
      return value;
    }
  }
  return undefined;
};

export type ExtractLatestSessionContextUsageInput = {
  liveContextUsage?: AgentSessionContextUsage | null;
  catalog: AgentModelCatalog | null;
  fallbackContextWindow?: number;
  fallbackOutputLimit?: number;
};

export const extractLatestSessionContextUsage = ({
  liveContextUsage,
  catalog,
  fallbackContextWindow,
  fallbackOutputLimit,
}: ExtractLatestSessionContextUsageInput): AgentStudioContextUsage => {
  if (!liveContextUsage || liveContextUsage.totalTokens <= 0) {
    return null;
  }

  const { providerId, modelId } = liveContextUsage;
  const modelDescriptor =
    catalog && providerId && modelId
      ? findTurnCatalogModel(catalog, { providerId, modelId })
      : null;
  const contextWindow = pickPositiveNumber(
    liveContextUsage.contextWindow,
    modelDescriptor?.contextWindow,
    fallbackContextWindow,
  );
  if (contextWindow === undefined) {
    return null;
  }
  const outputLimit = pickPositiveNumber(
    liveContextUsage.outputLimit,
    modelDescriptor?.outputLimit,
    fallbackOutputLimit,
  );

  const contextUsage: NonNullable<AgentStudioContextUsage> = {
    totalTokens: liveContextUsage.totalTokens,
    contextWindow,
  };
  if (outputLimit !== undefined) {
    contextUsage.outputLimit = outputLimit;
  }
  return contextUsage;
};
