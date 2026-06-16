import {
  type AgentSessionTranscriptState,
  isAgentSessionTranscriptLoading,
} from "@/state/operations/agent-orchestrator/transcript/session-transcript-state";
import type { AgentChatEmptyStateModel } from "../agent-chat.types";
import { errorMessageFromUnknown } from "./runtime-transcript-error";

type RuntimeTranscriptSurfaceState = {
  loadError: string | null;
  emptyState: AgentChatEmptyStateModel | null;
};

type RuntimeTranscriptSurfaceStateInput = {
  isOpen: boolean;
  hasWorkspace: boolean;
  hasTarget: boolean;
  hasSession: boolean;
  transcriptState: AgentSessionTranscriptState;
  historyError: string | null;
  chatSettingsError: unknown;
};

const deriveLoadError = ({
  hasWorkspace,
  historyError,
  chatSettingsError,
}: Pick<RuntimeTranscriptSurfaceStateInput, "hasWorkspace" | "historyError" | "chatSettingsError">):
  | string
  | null => {
  if (chatSettingsError && hasWorkspace) {
    return `Failed to load chat settings: ${errorMessageFromUnknown(
      chatSettingsError,
      "Settings read failed.",
    )}`;
  }

  return historyError;
};

const toUnavailableConversationEmptyState = ({
  hasWorkspace,
  hasTarget,
  loadError,
}: {
  hasWorkspace: boolean;
  hasTarget: boolean;
  loadError: string | null;
}): AgentChatEmptyStateModel => {
  if (loadError) {
    return {
      title: `Failed to load conversation: ${loadError}`,
    };
  }

  if (hasWorkspace && hasTarget) {
    return {
      title: "Conversation unavailable.",
    };
  }

  return {
    title: "Select a repository and session to view the conversation.",
  };
};

export const deriveRuntimeTranscriptSurfaceState = ({
  isOpen,
  hasWorkspace,
  hasTarget,
  hasSession,
  transcriptState,
  historyError,
  chatSettingsError,
}: RuntimeTranscriptSurfaceStateInput): RuntimeTranscriptSurfaceState => {
  const loadError = deriveLoadError({
    hasWorkspace,
    historyError,
    chatSettingsError,
  });
  const isTranscriptLoading = isAgentSessionTranscriptLoading(transcriptState);
  const isLoadingTargetTranscript = isOpen && hasWorkspace && hasTarget && isTranscriptLoading;
  const emptyState =
    loadError || (!hasSession && !isLoadingTargetTranscript)
      ? toUnavailableConversationEmptyState({
          hasWorkspace,
          hasTarget,
          loadError,
        })
      : null;

  return {
    loadError,
    emptyState,
  };
};
