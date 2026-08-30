import {
  type ClaudeEventSession,
  streamAssistantMessageId,
} from "./claude-agent-sdk-event-session";
import {
  appendClaudeStreamToolInputJson,
  rememberClaudeStreamToolStart,
} from "./claude-agent-sdk-tool-input-stream";
import {
  type ClaudeDecodedToolUse,
  createClaudePendingToolPart,
  decodeClaudeToolUseBlock,
  isClaudeToolUseBlockType,
} from "./claude-agent-sdk-tool-shapes";
import { createClaudeAssistantReasoningPart } from "./claude-agent-sdk-transcript-parts";
import type { ClaudeAgentSdkEvent } from "./claude-agent-sdk-types";
import type { ClaudeSdkStreamEventMessageProjection } from "./claude-agent-sdk-message-projection";

export const emitClaudePendingToolPart = ({
  emit,
  fallbackMessageId,
  session,
  timestamp,
  toolUse,
}: {
  emit: (event: ClaudeAgentSdkEvent) => void;
  fallbackMessageId: string;
  session: ClaudeEventSession;
  timestamp: string;
  toolUse: ClaudeDecodedToolUse;
}): void => {
  const messageId = session.toolMessageIdsByCallId.get(toolUse.callId) ?? fallbackMessageId;
  session.toolMessageIdsByCallId.set(toolUse.callId, messageId);
  session.toolNamesByCallId.set(toolUse.callId, toolUse.toolName);
  if (toolUse.input) {
    session.toolInputsByCallId.set(toolUse.callId, toolUse.input);
  }
  emit({
    type: "assistant_part",
    externalSessionId: session.externalSessionId,
    timestamp,
    part: createClaudePendingToolPart({ messageId, toolUse }),
  });
};

export const handleClaudeStreamEvent = ({
  emit,
  message,
  session,
  timestamp,
}: {
  emit: (event: ClaudeAgentSdkEvent) => void;
  message: ClaudeSdkStreamEventMessageProjection;
  session: ClaudeEventSession;
  timestamp: string;
}): void => {
  const event = message.event;
  if (event.type === "message_start") {
    session.streamAssistantMessageIdsByBlockIndex.clear();
    session.streamAssistantMessageOrdinal += 1;
    session.streamReasoningByBlockIndex?.clear();
    if (event.message.id) {
      session.streamAssistantResponseId = event.message.id;
    } else {
      delete session.streamAssistantResponseId;
    }
    return;
  }
  if (event.type === "content_block_stop") {
    const index = event.index;
    const reasoning = session.streamReasoningByBlockIndex?.get(index);
    if (!reasoning || !session.streamAssistantResponseId) {
      return;
    }
    const messageId = session.streamAssistantResponseId;
    emit({
      type: "assistant_part",
      externalSessionId: session.externalSessionId,
      timestamp,
      part: createClaudeAssistantReasoningPart({
        messageId,
        partId: `${messageId}:thinking:${index}`,
        text: reasoning,
      }),
    });
    session.streamReasoningByBlockIndex?.delete(index);
    return;
  }
  if (event.type === "content_block_start") {
    if (!isClaudeToolUseBlockType(event.content_block.type)) {
      return;
    }
    const index = event.index;
    const toolUse = decodeClaudeToolUseBlock({
      block: event.content_block,
      fallbackMessageId: message.uuid,
      index,
    });
    if (!toolUse) {
      return;
    }

    rememberClaudeStreamToolStart(session, index, toolUse);
    emitClaudePendingToolPart({
      emit,
      fallbackMessageId: toolUse.callId,
      session,
      timestamp,
      toolUse,
    });
    return;
  }
  if (event.type !== "content_block_delta") {
    return;
  }

  const index = event.index;
  const delta = event.delta;
  if (delta.type === "text_delta") {
    const text = delta.text;
    if (text.length === 0) {
      return;
    }
    emit({
      type: "assistant_delta",
      externalSessionId: session.externalSessionId,
      timestamp,
      channel: "text",
      messageId: streamAssistantMessageId(session, index),
      delta: text,
    });
    return;
  }
  if (delta.type === "thinking_delta") {
    const text = delta.thinking;
    if (text.length === 0 || !session.streamAssistantResponseId) {
      return;
    }
    session.streamReasoningByBlockIndex ??= new Map();
    const current = session.streamReasoningByBlockIndex.get(index);
    session.streamReasoningByBlockIndex.set(index, `${current ?? ""}${text}`);
    return;
  }
  if (delta.type !== "input_json_delta") {
    return;
  }
  const partialJson = delta.partial_json;
  if (partialJson.length === 0) {
    return;
  }
  const toolUse = appendClaudeStreamToolInputJson(session, index, partialJson);
  if (!toolUse) {
    return;
  }
  emitClaudePendingToolPart({
    emit,
    fallbackMessageId: toolUse.callId,
    session,
    timestamp,
    toolUse,
  });
};
