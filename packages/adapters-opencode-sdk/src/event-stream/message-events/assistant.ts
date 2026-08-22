import type { Part } from "@opencode-ai/sdk/v2/client";
import { jsonValueSchema, type JsonValue, hasRuntimeType } from "@openducktor/contracts";
import {
  extractMessageTotalTokens,
  readMessageModelSelection,
  readTextFromParts,
  sanitizeAssistantMessage,
} from "../../message-normalizers";
import {
  isAwaitingRuntimeTurnStart,
  isStreamTurnIdle,
  markStreamTurnActive,
} from "../../session-activity";
import { mapPartToAgentStreamPart } from "../../stream-part-mapper";
import type { EventStreamRuntime } from "../shared";
import { flushPendingSubagentInputEventsForSession, markSessionActive } from "../shared";
import { flushPendingBackgroundTaskResultSubagentParts } from "./background-task-result";
import {
  getKnownMessageParts,
  hasTerminalStopSignalInParts,
  isAssistantMessage,
  updateMessageMetadata,
} from "./helpers";
import { normalizeLiveSubagentCorrelation } from "./subagent";
import { publishUserMessageReadStateChanges } from "./user";

type EmitAssistantPartOptions = {
  linkedSubagentExternalSessionId?: string;
};

export const shouldSuppressAssistantStreamingAfterIdle = (
  runtime: EventStreamRuntime,
  messageId: string,
  roleHint?: string,
): boolean => {
  const { session } = runtime;
  if (!isStreamTurnIdle(session)) {
    return false;
  }
  return (
    isAssistantMessage(runtime, messageId, roleHint) &&
    session.completedAssistantMessageIds.has(messageId)
  );
};

export const emitAssistantPart = (
  runtime: EventStreamRuntime,
  part: Part,
  roleHint?: string,
  markActive = true,
  options: EmitAssistantPartOptions = {},
): boolean => {
  if (!isAssistantMessage(runtime, part.messageID, roleHint)) {
    return false;
  }

  const mapped = mapPartToAgentStreamPart(jsonValueSchema.parse(part));
  if (!mapped) {
    return false;
  }

  const nextMapped =
    mapped.kind === "subagent"
      ? normalizeLiveSubagentCorrelation(
          runtime,
          part,
          mapped,
          roleHint,
          options.linkedSubagentExternalSessionId,
        )
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
  if (nextMapped.kind === "subagent" && nextMapped.externalSessionId) {
    flushPendingBackgroundTaskResultSubagentParts(
      runtime,
      nextMapped.externalSessionId,
      nextMapped.correlationKey,
    );
    flushPendingSubagentInputEventsForSession(runtime, nextMapped.externalSessionId);
  }
  return true;
};

const flushPendingSubagentPartEmissionsForSession = (
  runtime: EventStreamRuntime,
  externalSessionId: string,
): boolean => {
  const pending =
    runtime.session.pendingSubagentPartEmissionsByExternalSessionId.get(externalSessionId);
  if (!pending || pending.length === 0) {
    return false;
  }
  runtime.session.pendingSubagentPartEmissionsByExternalSessionId.delete(externalSessionId);
  let emitted = false;
  for (const emission of pending) {
    emitted =
      emitAssistantPart(runtime, emission.part, emission.roleHint, true, {
        linkedSubagentExternalSessionId: externalSessionId,
      }) || emitted;
  }
  return emitted;
};

const readLinkedSubagentPart = (
  runtime: EventStreamRuntime,
  externalSessionId: string,
): Part | null => {
  const linkedPartId = runtime.session.subagentPartIdByExternalSessionId.get(externalSessionId);
  if (!linkedPartId) {
    return null;
  }

  return runtime.session.partsById.get(linkedPartId) ?? null;
};

export const emitSubagentPartsForSession = (
  runtime: EventStreamRuntime,
  externalSessionId: string,
): boolean => {
  if (flushPendingSubagentPartEmissionsForSession(runtime, externalSessionId)) {
    return true;
  }

  const part = readLinkedSubagentPart(runtime, externalSessionId);
  return part
    ? emitAssistantPart(runtime, part, undefined, false, {
        linkedSubagentExternalSessionId: externalSessionId,
      })
    : false;
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

  for (const part of getKnownMessageParts(runtime, messageId)) {
    emitAssistantPart(runtime, part, roleHint, markActive);
  }
};

export const updateAssistantMessageCompletionState = (
  runtime: EventStreamRuntime,
  messageId: string,
  isCompleted: boolean,
): void => {
  const { session } = runtime;

  const wasCompleted = session.completedAssistantMessageIds.has(messageId);
  if (!isCompleted && wasCompleted) {
    return;
  }

  const previousActiveAssistantMessageId = session.activeAssistantMessageId;
  if (isCompleted) {
    if (isAwaitingRuntimeTurnStart(session)) {
      markStreamTurnActive(session);
    }
    if (session.activeAssistantMessageId === messageId) {
      session.activeAssistantMessageId = null;
    }
    session.completedAssistantMessageIds.add(messageId);
    if (!wasCompleted) {
      session.pendingCompletedAssistantMessageIds.add(messageId);
    }
  } else {
    session.activeAssistantMessageId = messageId;
  }

  if (previousActiveAssistantMessageId !== session.activeAssistantMessageId) {
    publishUserMessageReadStateChanges(runtime);
  }
};

export const maybeEmitCompletedAssistantMessage = (
  runtime: EventStreamRuntime,
  input: {
    messageId: string;
    timestamp?: string;
    info?: JsonValue | undefined;
    hasStopSignal?: boolean;
  },
): boolean => {
  const { session } = runtime;
  if (!isAssistantMessage(runtime, input.messageId)) {
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
    ...(assistantModel ? { model: assistantModel } : undefined),
    hasStopSignal,
    ...(totalTokens !== undefined ? { totalTokens } : undefined),
  });

  if (!hasStopSignal || assistantParts.length === 0 || !isStreamTurnIdle(session)) {
    return false;
  }

  const text = readTextFromParts(assistantParts);
  const visible = sanitizeAssistantMessage(text);
  if (visible.length === 0) {
    session.pendingCompletedAssistantMessageIds.delete(input.messageId);
    return true;
  }

  if (session.emittedAssistantMessageIds.has(input.messageId)) {
    session.pendingCompletedAssistantMessageIds.delete(input.messageId);
    return true;
  }

  runtime.emit(runtime.externalSessionId, {
    type: "assistant_message",
    externalSessionId: runtime.externalSessionId,
    timestamp,
    messageId: input.messageId,
    message: visible,
    ...(hasRuntimeType(totalTokens, "number") ? { totalTokens } : undefined),
    ...(assistantModel ? { model: assistantModel } : undefined),
  });
  session.emittedAssistantMessageIds.add(input.messageId);
  session.pendingCompletedAssistantMessageIds.delete(input.messageId);
  return true;
};

export const emitCompletedAssistantMessages = (runtime: EventStreamRuntime): void => {
  const { session } = runtime;
  for (const messageId of session.pendingCompletedAssistantMessageIds) {
    maybeEmitCompletedAssistantMessage(runtime, { messageId });
  }
};
