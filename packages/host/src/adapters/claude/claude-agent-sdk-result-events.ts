import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { AgentEvent, AgentModelSelection } from "@openducktor/core";
import {
  clearClaudeManualCompaction,
  settleClaudeManualCompactionResult,
} from "./claude-agent-sdk-compaction";
import { applyClaudeLifecycleEvent } from "./claude-agent-sdk-lifecycle";
import {
  isFailedClaudeResult,
  lifecycleOutcomeForClaudeResult,
  readClaudeResultDurationMs,
} from "./claude-agent-sdk-result-lifecycle";
import { timestampMs } from "./claude-agent-sdk-tool-shapes";
import { createClaudeCompletedToolPart } from "./claude-agent-sdk-transcript-parts";
import type { ClaudeManualCompactionState, ClaudeSessionActivity } from "./claude-agent-sdk-types";

type ClaudeResultEventSession = {
  acceptedUserMessages?: readonly unknown[];
  activeManualCompaction?: ClaudeManualCompactionState;
  activity: ClaudeSessionActivity;
  externalSessionId: string;
  pendingUserTurnCount?: number;
  lastAssistantText?: string;
  lastAssistantTextTurnIndex?: number;
  model?: AgentModelSelection | undefined;
  streamAssistantMessageIdsByBlockIndex?: Map<number, string>;
  toolInputsByCallId: Map<string, Record<string, unknown>>;
  toolMessageIdsByCallId: Map<string, string>;
  toolNamesByCallId: Map<string, string>;
  toolStartedAtMsByCallId: Map<string, number>;
};

type ClaudeResultEventInput = {
  emit: (event: AgentEvent) => void;
  message: Extract<SDKMessage, { type: "result" }>;
  session: ClaudeResultEventSession;
  timestamp: string;
};

type PermissionDeniedToolPartInput = {
  emit: (event: AgentEvent) => void;
  permission: {
    toolName: string;
    toolUseId: string;
    input?: Record<string, unknown>;
    message: string;
    metadata?: Record<string, unknown>;
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
  const failed = isFailedClaudeResult(message);
  const resultText =
    "result" in message && typeof message.result === "string" ? message.result.trim() : "";
  const handledManualCompaction =
    !failed && settleClaudeManualCompactionResult({ emit, result: resultText, session, timestamp });
  if (!handledManualCompaction) {
    emitSuccessfulResultText({ emit, message, session, timestamp, completedUserTurnIndex });
  }
  if (failed) {
    clearClaudeManualCompaction(session);
    const errors = "errors" in message && Array.isArray(message.errors) ? message.errors : [];
    const resultMessage =
      "result" in message && typeof message.result === "string" ? message.result.trim() : "";
    const terminalReason =
      "terminal_reason" in message && typeof message.terminal_reason === "string"
        ? message.terminal_reason
        : undefined;
    emit({
      type: "session_error",
      externalSessionId: session.externalSessionId,
      timestamp,
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
  return typeof session.pendingUserTurnCount === "number" ? session.pendingUserTurnCount : 0;
};

const acceptedUserTurnCount = (session: ClaudeResultEventSession): number => {
  return Array.isArray(session.acceptedUserMessages) ? session.acceptedUserMessages.length : 0;
};

const nextCompletedUserTurnIndex = (session: ClaudeResultEventSession): number => {
  const acceptedTurns = acceptedUserTurnCount(session);
  const pendingTurns = pendingUserTurnCount(session);
  return pendingTurns > 0 ? acceptedTurns - pendingTurns + 1 : acceptedTurns;
};

const streamedTextMessageIds = (session: ClaudeResultEventSession): string[] =>
  session.streamAssistantMessageIdsByBlockIndex
    ? [...session.streamAssistantMessageIdsByBlockIndex.values()]
    : [];

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
  emit({
    type: "assistant_part",
    externalSessionId: session.externalSessionId,
    timestamp,
    part: createClaudeCompletedToolPart({
      callId: permission.toolUseId,
      endedAtMs: timestampMs(timestamp),
      isError: true,
      messageId,
      text: permission.message,
      tool: toolName,
      ...(input ? { input } : {}),
      ...(permission.metadata ? { metadata: permission.metadata } : {}),
      ...(typeof startedAtMs === "number" ? { startedAtMs } : {}),
    }),
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
  const text = typeof message.result === "string" ? message.result.trim() : "";
  const durationMs = readClaudeResultDurationMs(message);
  const duplicatesAssistantTextFromSameTurn =
    text === session.lastAssistantText &&
    session.lastAssistantTextTurnIndex === completedUserTurnIndex;
  if (!text || (duplicatesAssistantTextFromSameTurn && durationMs === undefined)) {
    return;
  }
  if (!duplicatesAssistantTextFromSameTurn) {
    session.lastAssistantText = text;
    session.lastAssistantTextTurnIndex = completedUserTurnIndex;
  }
  const streamedMessageIds = streamedTextMessageIds(session);
  const streamedMessageId = streamedMessageIds[0];
  if (streamedMessageIds.length > 1) {
    emit({
      type: "transcript_retracted",
      externalSessionId: session.externalSessionId,
      timestamp,
      messageIds: streamedMessageIds.slice(1),
    });
  }
  emit({
    type: "assistant_message",
    externalSessionId: session.externalSessionId,
    timestamp,
    messageId: streamedMessageId ?? message.uuid,
    message: text,
    ...(durationMs !== undefined ? { durationMs } : {}),
    ...(session.model ? { model: session.model } : {}),
  });
};
