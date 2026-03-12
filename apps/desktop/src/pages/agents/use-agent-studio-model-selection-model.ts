import type { AgentModelCatalog, AgentModelSelection, AgentRole } from "@openducktor/core";
import { DEFAULT_RUNTIME_KIND } from "@/lib/agent-runtime";
import type { AgentChatMessage, AgentSessionContextUsage } from "@/types/agent-orchestrator";
import type { RepoSettingsInput } from "@/types/state-slices";
import { normalizeSelectionForCatalog, pickDefaultSelectionForCatalog } from "./agents-page-utils";

export type AgentStudioContextUsage = {
  totalTokens: number;
  contextWindow: number;
  outputLimit?: number;
} | null;

type CatalogModelDescriptor = AgentModelCatalog["models"][number];

export const toRoleDefaultSelection = (
  roleDefault: RepoSettingsInput["agentDefaults"][AgentRole] | null | undefined,
): AgentModelSelection | null => {
  if (!roleDefault || !roleDefault.providerId || !roleDefault.modelId) {
    return null;
  }
  return {
    runtimeKind: roleDefault.runtimeKind ?? DEFAULT_RUNTIME_KIND,
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
    primarySelection ?? secondarySelection ?? pickDefaultSelectionForCatalog(catalog);
  return (
    normalizeSelectionForCatalog(catalog, preferredBase) ?? pickDefaultSelectionForCatalog(catalog)
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

export const toModelDescriptorKey = (providerId: string, modelId: string): string => {
  return `${providerId}::${modelId}`;
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

export const extractLatestContextUsage = ({
  messages,
  liveContextUsage,
  modelDescriptorByKey,
  fallbackContextWindow,
}: {
  messages: AgentChatMessage[] | null | undefined;
  liveContextUsage?: AgentSessionContextUsage | null;
  modelDescriptorByKey: ReadonlyMap<string, CatalogModelDescriptor>;
  fallbackContextWindow?: number;
}): AgentStudioContextUsage => {
  if (liveContextUsage && liveContextUsage.totalTokens > 0) {
    const contextWindow = liveContextUsage.contextWindow ?? fallbackContextWindow;
    if (typeof contextWindow === "number" && contextWindow > 0) {
      return {
        totalTokens: liveContextUsage.totalTokens,
        contextWindow,
        ...(typeof liveContextUsage.outputLimit === "number"
          ? { outputLimit: liveContextUsage.outputLimit }
          : {}),
      };
    }
  }

  if (!messages) {
    return null;
  }

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message || message.role !== "assistant" || message.meta?.kind !== "assistant") {
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
    const outputLimit = message.meta.outputLimit ?? modelDescriptor?.outputLimit;

    return {
      totalTokens,
      contextWindow,
      ...(typeof outputLimit === "number" ? { outputLimit } : {}),
    };
  }

  return null;
};
