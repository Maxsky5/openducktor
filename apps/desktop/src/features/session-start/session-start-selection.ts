import type { AgentModelCatalog, AgentModelSelection } from "@openducktor/core";
import { DEFAULT_RUNTIME_KIND } from "@/state/agent-runtime-registry";

export const pickDefaultSelectionForCatalog = (
  catalog: AgentModelCatalog | null,
): AgentModelSelection | null => {
  if (!catalog || catalog.models.length === 0) {
    return null;
  }
  const fallbackModel = catalog.models[0];
  if (!fallbackModel) {
    return null;
  }
  const defaultProvider = Object.entries(catalog.defaultModelsByProvider).find(
    ([providerId, modelId]) =>
      catalog.models.some((entry) => entry.providerId === providerId && entry.modelId === modelId),
  );
  const selectedModel =
    defaultProvider === undefined
      ? fallbackModel
      : (catalog.models.find(
          (entry) =>
            entry.providerId === defaultProvider[0] && entry.modelId === defaultProvider[1],
        ) ?? fallbackModel);

  const catalogProfiles = catalog.profiles ?? catalog.agents ?? [];
  const primaryAgent = catalogProfiles.find((entry) => !entry.hidden && entry.mode === "primary");
  const fallbackAgent = catalogProfiles.find((entry) => !entry.hidden && entry.mode !== "subagent");
  const selectedAgent =
    primaryAgent?.id ?? primaryAgent?.name ?? fallbackAgent?.id ?? fallbackAgent?.name ?? undefined;

  return {
    runtimeKind: catalog.runtime?.kind ?? DEFAULT_RUNTIME_KIND,
    providerId: selectedModel.providerId,
    modelId: selectedModel.modelId,
    ...(selectedModel.variants[0] ? { variant: selectedModel.variants[0] } : {}),
    ...(selectedAgent ? { profileId: selectedAgent } : {}),
  };
};

export const normalizeSelectionForCatalog = (
  catalog: AgentModelCatalog | null,
  selection: AgentModelSelection | null,
): AgentModelSelection | null => {
  if (!catalog || !selection) {
    return selection;
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
        catalogProfiles.some(
          (agent) =>
            (agent.id ?? agent.name) === selection.profileId &&
            !agent.hidden &&
            agent.mode !== "subagent",
        )),
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

export const isSameSelection = (
  a: AgentModelSelection | null | undefined,
  b: AgentModelSelection | null | undefined,
): boolean => {
  if (!a && !b) {
    return true;
  }
  if (!a || !b) {
    return false;
  }
  return (
    a.providerId === b.providerId &&
    a.modelId === b.modelId &&
    a.runtimeKind === b.runtimeKind &&
    (a.variant ?? "") === (b.variant ?? "") &&
    (a.profileId ?? "") === (b.profileId ?? "")
  );
};
