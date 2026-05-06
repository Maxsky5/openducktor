import type { Part } from "@opencode-ai/sdk/v2/client";
import {
  extractMessageTotalTokens,
  readMessageModelSelection,
  readTextFromParts,
  sanitizeAssistantMessage,
} from "../../message-normalizers";
import { mapPartToAgentStreamPart } from "../../stream-part-mapper";
import type { EventStreamRuntime } from "../shared";
import { emitSessionIdle, markSessionActive } from "../shared";
import {
  getKnownMessageParts,
  hasTerminalStopSignalInParts,
  isAssistantMessage,
  updateMessageMetadata,
} from "./helpers";
import { normalizeLiveSubagentCorrelation } from "./subagent";
import { reconcileUserMessageQueuedStates } from "./user";

export const shouldSuppressAssistantStreamingAfterIdle = (
  runtime: EventStreamRuntime,
  messageId: string,
  roleHint?: string,
): boolean => {
  const session = runtime.getSession(runtime.externalSessionId);
  return Boolean(
    session?.hasIdleSinceActivity &&
      isAssistantMessage(runtime, messageId, roleHint) &&
      session.completedAssistantMessageIds.has(messageId),
  );
};

export const emitAssistantPart = (
  runtime: EventStreamRuntime,
  part: Part,
  roleHint?: string,
  markActive = true,
): boolean => {
  const mapped = mapPartToAgentStreamPart(part);
  if (!mapped) {
    return false;
  }

  const nextMapped =
    mapped.kind === "subagent"
      ? normalizeLiveSubagentCorrelation(runtime, part, mapped, roleHint)
      : mapped;
  if (!nextMapped) {
    return false;
  }

  if (!isAssistantMessage(runtime, nextMapped.messageId, roleHint)) {
    return false;
  }

  if (shouldSuppressAssistantStreamingAfterIdle(runtime, nextMapped.messageId, roleHint)) {
    return false;
  }

  if (markActive) {
    markSessionActive(runtime);
  }

  runtime.emit(runtime.externalSessionId, {
    type: "assistant_part",
    externalSessionId: runtime.externalSessionId,
    timestamp: runtime.now(),
    part: nextMapped,
  });
  return true;
};

export const flushPendingSubagentPartEmissionsForSession = (
  runtime: EventStreamRuntime,
  externalSessionId: string,
): void => {
  const pending = runtime.pendingSubagentPartEmissionsByExternalSessionId.get(externalSessionId);
  if (!pending || pending.length === 0) {
    return;
  }
  runtime.pendingSubagentPartEmissionsByExternalSessionId.delete(externalSessionId);
  for (const emission of pending) {
    emitAssistantPart(runtime, emission.part, emission.roleHint);
  }
};

export const emitKnownAssistantPartsForMessage = (
  runtime: EventStreamRuntime,
  messageId: string,
  roleHint?: string,
  markActive = true,
): void => {
  if (shouldSuppressAssistantStreamingAfterIdle(runtime, messageId, roleHint)) {
    return;
  }

  for (const part of runtime.partsById.values()) {
    if (part.messageID !== messageId) {
      continue;
    }
    emitAssistantPart(runtime, part, roleHint, markActive);
  }
};

export const updateAssistantMessageCompletionState = (
  runtime: EventStreamRuntime,
  messageId: string,
  isCompleted: boolean,
): void => {
  const session = runtime.getSession(runtime.externalSessionId);
  if (!session) {
    return;
  }

  if (!isCompleted && session.completedAssistantMessageIds.has(messageId)) {
    return;
  }

  const previousActiveAssistantMessageId = session.activeAssistantMessageId;
  if (isCompleted) {
    if (session.activeAssistantMessageId === messageId) {
      session.activeAssistantMessageId = null;
    }
    session.completedAssistantMessageIds.add(messageId);
  } else {
    session.activeAssistantMessageId = messageId;
  }

  if (previousActiveAssistantMessageId !== session.activeAssistantMessageId) {
    reconcileUserMessageQueuedStates(runtime);
  }
};

export const maybeEmitCompletedAssistantMessage = (
  runtime: EventStreamRuntime,
  input: {
    messageId: string;
    timestamp?: string;
    info?: unknown;
    hasStopSignal?: boolean;
  },
): boolean => {
  const session = runtime.getSession(runtime.externalSessionId);
  if (!session || !isAssistantMessage(runtime, input.messageId)) {
    return false;
  }

  const assistantParts = getKnownMessageParts(runtime, input.messageId);
  const existingMetadata = session.messageMetadataById.get(input.messageId);
  const totalTokens =
    input.info !== undefined
      ? (extractMessageTotalTokens(input.info, assistantParts) ?? existingMetadata?.totalTokens)
      : existingMetadata?.totalTokens;
  const assistantModel =
    input.info !== undefined
      ? (readMessageModelSelection(input.info) ?? existingMetadata?.model)
      : existingMetadata?.model;
  const hasStopSignal =
    input.hasStopSignal === true ||
    existingMetadata?.hasStopSignal === true ||
    hasTerminalStopSignalInParts(assistantParts, undefined);
  const timestamp = input.timestamp ?? existingMetadata?.timestamp ?? runtime.now();

  updateMessageMetadata(runtime, input.messageId, {
    timestamp,
    ...(assistantModel ? { model: assistantModel } : {}),
    hasStopSignal,
    ...(totalTokens !== undefined ? { totalTokens } : {}),
  });

  if (!hasStopSignal || assistantParts.length === 0) {
    return false;
  }

  const text = readTextFromParts(assistantParts);
  const visible = sanitizeAssistantMessage(text);
  if (visible.length === 0) {
    emitSessionIdle(runtime);
    reconcileUserMessageQueuedStates(runtime);
    return true;
  }

  if (session.emittedAssistantMessageIds.has(input.messageId)) {
    return true;
  }

  runtime.emit(runtime.externalSessionId, {
    type: "assistant_message",
    externalSessionId: runtime.externalSessionId,
    timestamp,
    messageId: input.messageId,
    message: visible,
    ...(typeof totalTokens === "number" ? { totalTokens } : {}),
    ...(assistantModel ? { model: assistantModel } : {}),
  });
  session.emittedAssistantMessageIds.add(input.messageId);

  emitSessionIdle(runtime);
  reconcileUserMessageQueuedStates(runtime);
  return true;
};
