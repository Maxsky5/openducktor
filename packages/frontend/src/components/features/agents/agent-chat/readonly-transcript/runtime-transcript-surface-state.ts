import {
  type AgentSessionTranscriptState,
  isAgentSessionTranscriptLoading,
  isAgentSessionTranscriptVisible,
} from "@/state/operations/agent-orchestrator/transcript/session-transcript-state";
import type { AgentChatEmptyStateModel } from "../agent-chat.types";
import { errorMessageFromUnknown } from "./runtime-transcript-error";

type RuntimeTranscriptSurfaceState = {
  loadError: string | null;
  emptyState: AgentChatEmptyStateModel | null;
};

type RuntimeTranscriptSurfaceStateInput = {
  transcriptState: AgentSessionTranscriptState;
  chatSettingsError: unknown;
};

const deriveLoadError = ({
  transcriptState,
  chatSettingsError,
}: Pick<RuntimeTranscriptSurfaceStateInput, "transcriptState" | "chatSettingsError">):
  | string
  | null => {
  if (chatSettingsError) {
    return `Failed to load chat settings: ${errorMessageFromUnknown(
      chatSettingsError,
      "Settings read failed.",
    )}`;
  }

  return transcriptState.kind === "failed" ? transcriptState.message : null;
};

const toUnavailableConversationEmptyState = ({
  transcriptState,
  loadError,
}: {
  transcriptState: AgentSessionTranscriptState;
  loadError: string | null;
}): AgentChatEmptyStateModel => {
  if (loadError) {
    return {
      title: `Failed to load conversation: ${loadError}`,
    };
  }

  if (transcriptState.kind !== "empty" || transcriptState.reason === "unavailable") {
    return {
      title: "Conversation unavailable.",
    };
  }

  return {
    title: "Select a repository and session to view the conversation.",
  };
};

export const deriveRuntimeTranscriptSurfaceState = ({
  transcriptState,
  chatSettingsError,
}: RuntimeTranscriptSurfaceStateInput): RuntimeTranscriptSurfaceState => {
  const loadError = deriveLoadError({
    transcriptState,
    chatSettingsError,
  });
  const isTranscriptLoading = isAgentSessionTranscriptLoading(transcriptState);
  const isTranscriptVisible = isAgentSessionTranscriptVisible(transcriptState);
  const emptyState =
    loadError || (!isTranscriptVisible && !isTranscriptLoading)
      ? toUnavailableConversationEmptyState({
          transcriptState,
          loadError,
        })
      : null;

  return {
    loadError,
    emptyState,
  };
};
