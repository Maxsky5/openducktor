import type { AgentModelCatalog, AgentModelSelection } from "@openducktor/core";
import {
  resolveAgentAccentColor,
  toModelGroupsByProvider,
  toModelOptions,
  toPrimaryAgentOptions,
} from "@/components/features/agents";
import type { ComboboxOption } from "@/components/ui/combobox";

type ModelSelectionOptions = {
  selectedModelEntry: AgentModelCatalog["models"][number] | null;
  agentProfileOptions: ComboboxOption[];
  modelOptions: ComboboxOption[];
  modelGroups: ReturnType<typeof toModelGroupsByProvider>;
  variantOptions: ComboboxOption[];
  agentAccentColorsByProfileId: Record<string, string>;
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
  const fallbackAgentColor = resolveAgentAccentColor(fallbackAgent);
  if (fallbackAgent && fallbackAgent.trim().length > 0) {
    return [
      {
        value: fallbackAgent,
        label: fallbackAgent,
        description: "Current session agent",
        ...(fallbackAgentColor ? { accentColor: fallbackAgentColor } : {}),
      },
    ];
  }
  return [];
};

const toModelOptionsWithSelectedFallback = (
  selectionCatalog: AgentModelCatalog | null,
  selectedModelSelection: AgentModelSelection | null,
): ComboboxOption[] => {
  const options = toModelOptions(selectionCatalog);
  if (options.length > 0) {
    return options;
  }
  if (selectedModelSelection?.providerId && selectedModelSelection.modelId) {
    return [
      {
        value: `${selectedModelSelection.providerId}/${selectedModelSelection.modelId}`,
        label: selectedModelSelection.modelId,
        description: `${selectedModelSelection.providerId} (current session model)`,
      },
    ];
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
  let variants = selectedModelEntry.variants;
  if (liveSession && selectedModelEntry.liveSessionUpdates?.variants) {
    const liveSessionVariants = new Set(selectedModelEntry.liveSessionUpdates.variants);
    variants = selectedModelEntry.variants.filter((variant) => liveSessionVariants.has(variant));
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

const toAgentAccentColorsByProfileId = (
  selectionCatalog: AgentModelCatalog | null,
): Record<string, string> => {
  if (!selectionCatalog) {
    return {};
  }
  const map: Record<string, string> = {};
  for (const descriptor of selectionCatalog.profiles ?? []) {
    const descriptorId = descriptor.id ?? descriptor.name;
    const descriptorLabel = descriptor.label ?? descriptor.name;
    if (!descriptorId || !descriptorLabel) {
      continue;
    }
    const color = resolveAgentAccentColor(descriptorLabel, descriptor.color);
    if (color) {
      map[descriptorId] = color;
    }
  }
  return map;
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
  return {
    selectedModelEntry,
    agentProfileOptions: toAgentProfileOptionsWithSelectedFallback(
      selectionCatalog,
      selectedModelSelection,
    ),
    modelOptions: toModelOptionsWithSelectedFallback(selectionCatalog, selectedModelSelection),
    modelGroups: toModelGroupsByProvider(selectionCatalog),
    variantOptions: toVariantOptions(selectedModelEntry, selectedModelSelection, liveSession),
    agentAccentColorsByProfileId: toAgentAccentColorsByProfileId(selectionCatalog),
  };
};
