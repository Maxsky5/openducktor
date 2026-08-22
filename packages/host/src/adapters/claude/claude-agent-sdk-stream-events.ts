import { hasRuntimeType } from "@openducktor/contracts";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
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
} from "./claude-agent-sdk-tool-shapes";
import { createClaudeAssistantReasoningPart } from "./claude-agent-sdk-transcript-parts";
import type { ClaudeAgentSdkEvent } from "./claude-agent-sdk-types";
import { isRecord, readStringProp } from "./claude-agent-sdk-utils";
import { parseClaudeJsonValue } from "./claude-agent-sdk-ingress-schemas";

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
  message: Extract<SDKMessage, { type: "stream_event" }>;
  session: ClaudeEventSession;
  timestamp: string;
}): void => {
  const event = parseClaudeJsonValue(message.event, "claudeStreamEvent");
  if (!isRecord(event)) {
    return;
  }

  const eventType = readStringProp(event, "type");
  if (eventType === "message_start") {
    session.streamAssistantMessageIdsByBlockIndex.clear();
    session.streamAssistantMessageOrdinal += 1;
    session.streamReasoningByBlockIndex?.clear();
    const responseId = isRecord(event.message) ? readStringProp(event.message, "id") : undefined;
    if (responseId) {
      session.streamAssistantResponseId = responseId;
    } else {
      delete session.streamAssistantResponseId;
    }
    return;
  }
  if (eventType === "content_block_stop") {
    const index = hasRuntimeType(event.index, "number") ? event.index : null;
    if (index === null) {
      return;
    }
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
  if (eventType === "content_block_start") {
    const index = hasRuntimeType(event.index, "number") ? event.index : null;
    const block = isRecord(event.content_block) ? event.content_block : null;
    if (index === null || !block) {
      return;
    }
    const toolUse = decodeClaudeToolUseBlock({
      block,
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
  if (eventType !== "content_block_delta") {
    return;
  }

  const index = hasRuntimeType(event.index, "number") ? event.index : null;
  const delta = isRecord(event.delta) ? event.delta : null;
  if (index === null || !delta) {
    return;
  }
  const deltaType = readStringProp(delta, "type");
  if (deltaType === "text_delta") {
    const text = hasRuntimeType(delta.text, "string") ? delta.text : "";
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
  if (deltaType === "thinking_delta") {
    const text = hasRuntimeType(delta.thinking, "string") ? delta.thinking : "";
    if (text.length === 0 || !session.streamAssistantResponseId) {
      return;
    }
    session.streamReasoningByBlockIndex ??= new Map();
    const current = session.streamReasoningByBlockIndex.get(index);
    session.streamReasoningByBlockIndex.set(index, `${current ?? ""}${text}`);
    return;
  }
  if (deltaType !== "input_json_delta") {
    return;
  }
  const partialJson = delta.partial_json;
  if (!hasRuntimeType(partialJson, "string") || partialJson.length === 0) {
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
