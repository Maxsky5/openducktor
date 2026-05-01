import type { AgentModelCatalog, AgentModelSelection, AgentRole } from "@openducktor/core";
import {
  getSessionMessageAt,
  getSessionMessageCount,
  type SessionMessageOwner,
} from "@/state/operations/agent-orchestrator/support/messages";
import type { AgentSessionContextUsage } from "@/types/agent-orchestrator";
import type { RepoSettingsInput } from "@/types/state-slices";
import {
  coerceVisibleSelectionToCatalog,
  pickDefaultVisibleSelectionForCatalog,
} from "./agents-page-selection";

export type AgentStudioContextUsage = {
  totalTokens: number;
  contextWindow: number;
  outputLimit?: number;
} | null;

export type AgentStudioContextUsageEntry = {
  usage: NonNullable<AgentStudioContextUsage>;
  sourceIndex: number;
} | null;

type ResolvedContextUsageParts = {
  contextWindow: number;
  outputLimit?: number;
};

type CatalogModelDescriptor = AgentModelCatalog["models"][number];

export const toRoleDefaultSelection = (
  roleDefault: RepoSettingsInput["agentDefaults"][AgentRole] | null | undefined,
  repoDefaultRuntimeKind?: RepoSettingsInput["defaultRuntimeKind"] | null,
): AgentModelSelection | null => {
  if (!roleDefault?.providerId || !roleDefault.modelId) {
    return null;
  }
  const runtimeKind = roleDefault.runtimeKind ?? repoDefaultRuntimeKind;
  if (!runtimeKind) {
    return null;
  }
  return {
    runtimeKind,
    providerId: roleDefault.providerId,
    modelId: roleDefault.modelId,
    ...(roleDefault.variant ? { variant: roleDefault.variant } : {}),
    ...(roleDefault.profileId ? { profileId: roleDefault.profileId } : {}),
  };
};

const resolvePreferredSelectionForCatalog = ({
  catalog,
  primarySelection,
  secondarySelection,
}: {
  catalog: AgentModelCatalog | null;
  primarySelection: AgentModelSelection | null;
  secondarySelection: AgentModelSelection | null;
}): AgentModelSelection | null => {
  const preferredBase =
    primarySelection ?? secondarySelection ?? pickDefaultVisibleSelectionForCatalog(catalog);
  return (
    coerceVisibleSelectionToCatalog(catalog, preferredBase) ??
    pickDefaultVisibleSelectionForCatalog(catalog)
  );
};

export const resolveDraftSelection = ({
  catalog,
  existingSelection,
  roleDefaultSelection,
}: {
  catalog: AgentModelCatalog | null;
  existingSelection: AgentModelSelection | null;
  roleDefaultSelection: AgentModelSelection | null;
}): AgentModelSelection | null => {
  return resolvePreferredSelectionForCatalog({
    catalog,
    primarySelection: existingSelection,
    secondarySelection: roleDefaultSelection,
  });
};

export const resolveSessionSelection = ({
  catalog,
  selectedModel,
  roleDefaultSelection,
}: {
  catalog: AgentModelCatalog | null;
  selectedModel: AgentModelSelection | null;
  roleDefaultSelection: AgentModelSelection | null;
}): AgentModelSelection | null => {
  return resolvePreferredSelectionForCatalog({
    catalog,
    primarySelection: selectedModel,
    secondarySelection: roleDefaultSelection,
  });
};

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

export const toModelDescriptorByKey = (
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

const extractFallbackContextUsageEntry = ({
  session,
  modelDescriptorByKey,
  fallbackContextWindow,
  fallbackOutputLimit,
}: {
  session: SessionMessageOwner | null | undefined;
  modelDescriptorByKey: ReadonlyMap<string, CatalogModelDescriptor>;
  fallbackContextWindow: number | undefined;
  fallbackOutputLimit: number | undefined;
}): AgentStudioContextUsageEntry => {
  if (!session) {
    return null;
  }

  return extractLatestContextUsageEntry({
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

export const extractLatestContextUsage = ({
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
  let fallbackUsageEntry: AgentStudioContextUsageEntry | undefined;
  const getFallbackUsageEntry = (): AgentStudioContextUsageEntry => {
    if (fallbackUsageEntry !== undefined) {
      return fallbackUsageEntry;
    }

    fallbackUsageEntry = extractFallbackContextUsageEntry({
      session,
      modelDescriptorByKey,
      fallbackContextWindow,
      fallbackOutputLimit,
    });
    return fallbackUsageEntry;
  };

  if (liveContextUsage && liveContextUsage.totalTokens > 0) {
    const modelDescriptor = resolveContextUsageDescriptor({
      liveContextUsage,
      modelDescriptorByKey,
    });
    let fallbackUsage: AgentStudioContextUsage = null;
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
    if (needsHistoryFallback) {
      fallbackUsage = getFallbackUsageEntry()?.usage ?? null;
    }
    const resolvedParts = resolveLiveContextUsageParts({
      liveContextUsage,
      modelDescriptor,
      fallbackUsage,
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

  return getFallbackUsageEntry()?.usage ?? null;
};

export const extractLatestContextUsageEntry = ({
  session,
  modelDescriptorByKey,
  fallbackContextWindow,
  fallbackOutputLimit,
  startIndex = 0,
  endIndex,
}: {
  session: SessionMessageOwner | null | undefined;
  modelDescriptorByKey: ReadonlyMap<string, CatalogModelDescriptor>;
  fallbackContextWindow?: number;
  fallbackOutputLimit?: number;
  startIndex?: number;
  endIndex?: number;
}): AgentStudioContextUsageEntry => {
  if (!session) {
    return null;
  }

  const lastIndex = getSessionMessageCount(session) - 1;
  const scanEndIndex = Math.min(typeof endIndex === "number" ? endIndex : lastIndex, lastIndex);
  if (scanEndIndex < startIndex) {
    return null;
  }

  for (let index = scanEndIndex; index >= startIndex; index -= 1) {
    const message = getSessionMessageAt(session, index);
    if (!message || message.meta?.kind !== "assistant") {
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
      usage: {
        totalTokens,
        contextWindow,
        ...(typeof outputLimit === "number" ? { outputLimit } : {}),
      },
      sourceIndex: index,
    };
  }

  return null;
};
