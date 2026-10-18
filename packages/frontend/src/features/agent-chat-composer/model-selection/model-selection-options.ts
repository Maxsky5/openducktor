import type { AgentModelCatalog, AgentModelSelection } from "@openducktor/core";
import { toPrimaryAgentOptions } from "@/components/features/agents";
import type { ComboboxOption } from "@/components/ui/combobox";
import type { AgentChatMessage } from "@openducktor/frontend-core/types/agent-orchestrator";
import { resolveModelSelectionPolicy } from "./model-selection-policy";

type ModelSelectionOptions = {
  selectedModelEntry: AgentModelCatalog["models"][number] | null;
  agentProfileOptions: ComboboxOption[];
  variantOptions: ComboboxOption[];
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
  const selectedModelEntry = findModelEntry(selectionCatalog, selectedModelSelection);
  const policy = resolveModelSelectionPolicy(selectedModelEntry, liveSession);
  const profileOptions = toAgentProfileOptions(
    selectionCatalog,
    selectedModelSelection,
    liveSession,
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

export const findModelEntry = (
  selectionCatalog: AgentModelCatalog | null,
  model: Pick<AgentModelSelection, "providerId" | "modelId"> | null,
): AgentModelCatalog["models"][number] | null => {
  if (!selectionCatalog || !model) {
    return null;
  }
  return (
    selectionCatalog.models.find(
      (entry) => entry.providerId === model.providerId && entry.modelId === model.modelId,
    ) ?? null
  );
};

/** The latest user message with a model started or joined the running turn. */
export const findRunningTurnModelEntry = (
  selectionCatalog: AgentModelCatalog | null,
  messages: readonly AgentChatMessage[],
): AgentModelCatalog["models"][number] | null => {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const meta = messages[index]?.meta;
    if (meta?.kind === "user" && meta.providerId && meta.modelId) {
      return findModelEntry(selectionCatalog, {
        providerId: meta.providerId,
        modelId: meta.modelId,
      });
    }
  }
  return null;
};

const toAgentProfileOptions = (
  selectionCatalog: AgentModelCatalog | null,
  selectedModelSelection: AgentModelSelection | null,
  liveSession: boolean,
): ComboboxOption[] => {
  const options = toPrimaryAgentOptions(selectionCatalog);
  const currentProfile = selectedModelSelection?.profileId;
  if (!currentProfile || options.some((option) => option.value === currentProfile)) {
    return options;
  }
  if (liveSession || options.length === 0) {
    options.unshift({
      value: currentProfile,
      label: currentProfile,
      description: "Current session profile",
      disabled: liveSession,
    });
  }
  return options;
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
  const { variants } = resolveModelSelectionPolicy(selectedModelEntry, liveSession);
  const options: ComboboxOption[] = variants.map((variant) => ({
    value: variant,
    label: variant,
  }));
  const currentVariant = selectedModelSelection?.variant;
  if (liveSession && currentVariant && !variants.includes(currentVariant)) {
    options.unshift({
      value: currentVariant,
      label: currentVariant,
      disabled: true,
      description: "Current session effort",
    });
  }
  return options;
};
