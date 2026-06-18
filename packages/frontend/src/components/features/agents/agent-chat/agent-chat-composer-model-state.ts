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
  isRuntimeReady: boolean;
  sessionAgentColors: Record<string, string>;
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
  isRuntimeReady,
  sessionAgentColors,
}: AgentChatComposerModelStateInput): AgentChatComposerModelState => {
  const runtimeKind = selectedSession?.runtimeKind ?? selectedModelSelection?.runtimeKind ?? null;
  const agentName = selectedSession
    ? selectedSession.selectedModel?.profileId
    : selectedModelSelection?.profileId;

  return {
    accentColor: resolveAgentSessionAccentColor({
      agentName,
      agentColors: sessionAgentColors,
      runtimeKind,
    }),
    isInteractionEnabled: isRuntimeReady,
    isModelSelectionPending: Boolean(
      selectedSession && isSessionModelCatalogLoading && !selectedSession.selectedModel,
    ),
  };
};
