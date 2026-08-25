import { isUnknownRecord, type AgentModelSelection } from "@openducktor/core";
import { toClaudeSlashCommandCatalog } from "./claude-agent-sdk-catalog";
import { handleClaudeCompactionBoundary } from "./claude-agent-sdk-compaction";
import {
  advanceStreamAssistantMessageIdentity,
  type ClaudeEventSession,
  findClaudeSubagentSessionByAgentId,
  findClaudeSubagentTaskSession,
  hasActiveClaudeBackgroundWork,
  rememberAssistantTextForCurrentTurn,
} from "./claude-agent-sdk-event-session";
import {
  emitClaudeSubagentUserMessage,
  resolveForwardedClaudeSubagentMessage,
} from "./claude-agent-sdk-forwarded-subagent-events";
import { applyClaudeLifecycleEvent } from "./claude-agent-sdk-lifecycle";
import { isClaudeSyntheticAssistantMessage } from "./claude-agent-sdk-local-commands";
import {
  emitClaudePermissionDeniedToolPart,
  handleClaudeResultMessage,
} from "./claude-agent-sdk-result-events";
import { emitClaudeRunningToolPart } from "./claude-agent-sdk-running-tool";
import {
  emitClaudePendingToolPart,
  handleClaudeStreamEvent,
} from "./claude-agent-sdk-stream-events";
import { isClaudeSubagentTranscriptTarget } from "./claude-agent-sdk-subagent-transcripts";
import { handleClaudeSubagentSystemMessage } from "./claude-agent-sdk-subagents";
import { parseClaudeUserToolResultIngress } from "./claude-agent-sdk-ingress-schemas";
import { consumeClaudeStreamEmittedToolInput } from "./claude-agent-sdk-tool-input-stream";
import { handleClaudeUserToolResultMessage } from "./claude-agent-sdk-tool-results";
import {
  decodeClaudeToolUseBlock,
  isClaudeToolUseBlockType,
  timestampMs,
} from "./claude-agent-sdk-tool-shapes";
import {
  claudeAssistantTextPartEvent,
  createClaudeAssistantReasoningPart,
} from "./claude-agent-sdk-transcript-parts";
import {
  emitRetractedTranscriptMessages,
  emitSupersededTranscriptMessage,
  settleClaudeStreamedAssistantText,
} from "./claude-agent-sdk-transcript-retractions";
import type { ClaudeAgentSdkEvent } from "./claude-agent-sdk-types";
import { shouldFinalizeClaudeTurn } from "./claude-agent-sdk-user-messages";
import { readStringProp, textFromContentBlocks } from "./claude-agent-sdk-utils";
import type {
  ClaudeSdkAssistantMessageProjection,
  ClaudeSdkMessageProjection,
  ClaudeSdkToolProgressMessageProjection,
} from "./claude-agent-sdk-message-projection";

type SdkMessageHandlerInput = {
  emit: (event: ClaudeAgentSdkEvent) => void;
  message: ClaudeSdkMessageProjection;
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
  const messageValue = message;
  if (message.type === "system" && message.subtype === "init") {
    return;
  }
  if (message.type === "user") {
    parseClaudeUserToolResultIngress(message);
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
    if (isClaudeSyntheticAssistantMessage(messageValue)) {
      return;
    }
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
    const userToolResultMessage = parseClaudeUserToolResultIngress(message);
    const originKind = userToolResultMessage.turnOriginKind;
    if (originKind === "human") {
      delete session.assistantTurnOriginKind;
    } else if (originKind !== undefined) {
      session.assistantTurnOriginKind = originKind;
    }
    emitClaudeSubagentUserMessage({ emit, message, session, timestamp });
    handleClaudeUserToolResultMessage({ emit, message, session, timestamp });
    return;
  }
  if (message.type === "stream_event") {
    handleClaudeStreamEvent({ emit, message, session, timestamp });
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
  if (message.type === "system" && message.subtype === "local_command_output") {
    const content = message.content.trim();
    if (content.length > 0) {
      rememberAssistantTextForCurrentTurn(session, content, message.uuid);
      emit({
        type: "assistant_message",
        externalSessionId: session.externalSessionId,
        timestamp,
        messageId: message.uuid,
        message: content,
      });
    }
    return;
  }
  if (message.type === "system" && message.subtype === "model_refusal_fallback") {
    emitRetractedTranscriptMessages({ emit, message, session, timestamp });
    return;
  }
  if (message.type === "system" && message.subtype === "compact_boundary") {
    handleClaudeCompactionBoundary({
      session,
      timestamp,
      boundaryMessageId: message.uuid,
      emit,
    });
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
    const taskSession =
      findClaudeSubagentTaskSession(
        session,
        readStringProp(messageValue, "tool_use_id"),
        message.task_id,
      ) ?? session;
    handleClaudeSubagentSystemMessage({ emit, message, session: taskSession, timestamp });
    return;
  }
  if (message.type === "system" && message.subtype === "permission_denied") {
    let permissionSession = session;
    if (message.agent_id) {
      const subagentSession = findClaudeSubagentSessionByAgentId(session, message.agent_id);
      if (!subagentSession) {
        return;
      }
      permissionSession = subagentSession;
    }
    const input = permissionSession.toolInputsByCallId.get(message.tool_use_id);
    emitClaudePermissionDeniedToolPart({
      emit,
      session: permissionSession,
      timestamp,
      permission: {
        toolName: message.tool_name,
        toolUseId: message.tool_use_id,
        message: message.message,
        ...(input ? { input } : undefined),
        metadata: {
          source: "permission_denied",
          ...(message.agent_id ? { agentId: message.agent_id } : undefined),
          ...(message.decision_reason_type
            ? { decisionReasonType: message.decision_reason_type }
            : undefined),
          ...(message.decision_reason ? { decisionReason: message.decision_reason } : undefined),
        },
      },
    });
  }
};

const handleSessionStateChanged = ({
  emit,
  message,
  session,
  timestamp,
}: Pick<SdkMessageHandlerInput, "emit" | "session" | "timestamp"> & {
  message: Extract<
    ClaudeSdkMessageProjection,
    { type: "system"; subtype: "session_state_changed" }
  >;
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
  message: ClaudeSdkAssistantMessageProjection;
}): void => {
  emitSupersededTranscriptMessage({ emit, message, session, timestamp });
  const assistantModel = message.message.model ? modelSelection(message.message.model) : undefined;
  const assistantMessage = message.message;
  const content = isUnknownRecord(assistantMessage) ? assistantMessage.content : undefined;
  const text = textFromContentBlocks(content);
  const hasToolUse =
    Array.isArray(content) &&
    content.some(
      (block) => isUnknownRecord(block) && isClaudeToolUseBlockType(readStringProp(block, "type")),
    );
  const stopReason = readStringProp(assistantMessage, "stop_reason");
  const isForwardedSubagentText = isClaudeSubagentTranscriptTarget(session.externalSessionId);
  const hasFinalStopReason = stopReason === "end_turn" || stopReason === "stop_sequence";
  const isPendingSubagentAssistantText =
    text.length > 0 && !hasToolUse && !stopReason && isForwardedSubagentText;
  const isFinalAssistantText =
    text.length > 0 &&
    !hasToolUse &&
    hasFinalStopReason &&
    shouldFinalizeClaudeTurn(
      session.assistantTurnOriginKind,
      hasActiveClaudeBackgroundWork(session) ? 1 : 0,
    );
  const responseId = readStringProp(assistantMessage, "id");
  const assistantMessageId = responseId ?? message.uuid;
  if ((text.length > 0 || hasToolUse) && !isFinalAssistantText && !isPendingSubagentAssistantText) {
    settleClaudeStreamedAssistantText({
      emit,
      ...(responseId ? { preserveMessageId: responseId } : undefined),
      session,
      timestamp,
    });
  }
  if (hasToolUse && text.length > 0) {
    rememberAssistantTextForCurrentTurn(session, text, assistantMessageId, assistantModel);
  }
  if (Array.isArray(content)) {
    for (const [index, block] of content.entries()) {
      if (!isUnknownRecord(block)) {
        continue;
      }
      const type = readStringProp(block, "type");
      if (type === "text" && hasToolUse) {
        const blockText = readStringProp(block, "text");
        if (blockText?.trim()) {
          emit(
            claudeAssistantTextPartEvent({
              externalSessionId: session.externalSessionId,
              messageId: assistantMessageId,
              partId: `${assistantMessageId}:text:${index}`,
              text: blockText,
              timestamp,
            }),
          );
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
          consumeClaudeStreamEmittedToolInput(session, toolUse.callId, toolUse.input)
        ) {
          continue;
        }

        emitClaudePendingToolPart({
          emit,
          fallbackMessageId: assistantMessageId,
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
            part: createClaudeAssistantReasoningPart({
              messageId: assistantMessageId,
              partId: `${assistantMessageId}:thinking:${index}`,
              text: thinkingText,
            }),
          });
        }
      }
    }
  }
  if (text.length > 0) {
    if (hasToolUse) {
      return;
    }
    if (isPendingSubagentAssistantText) {
      rememberAssistantTextForCurrentTurn(session, text, assistantMessageId, assistantModel);
      session.pendingSubagentAssistantMessage = {
        messageId: assistantMessageId,
        text,
        ...(assistantModel ? { model: assistantModel } : undefined),
      };
      return;
    }
    if (isFinalAssistantText) {
      const messageId = assistantMessageId;
      delete session.pendingSubagentAssistantMessage;
      rememberAssistantTextForCurrentTurn(session, text, messageId, assistantModel, true);
      emit({
        type: "assistant_message",
        externalSessionId: session.externalSessionId,
        timestamp,
        messageId,
        message: text,
        ...(assistantModel ? { model: assistantModel } : undefined),
      });
      settleClaudeStreamedAssistantText({
        emit,
        preserveMessageId: messageId,
        session,
        timestamp,
      });
      return;
    }
    rememberAssistantTextForCurrentTurn(session, text, assistantMessageId, assistantModel);
    emit(
      claudeAssistantTextPartEvent({
        externalSessionId: session.externalSessionId,
        messageId: assistantMessageId,
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
  message: ClaudeSdkToolProgressMessageProjection;
}): void => {
  const elapsedMs = Math.max(0, Math.round(message.elapsed_time_seconds * 1000));
  const eventMs = timestampMs(timestamp);
  const startedAtMs = eventMs - elapsedMs;

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
