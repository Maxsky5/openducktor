import type { AgentModelCatalog, AgentModelSelection } from "@openducktor/core";
import { toPrimaryAgentOptions } from "@/components/features/agents";
import type { ComboboxOption } from "@/components/ui/combobox";
import { resolveModelSelectionPolicy } from "./model-selection-policy";

type ModelSelectionOptions = {
  selectedModelEntry: AgentModelCatalog["models"][number] | null;
  agentProfileOptions: ComboboxOption[];
  variantOptions: ComboboxOption[];
};

const findSelectedModelEntry = (
  selectionCatalog: AgentModelCatalog | null,
  selectedModelSelection: AgentModelSelection | null,
): AgentModelCatalog["models"][number] | null => {
  if (!selectionCatalog || !selectedModelSelection) {
    return null;
  }
  return (
    selectionCatalog.models.find(
      (entry) =>
        entry.providerId === selectedModelSelection.providerId &&
        entry.modelId === selectedModelSelection.modelId,
    ) ?? null
  );
};

const toAgentProfileOptionsWithSelectedFallback = (
  selectionCatalog: AgentModelCatalog | null,
  selectedModelSelection: AgentModelSelection | null,
): ComboboxOption[] => {
  const options = toPrimaryAgentOptions(selectionCatalog);
  if (options.length > 0) {
    return options;
  }
  const fallbackAgent = selectedModelSelection?.profileId;
  if (fallbackAgent && fallbackAgent.trim().length > 0) {
    const option: ComboboxOption = {
      value: fallbackAgent,
      label: fallbackAgent,
      description: "Current session profile",
    };
    return [option];
  }
  return [];
};

const toVariantOptions = (
  selectedModelEntry: AgentModelCatalog["models"][number] | null,
  selectedModelSelection: AgentModelSelection | null,
  liveSession: boolean,
): ComboboxOption[] => {
  if (!selectedModelEntry) {
    const selectedVariant = selectedModelSelection?.variant;
    if (selectedVariant && selectedVariant.trim().length > 0) {
      return [
        {
          value: selectedVariant,
          label: selectedVariant,
        },
      ];
    }
    return [];
  }
  let { variants } = resolveModelSelectionPolicy(selectedModelEntry, liveSession);
  if (liveSession && selectedModelEntry.liveSessionUpdates?.variants) {
    const selectedVariant = selectedModelSelection?.variant;
    if (
      selectedVariant &&
      selectedModelEntry.variants.includes(selectedVariant) &&
      !variants.includes(selectedVariant)
    ) {
      variants = [selectedVariant, ...variants];
    }
  }
  return variants.map((variant) => ({
    value: variant,
    label: variant,
  }));
};

export const resolveModelSelectionOptions = ({
  liveSession = false,
  selectionCatalog,
  selectedModelSelection,
}: {
  liveSession?: boolean;
  selectionCatalog: AgentModelCatalog | null;
  selectedModelSelection: AgentModelSelection | null;
}): ModelSelectionOptions => {
  const selectedModelEntry = findSelectedModelEntry(selectionCatalog, selectedModelSelection);
  const policy = resolveModelSelectionPolicy(selectedModelEntry, liveSession);
  const profileOptions = toAgentProfileOptionsWithSelectedFallback(
    selectionCatalog,
    selectedModelSelection,
  );
  return {
    selectedModelEntry,
    agentProfileOptions: policy.canChangeProfile
      ? profileOptions
      : profileOptions.map((option) => ({
          ...option,
          disabled: true,
          description: "Start a new session to change the agent profile.",
        })),
    variantOptions: toVariantOptions(selectedModelEntry, selectedModelSelection, liveSession),
  };
};
