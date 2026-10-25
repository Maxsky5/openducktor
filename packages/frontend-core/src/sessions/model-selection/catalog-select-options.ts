import type { AgentDescriptor, AgentModelCatalog } from "@openducktor/core";
import type { SelectOption } from "../../lib/select-option";

const isVisibleAgent = (entry: AgentDescriptor): boolean => !entry.hidden;

export const catalogModelOptionValue = (
  entry: Pick<AgentModelCatalog["models"][number], "providerId" | "modelId">,
): string => `${entry.providerId}/${entry.modelId}`;

const isPrimaryCatalogAgent = (entry: AgentDescriptor): boolean => {
  return isVisibleAgent(entry) && (entry.mode === "primary" || entry.mode === "all");
};

export const toPrimaryAgentOptions = (catalog: AgentModelCatalog | null): SelectOption[] => {
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
    const option: SelectOption = {
      value,
      label,
    };
    if (entry.description) {
      option.description = entry.description;
    }
    return option;
  });
};
