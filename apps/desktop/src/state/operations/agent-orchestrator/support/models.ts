import type { AgentSessionRecord } from "@openducktor/contracts";
import type { AgentModelCatalog, AgentModelSelection } from "@openducktor/core";
import { DEFAULT_RUNTIME_KIND } from "@/state/agent-runtime-registry";

export const pickDefaultModel = (catalog: AgentModelCatalog): AgentModelSelection | null => {
  const runtimeKind = catalog.runtime?.kind ?? DEFAULT_RUNTIME_KIND;
  if (catalog.models.length === 0) {
    return null;
  }

  for (const model of catalog.models) {
    const providerDefault = catalog.defaultModelsByProvider[model.providerId];
    if (providerDefault && providerDefault === model.modelId) {
      return {
        runtimeKind,
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
    runtimeKind,
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
  const catalogProfiles = catalog.profiles ?? catalog.agents ?? [];
  const preserveAgentSelection = catalogProfiles.length === 0;
  const hasAgent = Boolean(
    selection.profileId &&
      (preserveAgentSelection ||
        catalogProfiles.some((agent) => (agent.id ?? agent.name) === selection.profileId)),
  );

  return {
    runtimeKind: selection.runtimeKind ?? catalog.runtime?.kind ?? DEFAULT_RUNTIME_KIND,
    providerId: model.providerId,
    modelId: model.modelId,
    ...(hasVariant
      ? { variant: selection.variant }
      : model.variants[0]
        ? { variant: model.variants[0] }
        : {}),
    ...(hasAgent ? { profileId: selection.profileId } : {}),
  };
};

export const normalizePersistedSelection = (
  selection: AgentSessionRecord["selectedModel"] | undefined,
): AgentModelSelection | null => {
  if (!selection) {
    return null;
  }
  return {
    runtimeKind: selection.runtimeKind,
    providerId: selection.providerId,
    modelId: selection.modelId,
    ...(selection.variant ? { variant: selection.variant } : {}),
    ...(selection.profileId ? { profileId: selection.profileId } : {}),
  };
};

export const mergeModelSelection = (
  base: AgentModelSelection | null,
  override: AgentModelSelection | undefined,
): AgentModelSelection | null => {
  if (!base) {
    return override ?? null;
  }
  if (!override) {
    return base;
  }

  return {
    ...((override.runtimeKind ?? base.runtimeKind)
      ? { runtimeKind: override.runtimeKind ?? base.runtimeKind }
      : {}),
    providerId: override.providerId,
    modelId: override.modelId,
    ...((override.variant ?? base.variant) ? { variant: override.variant ?? base.variant } : {}),
    ...((override.profileId ?? base.profileId)
      ? { profileId: override.profileId ?? base.profileId }
      : {}),
  };
};
