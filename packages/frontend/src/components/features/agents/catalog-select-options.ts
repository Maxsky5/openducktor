import type { AgentDescriptor, AgentModelCatalog } from "@openducktor/core";
import type { ComboboxGroup, ComboboxOption } from "@/components/ui/combobox";
import { resolveAgentAccentColor } from "./agent-accent-color";
import { formatTokenCompact } from "./format-token-count";

const isVisibleAgent = (entry: AgentDescriptor): boolean => !entry.hidden;

export const catalogModelOptionValue = (
  entry: Pick<AgentModelCatalog["models"][number], "providerId" | "modelId">,
): string => `${entry.providerId}/${entry.modelId}`;

const isPrimaryCatalogAgent = (entry: AgentDescriptor): boolean => {
  return isVisibleAgent(entry) && (entry.mode === "primary" || entry.mode === "all");
};

export const toPrimaryAgentOptions = (catalog: AgentModelCatalog | null): ComboboxOption[] => {
  if (!catalog) {
    return [];
  }

  const catalogProfiles = catalog.profiles ?? [];
  const primaryAgents = catalogProfiles.filter(isPrimaryCatalogAgent);
  const fallbackAgents =
    primaryAgents.length > 0
      ? primaryAgents
      : catalogProfiles.filter((entry) => isVisibleAgent(entry) && entry.mode !== "subagent");

  return fallbackAgents.map((entry) => {
    const label = entry.label ?? entry.name ?? entry.id ?? "Unknown";
    const value = entry.id ?? entry.name ?? label;
    const accentColor = resolveAgentAccentColor(label, entry.color);
    const option: ComboboxOption = {
      value,
      label,
    };
    if (entry.description) {
      option.description = entry.description;
    }
    if (accentColor) {
      option.accentColor = accentColor;
    }
    return option;
  });
};

export const toModelOptions = (catalog: AgentModelCatalog | null): ComboboxOption[] => {
  if (!catalog) {
    return [];
  }

  return catalog.models.map((entry) => {
    const contextWindowLabel = formatTokenCompact(entry.contextWindow);
    const searchKeywords = [entry.modelId, entry.providerId, entry.providerName];
    if (contextWindowLabel) {
      searchKeywords.push(contextWindowLabel, `${contextWindowLabel} context`);
    }
    searchKeywords.push(...entry.variants.map((variant) => `variant:${variant}`));
    const option: ComboboxOption = {
      value: catalogModelOptionValue(entry),
      label: entry.modelName,
      description: entry.modelId,
      searchKeywords,
    };
    if (contextWindowLabel) {
      option.secondaryLabel = contextWindowLabel;
    }
    return option;
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
    const searchKeywords = [model.modelId, model.providerId, model.providerName];
    if (contextWindowLabel) {
      searchKeywords.push(contextWindowLabel, `${contextWindowLabel} context`);
    }
    searchKeywords.push(...model.variants.map((variant) => `variant:${variant}`));
    const option: ComboboxOption = {
      value: catalogModelOptionValue(model),
      label: model.modelName,
      description: model.modelId,
      searchKeywords,
    };
    if (contextWindowLabel) {
      option.secondaryLabel = contextWindowLabel;
    }
    options.push(option);
    grouped.set(label, options);
  }

  return [...grouped.entries()].map(([label, options]) => ({
    label,
    options,
  }));
};
