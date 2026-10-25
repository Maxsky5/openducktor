import {
  type AgentModelCatalog,
  type AgentModelSelection,
  resolveModelSelectionPolicy,
} from "@openducktor/core";
import { toPrimaryAgentOptions } from "./catalog-select-options";
import type { SelectOption } from "../../lib/select-option";
import type { AgentChatMessage } from "../../types/agent-orchestrator";

type ModelSelectionOptions = {
  selectedModelEntry: AgentModelCatalog["models"][number] | null;
  agentProfileOptions: SelectOption[];
  variantOptions: SelectOption[];
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

type RunningTurnMessage = AgentChatMessage & {
  meta: Extract<NonNullable<AgentChatMessage["meta"]>, { kind: "user" }> & {
    providerId: string;
    modelId: string;
  };
};

const startsOrJoinsTurn = (message: AgentChatMessage | undefined): message is RunningTurnMessage =>
  message?.meta?.kind === "user" && Boolean(message.meta.providerId && message.meta.modelId);

/** The latest user message that names a model: it started or joined the running turn. */
export const findRunningTurnMessage = (
  messages: readonly AgentChatMessage[],
): RunningTurnMessage | null => {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (startsOrJoinsTurn(message)) return message;
  }
  return null;
};

/** The catalog entry of the model of the running turn. */
export const findRunningTurnModelEntry = (
  selectionCatalog: AgentModelCatalog | null,
  messages: readonly AgentChatMessage[],
): AgentModelCatalog["models"][number] | null => {
  const meta = findRunningTurnMessage(messages)?.meta;
  return meta
    ? findModelEntry(selectionCatalog, { providerId: meta.providerId, modelId: meta.modelId })
    : null;
};

const toAgentProfileOptions = (
  selectionCatalog: AgentModelCatalog | null,
  selectedModelSelection: AgentModelSelection | null,
  liveSession: boolean,
): SelectOption[] => {
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
): SelectOption[] => {
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
  const options: SelectOption[] = variants.map((variant) => ({
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
