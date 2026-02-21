import type { AgentSessionRecord } from "@openducktor/contracts";
import type { AgentModelCatalog, AgentModelSelection } from "@openducktor/core";

export const pickDefaultModel = (catalog: AgentModelCatalog): AgentModelSelection | null => {
  if (catalog.models.length === 0) {
    return null;
  }

  for (const model of catalog.models) {
    const providerDefault = catalog.defaultModelsByProvider[model.providerId];
    if (providerDefault && providerDefault === model.modelId) {
      return {
        providerId: model.providerId,
        modelId: model.modelId,
        ...(model.variants[0] ? { variant: model.variants[0] } : {}),
      };
    }
  }

  const first = catalog.models[0];
  if (!first) {
    return null;
  }

  return {
    providerId: first.providerId,
    modelId: first.modelId,
    ...(first.variants[0] ? { variant: first.variants[0] } : {}),
  };
};

export const normalizeSelectionForCatalog = (
  catalog: AgentModelCatalog,
  selection: AgentModelSelection | null,
): AgentModelSelection | null => {
  if (!selection) {
    return null;
  }

  const model = catalog.models.find(
    (entry) => entry.providerId === selection.providerId && entry.modelId === selection.modelId,
  );
  if (!model) {
    return null;
  }

  const hasVariant = Boolean(selection.variant && model.variants.includes(selection.variant));
  const hasAgent = Boolean(
    selection.opencodeAgent &&
      catalog.agents.some((agent) => agent.name === selection.opencodeAgent),
  );

  return {
    providerId: model.providerId,
    modelId: model.modelId,
    ...(hasVariant
      ? { variant: selection.variant }
      : model.variants[0]
        ? { variant: model.variants[0] }
        : {}),
    ...(hasAgent ? { opencodeAgent: selection.opencodeAgent } : {}),
  };
};

export const normalizePersistedSelection = (
  selection: AgentSessionRecord["selectedModel"] | undefined,
): AgentModelSelection | null => {
  if (!selection) {
    return null;
  }
  return {
    providerId: selection.providerId,
    modelId: selection.modelId,
    ...(selection.variant ? { variant: selection.variant } : {}),
    ...(selection.opencodeAgent ? { opencodeAgent: selection.opencodeAgent } : {}),
  };
};
