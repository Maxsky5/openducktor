import { useMemo } from "react";
import type { AgentChatThreadSession } from "./agent-chat.types";
import {
  type AgentChatWindowRowsState,
  buildAgentChatWindowRowsState,
} from "./agent-chat-thread-windowing";

const EMPTY_TRANSCRIPT_ROWS_STATE: AgentChatWindowRowsState = Object.freeze({
  rows: [],
  turns: [],
  hasAttachmentMessages: false,
  lastUserMessageId: null,
  activeStreamingAssistantMessageId: null,
});

export const useAgentChatTranscriptRows = ({
  session,
  showThinkingMessages,
}: {
  session: AgentChatThreadSession | null;
  showThinkingMessages: boolean;
}): {
  transcriptState: AgentChatWindowRowsState;
} => {
  const transcriptState = useMemo(() => {
    if (!session) {
      return EMPTY_TRANSCRIPT_ROWS_STATE;
    }

    return buildAgentChatWindowRowsState(session, { showThinkingMessages });
  }, [session, showThinkingMessages]);

  return { transcriptState };
};
