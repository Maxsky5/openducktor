import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { AgentModelSelection } from "@openducktor/core";
import { toClaudeSlashCommandCatalog } from "./claude-agent-sdk-catalog";
import {
  advanceStreamAssistantMessageIdentity,
  type ClaudeEventSession,
  finalAssistantTextMessageId,
  rememberAssistantTextForCurrentTurn,
  streamAssistantMessageId,
  streamedTextMessageIdForBlock,
} from "./claude-agent-sdk-event-session";
import {
  emitClaudeSubagentUserMessage,
  resolveForwardedClaudeSubagentMessage,
} from "./claude-agent-sdk-forwarded-subagent-events";
import { applyClaudeLifecycleEvent } from "./claude-agent-sdk-lifecycle";
import {
  emitClaudePermissionDeniedToolPart,
  handleClaudeResultMessage,
} from "./claude-agent-sdk-result-events";
import { handleClaudeSubagentSystemMessage } from "./claude-agent-sdk-subagents";
import {
  appendClaudeStreamToolInputJson,
  hasClaudeStreamEmittedToolInput,
  rememberClaudeStreamToolStart,
} from "./claude-agent-sdk-tool-input-stream";
import { handleClaudeUserToolResultMessage } from "./claude-agent-sdk-tool-results";
import {
  type ClaudeDecodedToolUse,
  createClaudeRunningToolPart,
  decodeClaudeToolUseBlock,
  isClaudeToolUseBlockType,
  timestampMs,
} from "./claude-agent-sdk-tool-shapes";
import {
  emitRetractedTranscriptMessages,
  emitSupersededTranscriptMessage,
  settleClaudeStreamedAssistantText,
} from "./claude-agent-sdk-transcript-retractions";
import type { ClaudeAgentSdkEvent } from "./claude-agent-sdk-types";
import {
  claudeAssistantTextPartEvent,
  isRecord,
  readStringProp,
  textFromContentBlocks,
} from "./claude-agent-sdk-utils";

type SdkMessageHandlerInput = {
  emit: (event: ClaudeAgentSdkEvent) => void;
  message: SDKMessage;
  modelSelection: (model: string) => AgentModelSelection;
  session: ClaudeEventSession;
  timestamp: string;
};

export const handleClaudeSdkMessage = ({
  emit,
  message,
  modelSelection,
  session,
  timestamp,
}: SdkMessageHandlerInput): void => {
  if (message.type === "system" && message.subtype === "init") {
    return;
  }
  const forwardedSubagentMessage = resolveForwardedClaudeSubagentMessage(session, message);
  if (forwardedSubagentMessage !== undefined) {
    if (!forwardedSubagentMessage) {
      return;
    }
    handleClaudeSdkMessage({
      emit,
      message: forwardedSubagentMessage.message,
      modelSelection,
      session: forwardedSubagentMessage.session,
      timestamp,
    });
    return;
  }
  if (message.type === "assistant") {
    handleAssistantMessage({
      emit,
      message,
      modelSelection,
      session,
      timestamp,
    });
    return;
  }
  if (message.type === "user") {
    emitClaudeSubagentUserMessage({ emit, message, session, timestamp });
    handleClaudeUserToolResultMessage({ emit, message, session, timestamp });
    return;
  }
  if (message.type === "stream_event") {
    handleStreamEvent({ emit, message, session, timestamp });
    return;
  }
  if (message.type === "result") {
    emitRetractedTranscriptMessages({ emit, message, session, timestamp });
    handleClaudeResultMessage({ emit, message, session, timestamp });
    advanceStreamAssistantMessageIdentity(session);
    return;
  }
  if (message.type === "system" && message.subtype === "session_state_changed") {
    handleSessionStateChanged({ emit, message, session, timestamp });
    return;
  }
  if (message.type === "system" && message.subtype === "model_refusal_fallback") {
    emitRetractedTranscriptMessages({ emit, message, session, timestamp });
    return;
  }
  if (message.type === "tool_progress") {
    handleToolProgressMessage({ emit, message, session, timestamp });
    return;
  }
  if (message.type === "system" && message.subtype === "commands_changed") {
    emit({
      type: "runtime_slash_commands_changed",
      externalSessionId: session.externalSessionId,
      timestamp,
      catalog: toClaudeSlashCommandCatalog(message.commands),
    });
    return;
  }
  if (
    message.type === "system" &&
    (message.subtype === "task_started" ||
      message.subtype === "task_progress" ||
      message.subtype === "task_updated" ||
      message.subtype === "task_notification")
  ) {
    handleClaudeSubagentSystemMessage({ emit, message, session, timestamp });
    return;
  }
  if (message.type === "system" && message.subtype === "permission_denied") {
    const input = session.toolInputsByCallId.get(message.tool_use_id);
    emitClaudePermissionDeniedToolPart({
      emit,
      session,
      timestamp,
      permission: {
        toolName: message.tool_name,
        toolUseId: message.tool_use_id,
        message: message.message,
        ...(input ? { input } : {}),
        metadata: {
          source: "permission_denied",
          ...(message.agent_id ? { agentId: message.agent_id } : {}),
          ...(message.decision_reason_type
            ? { decisionReasonType: message.decision_reason_type }
            : {}),
          ...(message.decision_reason ? { decisionReason: message.decision_reason } : {}),
        },
      },
    });
  }
};

const rememberToolInput = (
  session: Pick<ClaudeEventSession, "toolInputsByCallId">,
  callId: string,
  input: Record<string, unknown>,
): void => {
  session.toolInputsByCallId.set(callId, input);
};

const emitClaudeRunningToolPart = ({
  emit,
  fallbackMessageId,
  session,
  startedAtMs: explicitStartedAtMs,
  timestamp,
  toolUse,
}: Pick<SdkMessageHandlerInput, "emit" | "session" | "timestamp"> & {
  fallbackMessageId: string;
  startedAtMs?: number;
  toolUse: ClaudeDecodedToolUse;
}): void => {
  const messageId = session.toolMessageIdsByCallId.get(toolUse.callId) ?? fallbackMessageId;
  const startedAtMs =
    explicitStartedAtMs ??
    session.toolStartedAtMsByCallId.get(toolUse.callId) ??
    timestampMs(timestamp);
  session.toolMessageIdsByCallId.set(toolUse.callId, messageId);
  session.toolNamesByCallId.set(toolUse.callId, toolUse.toolName);
  session.toolStartedAtMsByCallId.set(toolUse.callId, startedAtMs);
  if (toolUse.input) {
    rememberToolInput(session, toolUse.callId, toolUse.input);
  }
  const cachedInput = session.toolInputsByCallId.get(toolUse.callId);
  const effectiveToolUse =
    !toolUse.input && cachedInput
      ? {
          ...toolUse,
          input: cachedInput,
        }
      : toolUse;

  emit({
    type: "assistant_part",
    externalSessionId: session.externalSessionId,
    timestamp,
    part: createClaudeRunningToolPart({
      messageId,
      startedAtMs,
      toolUse: effectiveToolUse,
    }),
  });
};

const handleStreamEvent = ({
  emit,
  message,
  session,
  timestamp,
}: Pick<SdkMessageHandlerInput, "emit" | "session" | "timestamp"> & {
  message: Extract<SDKMessage, { type: "stream_event" }>;
}): void => {
  const event = message.event;
  if (!isRecord(event)) {
    return;
  }

  const eventType = readStringProp(event, "type");
  if (eventType === "message_start") {
    session.streamAssistantMessageIdsByBlockIndex.clear();
    session.streamAssistantMessageOrdinal += 1;
    return;
  }
  if (eventType === "content_block_start") {
    const index = typeof event.index === "number" ? event.index : null;
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
    emitClaudeRunningToolPart({
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

  const index = typeof event.index === "number" ? event.index : null;
  const delta = isRecord(event.delta) ? event.delta : null;
  if (index === null || !delta) {
    return;
  }
  const deltaType = readStringProp(delta, "type");
  if (deltaType === "text_delta") {
    const text = typeof delta.text === "string" ? delta.text : "";
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
  if (deltaType !== "input_json_delta") {
    return;
  }
  const partialJson = delta.partial_json;
  if (typeof partialJson !== "string" || partialJson.length === 0) {
    return;
  }
  const toolUse = appendClaudeStreamToolInputJson(session, index, partialJson);
  if (!toolUse) {
    return;
  }
  emitClaudeRunningToolPart({
    emit,
    fallbackMessageId: toolUse.callId,
    session,
    timestamp,
    toolUse,
  });
};

const handleSessionStateChanged = ({
  emit,
  message,
  session,
  timestamp,
}: Pick<SdkMessageHandlerInput, "emit" | "session" | "timestamp"> & {
  message: Extract<SDKMessage, { type: "system"; subtype: "session_state_changed" }>;
}): void => {
  applyClaudeLifecycleEvent({
    emit,
    session,
    timestamp,
    event: {
      kind: "sdk_state",
      state: message.state,
    },
  });
};

const handleAssistantMessage = ({
  emit,
  message,
  modelSelection,
  session,
  timestamp,
}: SdkMessageHandlerInput & {
  message: Extract<SDKMessage, { type: "assistant" }>;
}): void => {
  emitSupersededTranscriptMessage({ emit, message, session, timestamp });
  const assistantModel = message.message.model ? modelSelection(message.message.model) : undefined;
  if (assistantModel) {
    session.model = assistantModel;
  }
  const content = (message.message as { content?: unknown }).content;
  const text = textFromContentBlocks(content);
  const hasToolUse =
    Array.isArray(content) &&
    content.some(
      (block) => isRecord(block) && isClaudeToolUseBlockType(readStringProp(block, "type")),
    );
  let completedStreamedAssistantText = false;
  if (Array.isArray(content)) {
    for (const [index, block] of content.entries()) {
      if (!isRecord(block)) {
        continue;
      }
      const type = readStringProp(block, "type");
      if (type === "text" && hasToolUse) {
        const blockText = readStringProp(block, "text");
        if (blockText) {
          rememberAssistantTextForCurrentTurn(session, blockText);
          completedStreamedAssistantText =
            completedStreamedAssistantText ||
            session.streamAssistantMessageIdsByBlockIndex.has(index);
          const messageId = streamedTextMessageIdForBlock(session, message.uuid, index);
          emit(
            claudeAssistantTextPartEvent({
              externalSessionId: session.externalSessionId,
              messageId,
              partId: `${messageId}:text:${index}`,
              text: blockText,
              timestamp,
            }),
          );
          session.streamAssistantMessageIdsByBlockIndex.delete(index);
        }
        continue;
      }
      const toolUse = decodeClaudeToolUseBlock({
        block,
        fallbackMessageId: message.uuid,
        index,
      });
      if (toolUse) {
        if (
          toolUse.input &&
          hasClaudeStreamEmittedToolInput(session, toolUse.callId, toolUse.input)
        ) {
          continue;
        }

        emitClaudeRunningToolPart({
          emit,
          fallbackMessageId: message.uuid,
          session,
          timestamp,
          toolUse,
        });
      }
      if (type === "thinking") {
        const thinkingText = readStringProp(block, "thinking") ?? readStringProp(block, "text");
        if (thinkingText) {
          emit({
            type: "assistant_part",
            externalSessionId: session.externalSessionId,
            timestamp,
            part: {
              kind: "reasoning",
              messageId: message.uuid,
              partId: `${message.uuid}:thinking:${index}`,
              text: thinkingText,
              completed: true,
            },
          });
        }
      }
    }
  }
  if (completedStreamedAssistantText) {
    session.streamAssistantMessageIdsByBlockIndex.clear();
    session.streamAssistantMessageOrdinal += 1;
  }
  if (text.length > 0) {
    const stopReason = readStringProp(message.message, "stop_reason");
    if (hasToolUse) {
      return;
    }
    if (!stopReason) {
      return;
    }
    if (stopReason === "end_turn" || stopReason === "stop_sequence") {
      rememberAssistantTextForCurrentTurn(session, text);
      const messageId = finalAssistantTextMessageId(session, message.uuid, content);
      settleClaudeStreamedAssistantText({ emit, content, session, timestamp });
      emit({
        type: "assistant_message",
        externalSessionId: session.externalSessionId,
        timestamp,
        messageId,
        message: text,
        ...(assistantModel ? { model: assistantModel } : {}),
      });
      return;
    }
    rememberAssistantTextForCurrentTurn(session, text);
    const messageId = finalAssistantTextMessageId(session, message.uuid, content);
    emit(
      claudeAssistantTextPartEvent({
        externalSessionId: session.externalSessionId,
        messageId,
        text,
        timestamp,
      }),
    );
  }
};

const handleToolProgressMessage = ({
  emit,
  message,
  session,
  timestamp,
}: Pick<SdkMessageHandlerInput, "emit" | "session" | "timestamp"> & {
  message: Extract<SDKMessage, { type: "tool_progress" }>;
}): void => {
  const elapsedMs = Math.max(0, Math.round(message.elapsed_time_seconds * 1000));
  const eventMs = timestampMs(timestamp);
  const startedAtMs =
    session.toolStartedAtMsByCallId.get(message.tool_use_id) ?? eventMs - elapsedMs;

  emitClaudeRunningToolPart({
    emit,
    fallbackMessageId: message.uuid,
    session,
    startedAtMs,
    timestamp,
    toolUse: {
      blockType: "tool_progress",
      callId: message.tool_use_id,
      toolName: message.tool_name,
      metadata: {
        elapsedTimeSeconds: message.elapsed_time_seconds,
        durationMs: elapsedMs,
      },
    },
  });
};
