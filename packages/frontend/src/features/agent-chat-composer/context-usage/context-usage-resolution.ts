import type { AgentModelCatalog } from "@openducktor/core";
import type { AgentSessionContextUsage } from "@/types/agent-orchestrator";

export type AgentStudioContextUsage = {
  totalTokens: number;
  contextWindow: number;
  outputLimit?: number;
} | null;

type CatalogModelDescriptor = AgentModelCatalog["models"][number];

const toModelDescriptorKey = (providerId: string, modelId: string): string =>
  `${providerId}::${modelId}`;

const resolveContextUsageDescriptor = ({
  liveContextUsage,
  modelDescriptorByKey,
}: {
  liveContextUsage: AgentSessionContextUsage;
  modelDescriptorByKey: ReadonlyMap<string, CatalogModelDescriptor>;
}): CatalogModelDescriptor | undefined => {
  if (!liveContextUsage.providerId || !liveContextUsage.modelId) {
    return undefined;
  }
  return modelDescriptorByKey.get(
    toModelDescriptorKey(liveContextUsage.providerId, liveContextUsage.modelId),
  );
};

export const indexModelDescriptorsByProviderAndModel = (
  catalog: AgentModelCatalog | null,
): Map<string, CatalogModelDescriptor> => {
  const map = new Map<string, CatalogModelDescriptor>();
  if (!catalog) {
    return map;
  }
  for (const descriptor of catalog.models) {
    map.set(toModelDescriptorKey(descriptor.providerId, descriptor.modelId), descriptor);
  }
  return map;
};

const pickPositiveNumber = (...values: Array<number | undefined>): number | undefined => {
  for (const value of values) {
    if (typeof value === "number" && value > 0) {
      return value;
    }
  }
  return undefined;
};

export const extractLatestSessionContextUsage = ({
  liveContextUsage,
  modelDescriptorByKey,
  fallbackContextWindow,
  fallbackOutputLimit,
}: {
  liveContextUsage?: AgentSessionContextUsage | null;
  modelDescriptorByKey: ReadonlyMap<string, CatalogModelDescriptor>;
  fallbackContextWindow?: number;
  fallbackOutputLimit?: number;
}): AgentStudioContextUsage => {
  if (!liveContextUsage || liveContextUsage.totalTokens <= 0) {
    return null;
  }

  const modelDescriptor = resolveContextUsageDescriptor({
    liveContextUsage,
    modelDescriptorByKey,
  });
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

  return {
    totalTokens: liveContextUsage.totalTokens,
    contextWindow,
    ...(outputLimit === undefined ? {} : { outputLimit }),
  };
};
