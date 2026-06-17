import type { AgentModelSelection } from "@openducktor/core";
import { resolveAgentSessionAccentColor } from "../agent-accent-color";

type AgentChatComposerModelStateSession = {
  runtimeKind: AgentModelSelection["runtimeKind"];
  selectedModel: AgentModelSelection | null;
};

export type AgentChatComposerModelStateInput = {
  loadedSession: AgentChatComposerModelStateSession | null;
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
  loadedSession,
  selectedModelSelection,
  isSessionModelCatalogLoading,
  isRuntimeReady,
  sessionAgentColors,
}: AgentChatComposerModelStateInput): AgentChatComposerModelState => {
  const runtimeKind = loadedSession?.runtimeKind ?? selectedModelSelection?.runtimeKind ?? null;
  const agentName = loadedSession
    ? loadedSession.selectedModel?.profileId
    : selectedModelSelection?.profileId;

  return {
    accentColor: resolveAgentSessionAccentColor({
      agentName,
      agentColors: sessionAgentColors,
      runtimeKind,
    }),
    isInteractionEnabled: isRuntimeReady,
    isModelSelectionPending: Boolean(
      loadedSession && isSessionModelCatalogLoading && !loadedSession.selectedModel,
    ),
  };
};
