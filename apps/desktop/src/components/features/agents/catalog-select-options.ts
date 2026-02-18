import type { ComboboxGroup, ComboboxOption } from "@/components/ui/combobox";
import type { AgentDescriptor, AgentModelCatalog } from "@openblueprint/core";

const isPrimaryCatalogAgent = (entry: AgentDescriptor): boolean => {
  if (entry.hidden) {
    return false;
  }
  return entry.mode === "primary" || entry.mode === "all";
};

export const toPrimaryAgentOptions = (catalog: AgentModelCatalog | null): ComboboxOption[] => {
  if (!catalog) {
    return [];
  }

  return catalog.agents.filter(isPrimaryCatalogAgent).map((entry) => ({
    value: entry.name,
    label: entry.name,
    ...(entry.description ? { description: entry.description } : {}),
  }));
};

export const toModelOptions = (catalog: AgentModelCatalog | null): ComboboxOption[] => {
  if (!catalog) {
    return [];
  }

  return catalog.models.map((entry) => ({
    value: entry.id,
    label: entry.modelName,
    description: entry.modelId,
    searchKeywords: [
      entry.modelId,
      entry.providerId,
      entry.providerName,
      ...entry.variants.map((variant) => `variant:${variant}`),
    ],
  }));
};

export const toModelGroupsByProvider = (catalog: AgentModelCatalog | null): ComboboxGroup[] => {
  if (!catalog) {
    return [];
  }

  const grouped = new Map<string, ComboboxOption[]>();
  for (const model of catalog.models) {
    const label = model.providerName || model.providerId;
    const options = grouped.get(label) ?? [];
    options.push({
      value: model.id,
      label: model.modelName,
      description: model.modelId,
      searchKeywords: [
        model.modelId,
        model.providerId,
        model.providerName,
        ...model.variants.map((variant) => `variant:${variant}`),
      ],
    });
    grouped.set(label, options);
  }

  return [...grouped.entries()].map(([label, options]) => ({
    label,
    options,
  }));
};
