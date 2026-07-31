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
} from "./claude-agent-sdk-result-lifecycle";
import { timestampMs } from "./claude-agent-sdk-tool-shapes";
import { createClaudeCompletedToolPart } from "./claude-agent-sdk-transcript-parts";
import type { ClaudeManualCompactionState, ClaudeSessionActivity } from "./claude-agent-sdk-types";
import {
  readClaudeTurnOriginKind,
  shouldFinalizeClaudeTurn,
} from "./claude-agent-sdk-user-messages";

type ClaudeResultEventSession = {
  acceptedUserMessages?: readonly unknown[];
  activeBackgroundSubagentTaskIds?: Set<string>;
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
  const originKind = readClaudeTurnOriginKind(message) ?? session.assistantTurnOriginKind;
  const shouldFinalize = shouldFinalizeClaudeTurn(
    originKind,
    session.activeBackgroundSubagentTaskIds?.size ?? 0,
  );
  delete session.assistantTurnOriginKind;
  const failed = isFailedClaudeResult(message);
  const resultText =
    "result" in message && typeof message.result === "string" ? message.result.trim() : "";
  const handledManualCompaction =
    !failed && settleClaudeManualCompactionResult({ emit, result: resultText, session, timestamp });
  if (!handledManualCompaction && shouldFinalize) {
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
    ? [...new Set(session.streamAssistantMessageIdsByBlockIndex.values())]
    : [];

const resultModelForCompletedTurn = (
  session: ClaudeResultEventSession,
  completedUserTurnIndex: number,
  duplicatesAssistantTextFromSameTurn: boolean,
): AgentModelSelection | undefined => {
  const acceptedMessage = session.acceptedUserMessages?.[completedUserTurnIndex - 1] as
    | { model?: AgentModelSelection }
    | undefined;
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
  const acceptedTurn = session.acceptedUserMessages?.[completedUserTurnIndex - 1] as
    | { model?: unknown }
    | undefined;
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
  emit({
    type: "assistant_message",
    externalSessionId: session.externalSessionId,
    timestamp,
    messageId,
    message: text,
    ...(resultModel ? { model: resultModel } : {}),
  });
};
