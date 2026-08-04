import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { AgentEvent } from "@openducktor/core";
import {
  advanceStreamAssistantMessageIdentity,
  type ClaudeEventSession,
} from "./claude-agent-sdk-event-session";
import { retractClaudeTodoToolResults } from "./claude-agent-sdk-todos";
import { retractClaudeTranscriptCorrelations } from "./claude-agent-sdk-transcript-correlation";
import { isRecord } from "./claude-agent-sdk-utils";

const readStringArrayProp = (value: unknown, key: string): string[] => {
  if (!isRecord(value)) {
    return [];
  }
  const candidate = value[key];
  if (!Array.isArray(candidate)) {
    return [];
  }
  return candidate.filter((item): item is string => typeof item === "string" && item.length > 0);
};

const emitTranscriptRetraction = ({
  emit,
  messageIds,
  session,
  timestamp,
}: {
  emit: (event: AgentEvent) => void;
  messageIds: string[];
  session: ClaudeEventSession;
  timestamp: string;
}): void => {
  const uniqueMessageIds = [...new Set(messageIds)];
  if (uniqueMessageIds.length === 0) {
    return;
  }
  const retracted = retractClaudeTranscriptCorrelations(session, uniqueMessageIds);
  const todos = retractClaudeTodoToolResults(session, retracted.toolUseIds);
  emit({
    type: "transcript_retracted",
    externalSessionId: session.externalSessionId,
    timestamp,
    messageIds: uniqueMessageIds,
  });
  if (todos) {
    emit({
      type: "session_todos_updated",
      externalSessionId: session.externalSessionId,
      timestamp,
      todos,
    });
  }
};

export const settleClaudeStreamedAssistantText = ({
  emit,
  preserveMessageId,
  session,
  timestamp,
}: {
  emit: (event: AgentEvent) => void;
  preserveMessageId?: string;
  session: ClaudeEventSession;
  timestamp: string;
}): void => {
  const streamedMessageIds = [
    ...new Set(session.streamAssistantMessageIdsByBlockIndex.values()),
  ].filter((messageId) => messageId !== preserveMessageId);
  if (streamedMessageIds.length > 0) {
    emitTranscriptRetraction({
      emit,
      session,
      timestamp,
      messageIds: streamedMessageIds,
    });
  }
  advanceStreamAssistantMessageIdentity(session);
};

export const emitSupersededTranscriptMessage = ({
  emit,
  message,
  session,
  timestamp,
}: {
  emit: (event: AgentEvent) => void;
  message: Extract<SDKMessage, { type: "assistant" }>;
  session: ClaudeEventSession;
  timestamp: string;
}): void => {
  emitTranscriptRetraction({
    emit,
    session,
    timestamp,
    messageIds: readStringArrayProp(message, "supersedes"),
  });
};

export const emitRetractedTranscriptMessages = ({
  emit,
  message,
  session,
  timestamp,
}: {
  emit: (event: AgentEvent) => void;
  message: Extract<
    SDKMessage,
    { type: "result" } | { type: "system"; subtype: "model_refusal_fallback" }
  >;
  session: ClaudeEventSession;
  timestamp: string;
}): void => {
  emitTranscriptRetraction({
    emit,
    session,
    timestamp,
    messageIds: readStringArrayProp(message, "retracted_message_uuids"),
  });
};
