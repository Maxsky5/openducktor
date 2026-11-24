import { type AgentModelCatalog, listSelectableCatalogProfiles } from "@openducktor/core";
import type { SelectOption } from "../../lib/select-option";

export const catalogModelOptionValue = (
  entry: Pick<AgentModelCatalog["models"][number], "providerId" | "modelId">,
): string => `${entry.providerId}/${entry.modelId}`;

export const toPrimaryAgentOptions = (catalog: AgentModelCatalog | null): SelectOption[] => {
  return listSelectableCatalogProfiles(catalog).map((entry) => {
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
