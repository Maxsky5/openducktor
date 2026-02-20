import type { ComboboxGroup, ComboboxOption } from "@/components/ui/combobox";
import type { AgentDescriptor, AgentModelCatalog } from "@openducktor/core";
import { resolveAgentAccentColor } from "./agent-accent-color";
import { formatTokenCompact } from "./agent-chat/format-token-count";

const isVisibleAgent = (entry: AgentDescriptor): boolean => !entry.hidden;

const isPrimaryCatalogAgent = (entry: AgentDescriptor): boolean => {
  return isVisibleAgent(entry) && (entry.mode === "primary" || entry.mode === "all");
};

export const toPrimaryAgentOptions = (catalog: AgentModelCatalog | null): ComboboxOption[] => {
  if (!catalog) {
    return [];
  }

  const primaryAgents = catalog.agents.filter(isPrimaryCatalogAgent);
  const fallbackAgents =
    primaryAgents.length > 0
      ? primaryAgents
      : catalog.agents.filter((entry) => isVisibleAgent(entry) && entry.mode !== "subagent");

  return fallbackAgents.map((entry) => {
    const accentColor = resolveAgentAccentColor(entry.name, entry.color);
    return {
      value: entry.name,
      label: entry.name,
      ...(entry.description ? { description: entry.description } : {}),
      ...(accentColor ? { accentColor } : {}),
    };
  });
};

export const toModelOptions = (catalog: AgentModelCatalog | null): ComboboxOption[] => {
  if (!catalog) {
    return [];
  }

  return catalog.models.map((entry) => {
    const contextWindowLabel = formatTokenCompact(entry.contextWindow);
    return {
      value: entry.id,
      label: entry.modelName,
      description: entry.modelId,
      ...(contextWindowLabel ? { secondaryLabel: contextWindowLabel } : {}),
      searchKeywords: [
        entry.modelId,
        entry.providerId,
        entry.providerName,
        ...(contextWindowLabel ? [contextWindowLabel, `${contextWindowLabel} context`] : []),
        ...entry.variants.map((variant) => `variant:${variant}`),
      ],
    };
  });
};

export const toModelGroupsByProvider = (catalog: AgentModelCatalog | null): ComboboxGroup[] => {
  if (!catalog) {
    return [];
  }

  const grouped = new Map<string, ComboboxOption[]>();
  for (const model of catalog.models) {
    const label = model.providerName || model.providerId;
    const options = grouped.get(label) ?? [];
    const contextWindowLabel = formatTokenCompact(model.contextWindow);
    options.push({
      value: model.id,
      label: model.modelName,
      description: model.modelId,
      ...(contextWindowLabel ? { secondaryLabel: contextWindowLabel } : {}),
      searchKeywords: [
        model.modelId,
        model.providerId,
        model.providerName,
        ...(contextWindowLabel ? [contextWindowLabel, `${contextWindowLabel} context`] : []),
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
