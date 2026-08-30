import { type AgentEvent, type AgentModelSelection, type AgentStreamPart } from "@openducktor/core";
import {
  clearClaudeManualCompaction,
  settleClaudeManualCompactionResult,
} from "./claude-agent-sdk-compaction";
import {
  type ClaudeBackgroundWorkSession,
  type ClaudeEventSession,
  hasActiveClaudeBackgroundWork,
} from "./claude-agent-sdk-event-session";
import { applyClaudeLifecycleEvent } from "./claude-agent-sdk-lifecycle";
import {
  isFailedClaudeResult,
  lifecycleOutcomeForClaudeResult,
} from "./claude-agent-sdk-result-lifecycle";
import { timestampMs } from "./claude-agent-sdk-tool-shapes";
import { createClaudeCompletedToolPart } from "./claude-agent-sdk-transcript-parts";
import type {
  ClaudeManualCompactionState,
  ClaudeSessionActivity,
  ClaudeToolInput,
} from "./claude-agent-sdk-types";
import {
  readClaudeTurnOriginKind,
  shouldFinalizeClaudeTurn,
} from "./claude-agent-sdk-user-messages";
import type { ClaudeSdkResultMessageProjection } from "./claude-agent-sdk-message-projection";

type ClaudeResultEventSession = ClaudeBackgroundWorkSession & {
  acceptedUserMessages?: ClaudeEventSession["acceptedUserMessages"];
  activeManualCompaction?: ClaudeManualCompactionState;
  activity: ClaudeSessionActivity;
  assistantTurnOriginKind?: string;
  externalSessionId: string;
  pendingUserTurnCount?: number;
  lastAssistantTextMessageId?: string;
  lastAssistantText?: string;
  lastAssistantTextFinal?: boolean;
  lastAssistantTextModel?: AgentModelSelection;
  lastAssistantTextTurnIndex?: number;
  model?: AgentModelSelection | undefined;
  streamAssistantMessageIdsByBlockIndex?: Map<number, string>;
  toolInputsByCallId: Map<string, ClaudeToolInput>;
  toolMessageIdsByCallId: Map<string, string>;
  toolNamesByCallId: Map<string, string>;
  toolStartedAtMsByCallId: Map<string, number>;
};

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
  const completedUserTurnIndex = nextCompletedUserTurnIndex(session);
  const originKind = readClaudeTurnOriginKind(message) ?? session.assistantTurnOriginKind;
  const hasActiveBackgroundWork = hasActiveClaudeBackgroundWork(session);
  const shouldFinalize = shouldFinalizeClaudeTurn(originKind, hasActiveBackgroundWork ? 1 : 0);
  delete session.assistantTurnOriginKind;
  const failed = isFailedClaudeResult(message);
  const resultText = message.subtype === "success" ? message.result.trim() : "";
  const handledManualCompaction =
    !failed && settleClaudeManualCompactionResult({ emit, result: resultText, session, timestamp });
  if (!handledManualCompaction && shouldFinalize) {
    emitSuccessfulResultText({ emit, message, session, timestamp, completedUserTurnIndex });
  }
  if (failed) {
    clearClaudeManualCompaction(session);
    const errors = message.subtype === "success" ? [] : message.errors;
    const resultMessage = message.subtype === "success" ? message.result.trim() : "";
    const terminalReason = message.subtype === "success" ? undefined : message.terminal_reason;
    emit({
      type: "turn_error",
      externalSessionId: session.externalSessionId,
      timestamp,
      messageId: message.uuid,
      message:
        errors.length > 0
          ? errors.join("\n")
          : resultMessage || `Claude Agent SDK result failed: ${terminalReason ?? message.subtype}`,
    });
    applyClaudeLifecycleEvent({
      emit,
      session,
      timestamp,
      event: { kind: "result", outcome: "failed" },
    });
    return;
  }
  applyClaudeLifecycleEvent({
    emit,
    session,
    timestamp,
    event: {
      kind: "result",
      outcome: lifecycleOutcomeForClaudeResult(message),
    },
  });
};

const pendingUserTurnCount = (session: ClaudeResultEventSession): number => {
  return session.pendingUserTurnCount ?? 0;
};

const acceptedUserTurnCount = (session: ClaudeResultEventSession): number => {
  return session.acceptedUserMessages?.length ?? 0;
};

const nextCompletedUserTurnIndex = (session: ClaudeResultEventSession): number => {
  const acceptedTurns = acceptedUserTurnCount(session);
  const pendingTurns = pendingUserTurnCount(session);
  return pendingTurns > 0 ? acceptedTurns - pendingTurns + 1 : acceptedTurns;
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
    text: permission.message,
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
    !acceptedTurnHasModel
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
  emit(assistantMessage);
};
