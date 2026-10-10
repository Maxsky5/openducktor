import type { AgentModelSelection } from "@openducktor/core";
import { resolveAgentSessionAccentColor } from "../agent-accent-color";

type AgentChatComposerModelStateSelectedSession = {
  runtimeKind: AgentModelSelection["runtimeKind"];
  selectedModel: AgentModelSelection | null;
};

export type AgentChatComposerModelStateInput = {
  selectedSession: AgentChatComposerModelStateSelectedSession | null;
  selectedModelSelection: AgentModelSelection | null;
  isSessionModelCatalogLoading: boolean;
  isInteractionEnabled: boolean;
};

export type AgentChatComposerModelState = {
  accentColor: string | undefined;
  isInteractionEnabled: boolean;
  isModelSelectionPending: boolean;
};

export const deriveAgentChatComposerModelState = ({
  selectedSession,
  selectedModelSelection,
  isSessionModelCatalogLoading,
  isInteractionEnabled,
}: AgentChatComposerModelStateInput): AgentChatComposerModelState => {
  const runtimeKind = selectedSession?.runtimeKind ?? selectedModelSelection?.runtimeKind ?? null;
  return {
    accentColor: resolveAgentSessionAccentColor({
      runtimeKind,
    }),
    isInteractionEnabled,
    isModelSelectionPending: Boolean(
      selectedSession && isSessionModelCatalogLoading && !selectedSession.selectedModel,
    ),
  };
};
