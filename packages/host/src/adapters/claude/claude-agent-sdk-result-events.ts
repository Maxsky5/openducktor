import { type AgentEvent, type AgentModelSelection, type AgentStreamPart } from "@openducktor/core";
import type { ErrorState } from "./claude-agent-sdk-errors";
import {
  clearClaudeManualCompaction,
  settleClaudeManualCompactionResult,
} from "./claude-agent-sdk-compaction";
import {
  type ClaudeBackgroundWorkSession,
  type ClaudeEventSession,
  hasActiveClaudeBackgroundWork,
  userTurnIndex,
} from "./claude-agent-sdk-event-session";
import { applyClaudeLifecycleEvent } from "./claude-agent-sdk-lifecycle";
import {
  isClaudeResultStoppedBySteer,
  isFailedClaudeResult,
  lifecycleOutcomeForClaudeResult,
} from "./claude-agent-sdk-result-lifecycle";
import { timestampMs } from "./claude-agent-sdk-tool-shapes";
import { createClaudeCompletedToolPart } from "./claude-agent-sdk-transcript-parts";
import type { ClaudeToolInput } from "./claude-agent-sdk-types";
import { disabledToolReason } from "./claude-tool-availability";
import {
  readClaudeTurnOriginKind,
  shouldFinalizeClaudeTurn,
} from "./claude-agent-sdk-user-messages";
import type { ClaudeSdkResultMessageProjection } from "./claude-agent-sdk-message-projection";
import { isClaudeSubagentTranscriptTarget } from "./claude-agent-sdk-subagent-transcripts";

type ClaudeResultEventSession = ClaudeBackgroundWorkSession &
  ErrorState & {
    streamAssistantMessageIdsByBlockIndex?: Map<number, string>;
  } & Pick<
    ClaudeEventSession,
    | "acceptedUserMessages"
    | "disabledTools"
    | "activeManualCompaction"
    | "activity"
    | "assistantTurnOriginKind"
    | "externalSessionId"
    | "pendingUserTurnCount"
    | "lastAssistantTextMessageId"
    | "lastAssistantText"
    | "lastAssistantTextFinal"
    | "lastAssistantTextModel"
    | "lastAssistantTextTurnIndex"
    | "lastSuccessfulResultTurnIndex"
    | "lastAssistantNativeUuid"
    | "lastAssistantNativeUuidTurnIndex"
    | "completedReplyChainIds"
    | "model"
    | "toolInputsByCallId"
    | "toolMessageIdsByCallId"
    | "toolNamesByCallId"
    | "toolStartedAtMsByCallId"
    | "unreadSteeredUserMessages"
  >;

type ClaudeResultEventInput = {
  emit: (event: AgentEvent) => void;
  message: ClaudeSdkResultMessageProjection;
  session: ClaudeResultEventSession;
  timestamp: string;
};

type PermissionDeniedToolPartInput = {
  emit: (event: AgentEvent) => void;
  permission: {
    toolName: string;
    toolUseId: string;
    input?: ClaudeToolInput;
    message: string;
    metadata?: Extract<AgentStreamPart, { kind: "tool" }>["metadata"];
  };
  session: ClaudeResultEventSession;
  timestamp: string;
};

export const handleClaudeResultMessage = ({
  emit,
  message,
  session,
  timestamp,
}: ClaudeResultEventInput): void => {
  session.completedNativeResultIds ??= new Set();
  if (session.completedNativeResultIds.has(message.uuid)) return;
  const completedUserTurnIndex = userTurnIndex(session);
  const originKind = readClaudeTurnOriginKind(message) ?? session.assistantTurnOriginKind;
  const hasActiveBackgroundWork = hasActiveClaudeBackgroundWork(session);
  const shouldFinalize = shouldFinalizeClaudeTurn(originKind, hasActiveBackgroundWork ? 1 : 0);
  delete session.assistantTurnOriginKind;
  const failed = isFailedClaudeResult(message);
  const lifecycleOutcome = lifecycleOutcomeForClaudeResult(message);
  const resultText = message.subtype === "success" ? message.result.trim() : "";
  const handledManualCompaction =
    !failed && settleClaudeManualCompactionResult({ emit, result: resultText, session, timestamp });
  if (!handledManualCompaction && shouldFinalize) {
    emitSuccessfulResultText({ emit, message, session, timestamp, completedUserTurnIndex });
  }
  if (!failed && !handledManualCompaction && shouldFinalize && lifecycleOutcome === "completed") {
    // A tool-only result carries no assistant text, so the turn index is the only
    // record that the latest accepted turn finished.
    session.lastSuccessfulResultTurnIndex = completedUserTurnIndex;
    if (resultText.length === 0) {
      emitFinalAssistantMarker({ emit, message, session, timestamp });
    }
  }
  if (isClaudeResultStoppedBySteer(message, (session.unreadSteeredUserMessages?.size ?? 0) > 0)) {
    return;
  }
  session.completedNativeResultIds.add(message.uuid);
  if (message.result_index !== undefined) session.lastNativeResultIndex = message.result_index;
  const consumedIds = new Set(session.foregroundMessageIds);
  for (const messageId of message.user_message_uuids ??
    (message.user_message_uuid ? [message.user_message_uuid] : [])) {
    consumedIds.add(messageId);
  }
  const acceptedIds = new Set(session.acceptedUserMessages?.map((accepted) => accepted.messageId));
  const messageIds = [...consumedIds].filter(
    (messageId) =>
      session.nativeCommandStates?.get(messageId) !== "result" &&
      (acceptedIds.has(messageId) || session.nativeSubmittedMessageIds?.has(messageId)),
  );
  session.nativeCommandStates ??= new Map();
  for (const messageId of messageIds) session.nativeCommandStates.set(messageId, "result");
  session.foregroundMessageIds?.clear();
  const consumedMessageCount = messageIds.filter((messageId) => acceptedIds.has(messageId)).length;
  if (failed) {
    clearClaudeManualCompaction(session);
    const errors = message.subtype === "success" ? [] : message.errors;
    const terminalReason = message.subtype === "success" ? undefined : message.terminal_reason;
    const lastError =
      session.lastError?.turnIndex === completedUserTurnIndex ? session.lastError : undefined;
    const turnError: Extract<AgentEvent, { type: "turn_error" }> = {
      type: "turn_error",
      externalSessionId: session.externalSessionId,
      timestamp,
      messageId: lastError?.messageId ?? message.uuid,
      message:
        errors.length > 0
          ? errors.join("\n")
          : resultText || `Claude Agent SDK result failed: ${terminalReason ?? message.subtype}`,
    };
    if (lastError?.usageLimit) turnError.usageLimit = lastError.usageLimit;
    if (lastError) lastError.message = turnError.message;
    emit(turnError);
    emit({
      type: "session_turn_finished",
      externalSessionId: session.externalSessionId,
      timestamp,
      completionId: message.uuid,
      messageIds,
      turnOutcome: "failed",
    });
    applyClaudeLifecycleEvent({
      emit,
      session,
      timestamp,
      event: { kind: "result", outcome: "failed", consumedMessageCount },
    });
    return;
  }
  emit({
    type: "session_turn_finished",
    externalSessionId: session.externalSessionId,
    timestamp,
    completionId: message.uuid,
    messageIds,
    turnOutcome: "completed",
  });
  applyClaudeLifecycleEvent({
    emit,
    session,
    timestamp,
    event: {
      kind: "result",
      outcome: lifecycleOutcome,
      consumedMessageCount,
    },
  });
};

export const emitClaudePermissionDeniedToolPart = ({
  emit,
  permission,
  session,
  timestamp,
}: PermissionDeniedToolPartInput): void => {
  const cachedInput = session.toolInputsByCallId.get(permission.toolUseId);
  const input = permission.input ?? cachedInput;
  const messageId =
    session.toolMessageIdsByCallId.get(permission.toolUseId) ??
    `permission-denied:${permission.toolUseId}`;
  const toolName = session.toolNamesByCallId.get(permission.toolUseId) ?? permission.toolName;
  session.toolMessageIdsByCallId.set(permission.toolUseId, messageId);
  session.toolNamesByCallId.set(permission.toolUseId, toolName);
  if (input) {
    session.toolInputsByCallId.set(permission.toolUseId, input);
  }
  const startedAtMs = session.toolStartedAtMsByCallId.get(permission.toolUseId);
  const completedToolInput: Parameters<typeof createClaudeCompletedToolPart>[0] = {
    callId: permission.toolUseId,
    endedAtMs: timestampMs(timestamp),
    isError: true,
    messageId,
    text: session.disabledTools?.has(toolName)
      ? `${disabledToolReason(toolName)}\n${permission.message}`
      : permission.message,
    tool: toolName,
  };
  if (input) {
    completedToolInput.input = input;
  }
  if (permission.metadata) {
    completedToolInput.metadata = permission.metadata;
  }
  if (startedAtMs !== undefined) {
    completedToolInput.startedAtMs = startedAtMs;
  }
  emit({
    type: "assistant_part",
    externalSessionId: session.externalSessionId,
    timestamp,
    part: createClaudeCompletedToolPart(completedToolInput),
  });
};

export const emitClaudeDeferredReplyForkPoint = (input: {
  session: ClaudeResultEventSession;
  emit: (event: AgentEvent) => void;
  timestamp: string;
}): void => {
  const { session } = input;
  if (
    !session.lastAssistantTextMessageId ||
    !session.lastAssistantTextFinal ||
    !session.lastAssistantText
  )
    return;
  const message: Extract<AgentEvent, { type: "assistant_message" }> = {
    type: "assistant_message",
    externalSessionId: session.externalSessionId,
    timestamp: input.timestamp,
    messageId: session.lastAssistantTextMessageId,
    message: session.lastAssistantText,
  };
  if (session.lastAssistantTextModel) message.model = session.lastAssistantTextModel;
  attachClaudeCompletedReplyForkPoint(session, message, session.lastAssistantTextTurnIndex ?? -1);
  if (message.forkPoint) input.emit(message);
};

const streamedTextMessageIds = (session: ClaudeResultEventSession): string[] =>
  session.streamAssistantMessageIdsByBlockIndex
    ? [...new Set(session.streamAssistantMessageIdsByBlockIndex.values())]
    : [];

const resultModelForCompletedTurn = (
  session: ClaudeResultEventSession,
  completedUserTurnIndex: number,
  duplicatesAssistantTextFromSameTurn: boolean,
): AgentModelSelection | undefined => {
  const acceptedMessage = session.acceptedUserMessages?.[completedUserTurnIndex - 1];
  const acceptedModel = acceptedMessage?.model;
  const completedAssistantModel = duplicatesAssistantTextFromSameTurn
    ? session.lastAssistantTextModel
    : undefined;
  if (!acceptedModel) {
    return completedAssistantModel ?? session.model;
  }
  if (!completedAssistantModel) {
    return acceptedModel;
  }
  return {
    ...acceptedModel,
    modelId: completedAssistantModel.modelId,
  };
};

const emitFinalAssistantMarker = ({
  emit,
  message,
  session,
  timestamp,
}: ClaudeResultEventInput): void => {
  // The empty final assistant message keeps a text-less turn terminal for transcript
  // readers, such as the resume affordance and the settled-turn cleanup.
  emit({
    type: "assistant_message",
    externalSessionId: session.externalSessionId,
    timestamp,
    messageId: message.uuid,
    message: "",
  });
};

const emitSuccessfulResultText = ({
  completedUserTurnIndex,
  emit,
  message,
  session,
  timestamp,
}: ClaudeResultEventInput & { completedUserTurnIndex: number }): void => {
  if (message.subtype !== "success" || message.is_error) {
    return;
  }
  if (isFailedClaudeResult(message)) {
    return;
  }
  const text = message.result.trim();
  const duplicatesAssistantTextFromSameTurn =
    text === session.lastAssistantText &&
    session.lastAssistantTextTurnIndex === completedUserTurnIndex;
  if (!text) {
    return;
  }
  const resultModel = resultModelForCompletedTurn(
    session,
    completedUserTurnIndex,
    duplicatesAssistantTextFromSameTurn,
  );
  const acceptedTurn = session.acceptedUserMessages?.[completedUserTurnIndex - 1];
  const acceptedTurnHasModel = acceptedTurn?.model !== undefined;
  if (
    duplicatesAssistantTextFromSameTurn &&
    session.lastAssistantTextFinal &&
    !acceptedTurnHasModel &&
    (isClaudeSubagentTranscriptTarget(session.externalSessionId) ||
      lifecycleOutcomeForClaudeResult(message) !== "completed" ||
      !session.lastAssistantNativeUuid ||
      session.lastAssistantNativeUuidTurnIndex !== completedUserTurnIndex)
  ) {
    return;
  }
  const streamedMessageIds = streamedTextMessageIds(session);
  const streamedMessageId = streamedMessageIds[0];
  const messageId =
    streamedMessageId ??
    (duplicatesAssistantTextFromSameTurn ? session.lastAssistantTextMessageId : undefined) ??
    message.uuid;
  if (!duplicatesAssistantTextFromSameTurn) {
    session.lastAssistantTextMessageId = messageId;
    session.lastAssistantText = text;
    session.lastAssistantTextTurnIndex = completedUserTurnIndex;
  }
  session.lastAssistantTextFinal = true;
  if (streamedMessageIds.length > 1) {
    emit({
      type: "transcript_retracted",
      externalSessionId: session.externalSessionId,
      timestamp,
      messageIds: streamedMessageIds.slice(1),
    });
  }
  const assistantMessage: Extract<AgentEvent, { type: "assistant_message" }> = {
    type: "assistant_message",
    externalSessionId: session.externalSessionId,
    timestamp,
    messageId,
    message: text,
  };
  if (resultModel) {
    assistantMessage.model = resultModel;
  }
  if (lifecycleOutcomeForClaudeResult(message) === "completed") {
    attachClaudeCompletedReplyForkPoint(session, assistantMessage, completedUserTurnIndex);
  }
  emit(assistantMessage);
};

const attachClaudeCompletedReplyForkPoint = (
  session: ClaudeResultEventSession,
  message: Extract<AgentEvent, { type: "assistant_message" }>,
  completedUserTurnIndex: number,
): void => {
  if (
    isClaudeSubagentTranscriptTarget(session.externalSessionId) ||
    !session.lastAssistantNativeUuid ||
    session.lastAssistantNativeUuidTurnIndex !== completedUserTurnIndex
  )
    return;
  message.forkPoint = { messageId: message.messageId };
  session.completedReplyChainIds ??= new Map();
  session.completedReplyChainIds.set(message.messageId, session.lastAssistantNativeUuid);
};
