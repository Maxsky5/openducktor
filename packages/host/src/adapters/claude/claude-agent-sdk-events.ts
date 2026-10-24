import { emitBackgroundTaskSnapshot } from "./claude-agent-sdk-background-task-events";
import type { AgentEvent, AgentModelSelection } from "@openducktor/core";
import { handleAssistantError, updateRateLimit } from "./claude-agent-sdk-errors";
import { projectClaudeBackgroundTaskEdge } from "./claude-agent-sdk-background-tools";
import { toClaudeSlashCommandCatalog } from "./claude-agent-sdk-catalog";
import { handleClaudeCompactionBoundary } from "./claude-agent-sdk-compaction";
import {
  advanceStreamAssistantMessageIdentity,
  type ClaudeEventSession,
  findClaudeSubagentSessionByAgentId,
  findClaudeSubagentTaskSession,
  rememberAssistantTextForCurrentTurn,
  updateTaskRoutes,
  userTurnIndex,
} from "./claude-agent-sdk-event-session";
import {
  emitClaudeSubagentUserMessage,
  resolveForwardedClaudeSubagentMessage,
} from "./claude-agent-sdk-forwarded-subagent-events";
import { applyClaudeLifecycleEvent, publishClaudeActivity } from "./claude-agent-sdk-lifecycle";
import { claudeReplyDurationMs } from "./claude-agent-sdk-message-timestamp";
import { updateBackgroundTasks, applyTaskEvent } from "./claude-agent-sdk-activity";
import {
  isClaudeMetaStreamMessage,
  isClaudeSyntheticAssistantMessage,
} from "./claude-agent-sdk-local-commands";
import {
  emitClaudePermissionDeniedToolPart,
  emitClaudeDeferredReplyForkPoint,
  handleClaudeResultMessage,
} from "./claude-agent-sdk-result-events";
import {
  emitClaudeRunningToolPart,
  handleClaudeToolProgressMessage,
} from "./claude-agent-sdk-running-tool";
import { handleClaudeStreamEvent } from "./claude-agent-sdk-stream-events";
import { isClaudeSubagentTranscriptTarget } from "./claude-agent-sdk-subagent-transcripts";
import { handleClaudeSubagentSystemMessage } from "./claude-agent-sdk-subagents";
import { parseClaudeUserToolResultIngress } from "./claude-agent-sdk-ingress-schemas";
import {
  clearClaudeStreamToolInputs,
  consumeClaudeStreamEmittedToolInput,
} from "./claude-agent-sdk-tool-input-stream";
import { handleClaudeUserToolResultMessage } from "./claude-agent-sdk-tool-results";
import { decodeClaudeToolUseBlock, isClaudeToolUseBlockType } from "./claude-agent-sdk-tool-shapes";
import {
  claudeAssistantTextPartEvent,
  projectClaudeAssistantBlock,
} from "./claude-agent-sdk-transcript-parts";
import {
  emitRetractedTranscriptMessages,
  emitSupersededTranscriptMessage,
  settleClaudeStreamedAssistantText,
} from "./claude-agent-sdk-transcript-retractions";
import { isClaudeWakeUserMessage } from "./claude-agent-sdk-user-messages";
import { readStringProp, textFromContentBlocks } from "./claude-agent-sdk-utils";
import type {
  ClaudeSdkAssistantMessageProjection,
  ClaudeSdkMessageProjection,
} from "./claude-agent-sdk-message-projection";

type SdkMessageHandlerInput = {
  emit: (event: AgentEvent) => void;
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
  if (message.type === "rate_limit_event") {
    updateRateLimit({ info: message.rate_limit_info, session, emit, timestamp });
    return;
  }
  // Restores and SDK echoes can replay a prompt after its turn has settled.
  if (
    message.type === "user" &&
    (("isReplay" in message && message.isReplay) || isClaudeMetaStreamMessage(messageValue))
  ) {
    return;
  }
  if (message.type === "system" && (message.subtype === "init" || message.subtype === "status")) {
    const mode = message.permissionMode;
    if (mode && mode !== session.appliedPermissionMode) {
      const previousMode = session.appliedPermissionMode;
      session.appliedPermissionMode = mode;
      const requestedMode = session.requestedPermissionMode;
      const messageId = `claude-permission-mode:${session.externalSessionId}`;
      if (requestedMode && mode !== requestedMode) {
        emit({
          type: "session_policy_notice",
          externalSessionId: session.externalSessionId,
          timestamp,
          messageId,
          message: `Claude permission mode '${requestedMode}' was requested, but Claude reports '${mode}'. Check your Claude permission settings.`,
        });
      } else if (requestedMode && previousMode && previousMode !== requestedMode) {
        emit({
          type: "transcript_retracted",
          externalSessionId: session.externalSessionId,
          timestamp,
          messageIds: [messageId],
        });
      }
    }
    if (message.subtype === "init") return;
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
  const isRootSession = !isClaudeSubagentTranscriptTarget(session.externalSessionId);
  if (message.type === "assistant") {
    if (!message.error && isClaudeSyntheticAssistantMessage(messageValue)) {
      return;
    }
    if (isRootSession && message.parent_tool_use_id === null) {
      applyClaudeLifecycleEvent({ emit, session, timestamp, event: { kind: "sdk_turn_started" } });
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
    if (userToolResultMessage.turnOriginKind === "human") delete session.wakeStartedAt;
    if (isRootSession && isClaudeWakeUserMessage(message, userToolResultMessage)) {
      session.wakeStartedAt = timestamp;
      delete session.lastAssistantNativeUuid;
      delete session.lastAssistantNativeUuidTurnIndex;
      delete session.lastAssistantTextMessageId;
      delete session.lastAssistantText;
      delete session.lastAssistantTextFinal;
      delete session.lastAssistantTextModel;
      delete session.lastAssistantTextDurationMs;
      delete session.lastAssistantTextTurnIndex;
      session.sdkInitiatedTurnActive = true;
      applyClaudeLifecycleEvent({ emit, session, timestamp, event: { kind: "sdk_turn_started" } });
    }
    emitClaudeSubagentUserMessage({ emit, message, session, timestamp });
    handleClaudeUserToolResultMessage({ emit, message, session, timestamp });
    return;
  }
  if (message.type === "stream_event") {
    if (isRootSession && message.parent_tool_use_id === null) {
      applyClaudeLifecycleEvent({ emit, session, timestamp, event: { kind: "sdk_turn_started" } });
    }
    handleClaudeStreamEvent({ emit, message, session, timestamp });
    return;
  }
  if (message.type === "result") {
    if (
      session.completedNativeResultIds?.has(message.uuid) ||
      (message.result_index !== undefined &&
        session.lastNativeResultIndex !== undefined &&
        message.result_index <= session.lastNativeResultIndex)
    )
      return;
    clearClaudeStreamToolInputs(session);
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
    handleClaudeToolProgressMessage({ emit, message, session, timestamp });
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
  if (message.type === "system" && message.subtype === "background_tasks_changed") {
    updateBackgroundTasks(session, message);
    updateTaskRoutes(session, message.tasks);
    emitBackgroundTaskSnapshot({ emit, message, session, timestamp });
    publishClaudeActivity({ emit, session, timestamp });
    return;
  }
  if (
    message.type === "system" &&
    (message.subtype === "task_started" ||
      message.subtype === "task_progress" ||
      message.subtype === "task_updated" ||
      message.subtype === "task_notification")
  ) {
    if (!applyTaskEvent(session, message)) return;
    const taskSession =
      findClaudeSubagentTaskSession(
        session,
        readStringProp(messageValue, "tool_use_id"),
        message.task_id,
      ) ??
      ("parent_task_id" in message && message.parent_task_id
        ? findClaudeSubagentSessionByAgentId(session, message.parent_task_id)
        : null) ??
      session;
    const backgroundPart = projectClaudeBackgroundTaskEdge(
      taskSession,
      message,
      timestamp,
      session.backgroundToolCallIdsSinceSnapshot ? session.backgroundToolActiveTaskIds : undefined,
    );
    if (taskSession !== session) {
      projectClaudeBackgroundTaskEdge(session, message, timestamp);
    }
    if (backgroundPart) {
      emit({
        type: "assistant_part",
        externalSessionId: taskSession.externalSessionId,
        timestamp,
        part: backgroundPart,
      });
    }
    handleClaudeSubagentSystemMessage({ emit, message, session: taskSession, timestamp });
    publishClaudeActivity({ emit, session, timestamp });
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
    const permissionMetadata: NonNullable<
      Parameters<typeof emitClaudePermissionDeniedToolPart>[0]["permission"]["metadata"]
    > = { source: "permission_denied" };
    const permission: Parameters<typeof emitClaudePermissionDeniedToolPart>[0]["permission"] = {
      toolName: message.tool_name,
      toolUseId: message.tool_use_id,
      message: message.message,
      metadata: permissionMetadata,
    };
    if (input) {
      permission.input = input;
    }
    if (message.agent_id) {
      permissionMetadata.agentId = message.agent_id;
    }
    if (message.decision_reason_type) {
      permissionMetadata.decisionReasonType = message.decision_reason_type;
    }
    if (message.decision_reason) {
      permissionMetadata.decisionReason = message.decision_reason;
    }
    emitClaudePermissionDeniedToolPart({
      emit,
      session: permissionSession,
      timestamp,
      permission,
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
  const awaitedIdle = session.resultAwaitsSdkIdle === true;
  applyClaudeLifecycleEvent({
    emit,
    session,
    timestamp,
    event: {
      kind: "sdk_state",
      state: message.state,
    },
  });
  if (awaitedIdle && message.state === "idle" && session.activity === "idle") {
    emitClaudeDeferredReplyForkPoint({ emit, session, timestamp });
  }
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
  if (message.error) {
    handleAssistantError({ emit, message, session, timestamp });
    return;
  }
  delete session.lastError;
  delete session.usageReset;
  session.lastAssistantNativeUuid = message.uuid;
  session.lastAssistantNativeUuidTurnIndex = userTurnIndex(session);
  const assistantModel = message.message.model ? modelSelection(message.message.model) : undefined;
  const assistantMessage = message.message;
  const content = assistantMessage.content;
  const text = textFromContentBlocks(content);
  const hasToolUse =
    Array.isArray(content) &&
    content.some((block) => isClaudeToolUseBlockType(readStringProp(block, "type")));
  const stopReason = readStringProp(assistantMessage, "stop_reason");
  const isForwardedSubagentText = isClaudeSubagentTranscriptTarget(session.externalSessionId);
  const hasFinalStopReason = stopReason === "end_turn" || stopReason === "stop_sequence";
  const isPendingSubagentAssistantText =
    text.length > 0 && !hasToolUse && !stopReason && isForwardedSubagentText;
  const isFinalAssistantText = text.length > 0 && !hasToolUse && hasFinalStopReason;
  const responseId = readStringProp(assistantMessage, "id");
  const assistantMessageId = responseId ?? message.uuid;
  if ((text.length > 0 || hasToolUse) && !isFinalAssistantText && !isPendingSubagentAssistantText) {
    const settleInput: Parameters<typeof settleClaudeStreamedAssistantText>[0] = {
      emit,
      session,
      timestamp,
    };
    if (responseId) {
      settleInput.preserveMessageId = responseId;
    }
    settleClaudeStreamedAssistantText(settleInput);
  }
  if (hasToolUse && text.length > 0) {
    rememberAssistantTextForCurrentTurn(session, text, assistantMessageId, assistantModel);
  }
  if (Array.isArray(content)) {
    for (const [index, block] of content.entries()) {
      const part = projectClaudeAssistantBlock({
        block,
        index,
        messageId: assistantMessageId,
        hasToolUse,
      });
      if (part && (part.kind !== "text" || hasToolUse)) {
        emit({
          type: "assistant_part",
          externalSessionId: session.externalSessionId,
          timestamp,
          part,
        });
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

        emitClaudeRunningToolPart({
          emit,
          fallbackMessageId: assistantMessageId,
          session,
          timestamp,
          toolUse,
        });
      }
    }
  }
  if (text.length > 0) {
    if (hasToolUse) {
      return;
    }
    if (isPendingSubagentAssistantText) {
      rememberAssistantTextForCurrentTurn(session, text, assistantMessageId, assistantModel);
      const pendingMessage: NonNullable<ClaudeEventSession["pendingSubagentAssistantMessage"]> = {
        messageId: assistantMessageId,
        text,
      };
      if (assistantModel) {
        pendingMessage.model = assistantModel;
      }
      session.pendingSubagentAssistantMessage = pendingMessage;
      return;
    }
    if (isFinalAssistantText) {
      const messageId = assistantMessageId;
      delete session.pendingSubagentAssistantMessage;
      rememberAssistantTextForCurrentTurn(session, text, messageId, assistantModel, true);
      const event: Extract<AgentEvent, { type: "assistant_message" }> = {
        type: "assistant_message",
        externalSessionId: session.externalSessionId,
        timestamp,
        messageId,
        message: text,
      };
      if (assistantModel) {
        event.model = assistantModel;
      }
      const durationMs = claudeReplyDurationMs(session.wakeStartedAt, timestamp);
      if (durationMs !== undefined) {
        event.durationMs = durationMs;
        session.lastAssistantTextDurationMs = durationMs;
      }
      emit(event);
      settleClaudeStreamedAssistantText({
        emit,
        preserveMessageId: messageId,
        session,
        timestamp,
      });
      return;
    }
    rememberAssistantTextForCurrentTurn(session, text, assistantMessageId, assistantModel);
    const durationMs = claudeReplyDurationMs(session.wakeStartedAt, timestamp);
    if (durationMs !== undefined) session.lastAssistantTextDurationMs = durationMs;
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
