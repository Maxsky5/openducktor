import type { AgentModelCatalog } from "@openducktor/core";
import {
  getSessionMessageAt,
  getSessionMessageCount,
  type SessionMessageOwner,
} from "@/state/operations/agent-orchestrator/support/messages";
import type { AgentSessionContextUsage } from "@/types/agent-orchestrator";

export type AgentStudioContextUsage = {
  totalTokens: number;
  contextWindow: number;
  outputLimit?: number;
} | null;

type ResolvedContextUsageParts = {
  contextWindow: number;
  outputLimit?: number;
};

type CatalogModelDescriptor = AgentModelCatalog["models"][number];

const toModelDescriptorKey = (providerId: string, modelId: string): string => {
  return `${providerId}::${modelId}`;
};

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

const extractFallbackSessionContextUsage = ({
  session,
  modelDescriptorByKey,
  fallbackContextWindow,
  fallbackOutputLimit,
}: {
  session: SessionMessageOwner | null | undefined;
  modelDescriptorByKey: ReadonlyMap<string, CatalogModelDescriptor>;
  fallbackContextWindow: number | undefined;
  fallbackOutputLimit: number | undefined;
}): AgentStudioContextUsage => {
  if (!session) {
    return null;
  }

  return extractLatestSessionContextUsageFromHistory({
    session,
    modelDescriptorByKey,
    ...(fallbackContextWindow !== undefined ? { fallbackContextWindow } : {}),
    ...(fallbackOutputLimit !== undefined ? { fallbackOutputLimit } : {}),
  });
};

const resolveLiveContextUsageParts = ({
  liveContextUsage,
  modelDescriptor,
  fallbackUsage,
  fallbackContextWindow,
  fallbackOutputLimit,
}: {
  liveContextUsage: AgentSessionContextUsage;
  modelDescriptor: CatalogModelDescriptor | undefined;
  fallbackUsage: AgentStudioContextUsage;
  fallbackContextWindow: number | undefined;
  fallbackOutputLimit: number | undefined;
}): ResolvedContextUsageParts | null => {
  const contextWindow = pickPositiveNumber(
    liveContextUsage.contextWindow,
    modelDescriptor?.contextWindow,
    fallbackContextWindow,
    fallbackUsage?.contextWindow,
  );
  if (contextWindow === undefined) {
    return null;
  }

  const outputLimit = pickPositiveNumber(
    liveContextUsage.outputLimit,
    modelDescriptor?.outputLimit,
    fallbackOutputLimit,
    fallbackUsage?.outputLimit,
  );

  if (outputLimit === undefined) {
    return { contextWindow };
  }

  return {
    contextWindow,
    outputLimit,
  };
};

export const extractLatestSessionContextUsage = ({
  session,
  liveContextUsage,
  modelDescriptorByKey,
  fallbackContextWindow,
  fallbackOutputLimit,
}: {
  session: SessionMessageOwner | null | undefined;
  liveContextUsage?: AgentSessionContextUsage | null;
  modelDescriptorByKey: ReadonlyMap<string, CatalogModelDescriptor>;
  fallbackContextWindow?: number;
  fallbackOutputLimit?: number;
}): AgentStudioContextUsage => {
  let fallbackUsage: AgentStudioContextUsage | undefined;
  const getFallbackUsage = (): AgentStudioContextUsage => {
    if (fallbackUsage !== undefined) {
      return fallbackUsage;
    }

    fallbackUsage = extractFallbackSessionContextUsage({
      session,
      modelDescriptorByKey,
      fallbackContextWindow,
      fallbackOutputLimit,
    });
    return fallbackUsage;
  };

  if (liveContextUsage && liveContextUsage.totalTokens > 0) {
    const modelDescriptor = resolveContextUsageDescriptor({
      liveContextUsage,
      modelDescriptorByKey,
    });
    const needsHistoryFallback =
      pickPositiveNumber(
        liveContextUsage.contextWindow,
        modelDescriptor?.contextWindow,
        fallbackContextWindow,
      ) === undefined ||
      pickPositiveNumber(
        liveContextUsage.outputLimit,
        modelDescriptor?.outputLimit,
        fallbackOutputLimit,
      ) === undefined;
    const historyFallbackUsage = needsHistoryFallback ? getFallbackUsage() : null;
    const resolvedParts = resolveLiveContextUsageParts({
      liveContextUsage,
      modelDescriptor,
      fallbackUsage: historyFallbackUsage,
      fallbackContextWindow,
      fallbackOutputLimit,
    });
    if (resolvedParts) {
      const usage: NonNullable<AgentStudioContextUsage> = {
        totalTokens: liveContextUsage.totalTokens,
        contextWindow: resolvedParts.contextWindow,
      };
      if (typeof resolvedParts.outputLimit === "number") {
        usage.outputLimit = resolvedParts.outputLimit;
      }
      return usage;
    }
  }

  return getFallbackUsage();
};

const extractLatestSessionContextUsageFromHistory = ({
  session,
  modelDescriptorByKey,
  fallbackContextWindow,
  fallbackOutputLimit,
}: {
  session: SessionMessageOwner | null | undefined;
  modelDescriptorByKey: ReadonlyMap<string, CatalogModelDescriptor>;
  fallbackContextWindow?: number;
  fallbackOutputLimit?: number;
}): AgentStudioContextUsage => {
  if (!session) {
    return null;
  }

  const lastIndex = getSessionMessageCount(session) - 1;
  for (let index = lastIndex; index >= 0; index -= 1) {
    const message = getSessionMessageAt(session, index);
    if (message?.meta?.kind !== "assistant") {
      continue;
    }

    const totalTokens = message.meta.totalTokens;
    if (typeof totalTokens !== "number" || totalTokens <= 0) {
      continue;
    }

    const metaProviderId = message.meta.providerId;
    const metaModelId = message.meta.modelId;
    const modelDescriptor =
      typeof metaProviderId === "string" && typeof metaModelId === "string"
        ? modelDescriptorByKey.get(toModelDescriptorKey(metaProviderId, metaModelId))
        : undefined;
    const contextWindow =
      message.meta.contextWindow ?? modelDescriptor?.contextWindow ?? fallbackContextWindow;
    if (typeof contextWindow !== "number" || contextWindow <= 0) {
      continue;
    }
    const outputLimit =
      message.meta.outputLimit ?? modelDescriptor?.outputLimit ?? fallbackOutputLimit;

    return {
      totalTokens,
      contextWindow,
      ...(typeof outputLimit === "number" ? { outputLimit } : {}),
    };
  }

  return null;
};
