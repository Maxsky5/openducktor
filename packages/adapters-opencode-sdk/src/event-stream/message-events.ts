import type { Event, Part } from "@opencode-ai/sdk/v2/client";
import type { AgentUserMessageState } from "@openducktor/core";
import {
  asUnknownRecord,
  readArrayProp,
  readRecordProp,
  readStringProp,
  readUnknownProp,
  type UnknownRecord,
} from "../guards";
import {
  extractMessageTotalTokens,
  readMessageModelSelection,
  readTextFromMessageInfo,
  readTextFromParts,
  sanitizeAssistantMessage,
} from "../message-normalizers";
import { toIsoFromEpoch } from "../session-runtime-utils";
import { mapPartToAgentStreamPart } from "../stream-part-mapper";
import {
  readEventInfo,
  readEventPart,
  readEventProperties,
  readMessageCompletedAt,
} from "./schemas";
import type { EventStreamRuntime } from "./shared";
import {
  applyDeltaToPart,
  emitSessionIdle,
  isReasoningDeltaField,
  markSessionActive,
} from "./shared";

const emitAssistantPart = (
  runtime: EventStreamRuntime,
  part: Part,
  roleHint?: string,
  markActive = true,
): boolean => {
  const mapped = mapPartToAgentStreamPart(part);
  if (!mapped) {
    return false;
  }

  const mappedRole = roleHint ?? runtime.messageRoleById.get(mapped.messageId);
  if (mappedRole !== "assistant") {
    return false;
  }

  if (shouldPreserveIdleForCompletedAssistantMessage(runtime, mapped.messageId, mappedRole)) {
    return false;
  }

  if (markActive) {
    markSessionActive(runtime);
  }

  runtime.emit(runtime.sessionId, {
    type: "assistant_part",
    sessionId: runtime.sessionId,
    timestamp: runtime.now(),
    part: mapped,
  });
  return true;
};

const emitKnownAssistantPartsForMessage = (
  runtime: EventStreamRuntime,
  messageId: string,
  roleHint?: string,
  markActive = true,
): void => {
  for (const part of runtime.partsById.values()) {
    if (part.messageID !== messageId) {
      continue;
    }
    emitAssistantPart(runtime, part, roleHint, markActive);
  }
};

const applyPendingDeltas = (runtime: EventStreamRuntime, partId: string, basePart: Part): Part => {
  const pendingDeltas = runtime.pendingDeltasByPartId.get(partId);
  if (!pendingDeltas || pendingDeltas.length === 0) {
    return basePart;
  }

  let nextPart = basePart;
  for (const pending of pendingDeltas) {
    const updated = applyDeltaToPart(nextPart, pending.field, pending.delta);
    if (updated) {
      nextPart = updated;
    }
  }
  runtime.pendingDeltasByPartId.delete(partId);
  return nextPart;
};

const getKnownMessageParts = (runtime: EventStreamRuntime, messageId: string): Part[] => {
  return [...runtime.partsById.values()].filter((part) => part.messageID === messageId);
};

const hasTerminalStopSignal = (parts: Part[], finish: string | undefined): boolean => {
  if (finish === "stop") {
    return true;
  }

  return parts.some(
    (part) =>
      part.type === "step-finish" && typeof part.reason === "string" && part.reason === "stop",
  );
};

const shouldPreserveIdleForCompletedAssistantMessage = (
  runtime: EventStreamRuntime,
  messageId: string,
  roleHint?: string,
): boolean => {
  const session = runtime.getSession(runtime.sessionId);
  if (!session?.hasIdleSinceActivity) {
    return false;
  }

  const role = roleHint ?? runtime.messageRoleById.get(messageId);
  if (role !== "assistant") {
    return false;
  }

  return session.completedAssistantMessageIds.has(messageId);
};

const rawPartsHaveTerminalStopSignal = (parts: unknown[]): boolean => {
  return parts.some((part) => {
    const record = asUnknownRecord(part);
    return (
      record !== undefined &&
      readStringProp(record, ["type"]) === "step-finish" &&
      readStringProp(record, ["reason"]) === "stop"
    );
  });
};

const emitKnownUserMessage = (
  runtime: EventStreamRuntime,
  input: {
    messageId: string;
    timestamp: string;
    state: AgentUserMessageState;
    model?: ReturnType<typeof readMessageModelSelection>;
  },
): boolean => {
  const session = runtime.getSession(runtime.sessionId);

  const visible =
    readTextFromParts(getKnownMessageParts(runtime, input.messageId)) ||
    session?.messageMetadataById.get(input.messageId)?.text ||
    "";
  if (visible.trim().length === 0) {
    return false;
  }

  return emitUserMessage(runtime, {
    messageId: input.messageId,
    timestamp: input.timestamp,
    message: visible,
    state: input.state,
    ...(input.model ? { model: input.model } : {}),
  });
};

const buildUserMessageSignature = (input: {
  timestamp: string;
  message: string;
  state: AgentUserMessageState;
  model?: ReturnType<typeof readMessageModelSelection>;
}): string => {
  const model = input.model;
  return JSON.stringify({
    timestamp: input.timestamp,
    message: input.message,
    state: input.state,
    providerId: model?.providerId ?? null,
    modelId: model?.modelId ?? null,
    variant: model?.variant ?? null,
    profileId: model?.profileId ?? null,
  });
};

const emitUserMessage = (
  runtime: EventStreamRuntime,
  input: {
    messageId: string;
    timestamp: string;
    message: string;
    state: AgentUserMessageState;
    model?: ReturnType<typeof readMessageModelSelection>;
  },
): boolean => {
  const session = runtime.getSession(runtime.sessionId);
  const signature = buildUserMessageSignature(input);
  if (session?.emittedUserMessageSignatures.get(input.messageId) === signature) {
    return true;
  }

  runtime.emit(runtime.sessionId, {
    type: "user_message",
    sessionId: runtime.sessionId,
    timestamp: input.timestamp,
    messageId: input.messageId,
    message: input.message,
    state: input.state,
    ...(input.model ? { model: input.model } : {}),
  });
  session?.emittedUserMessageSignatures.set(input.messageId, signature);
  session?.emittedUserMessageStates.set(input.messageId, input.state);
  return true;
};

const readExplicitUserMessageState = (
  ...sources: Array<unknown>
): AgentUserMessageState | undefined => {
  for (const source of sources) {
    const rawState = readStringProp(source, ["state"]);
    if (rawState === "queued" || rawState === "read") {
      return rawState;
    }
  }
  return undefined;
};

const modelsMatch = (
  left: ReturnType<typeof readMessageModelSelection> | undefined,
  right: ReturnType<typeof readMessageModelSelection> | undefined,
): boolean => {
  if (!left && !right) {
    return true;
  }
  if (!left || !right) {
    return false;
  }
  return (
    left.providerId === right.providerId &&
    left.modelId === right.modelId &&
    left.variant === right.variant &&
    left.profileId === right.profileId
  );
};

const takeQueuedUserSendMatch = (
  runtime: EventStreamRuntime,
  visible: string,
  model: ReturnType<typeof readMessageModelSelection> | undefined,
): boolean => {
  const session = runtime.getSession(runtime.sessionId);
  if (!session || session.pendingQueuedUserMessages.length === 0) {
    return false;
  }

  const normalizedVisible = visible.trim();
  const matchIndex = session.pendingQueuedUserMessages.findIndex(
    (entry) => entry.content === normalizedVisible && modelsMatch(entry.model, model),
  );
  if (matchIndex < 0) {
    return false;
  }

  session.pendingQueuedUserMessages.splice(matchIndex, 1);
  return true;
};

const resolveUserMessageStateFromPendingAssistant = (
  session: ReturnType<EventStreamRuntime["getSession"]>,
  messageId: string,
): AgentUserMessageState => {
  const activeAssistantMessageId = session?.activeAssistantMessageId;
  if (!session || !activeAssistantMessageId) {
    return "read";
  }

  return messageId > activeAssistantMessageId ? "queued" : "read";
};

const resolveLiveUserMessageState = (
  runtime: EventStreamRuntime,
  input: {
    messageId: string;
    visible: string;
    explicitState?: AgentUserMessageState;
    model?: ReturnType<typeof readMessageModelSelection>;
  },
): AgentUserMessageState => {
  const session = runtime.getSession(runtime.sessionId);
  const pendingAssistantState = resolveUserMessageStateFromPendingAssistant(
    session,
    input.messageId,
  );
  const matchedQueuedSend = takeQueuedUserSendMatch(runtime, input.visible, input.model);

  if (matchedQueuedSend && pendingAssistantState === "queued") {
    return "queued";
  }

  if (input.explicitState) {
    return input.explicitState;
  }

  return pendingAssistantState;
};

export const reconcileUserMessageQueuedStates = (runtime: EventStreamRuntime): void => {
  const session = runtime.getSession(runtime.sessionId);
  if (!session) {
    return;
  }

  for (const [messageId, emittedState] of session.emittedUserMessageStates.entries()) {
    if (runtime.messageRoleById.get(messageId) !== "user") {
      continue;
    }

    const nextState = resolveUserMessageStateFromPendingAssistant(session, messageId);
    if (nextState === emittedState) {
      continue;
    }

    const metadata = session.messageMetadataById.get(messageId);
    emitKnownUserMessage(runtime, {
      messageId,
      timestamp: metadata?.timestamp ?? runtime.now(),
      state: nextState,
      ...(metadata?.model ? { model: metadata.model } : {}),
    });
  }
};

const readRawMessageParts = (properties: unknown, info: unknown): unknown[] => {
  const directParts = readArrayProp(properties, "parts");
  if (directParts) {
    return directParts;
  }
  return readArrayProp(info, "parts") ?? [];
};

const normalizeMessagePart = (
  rawPartRecord: UnknownRecord,
  messageId: string,
  externalSessionId: string,
): Part => {
  return {
    ...(rawPartRecord as Part),
    ...(readStringProp(rawPartRecord, ["sessionID", "sessionId", "session_id"])
      ? {}
      : { sessionID: externalSessionId }),
    ...(readStringProp(rawPartRecord, ["messageID", "messageId", "message_id"])
      ? {}
      : { messageID: messageId }),
  } as Part;
};

const handleMessageUpdatedEvent = (event: Event, runtime: EventStreamRuntime): boolean => {
  if (event.type !== "message.updated") {
    return false;
  }

  const properties = readEventProperties(event);
  if (!properties) {
    return true;
  }
  const infoRecord = readEventInfo(properties);

  const messageId = infoRecord
    ? readStringProp(infoRecord, ["id", "messageID", "messageId", "message_id"])
    : undefined;
  const role = infoRecord ? readStringProp(infoRecord, ["role"]) : undefined;
  const messageTimestamp = (() => {
    const infoTime = infoRecord ? readRecordProp(infoRecord, "time") : undefined;
    return toIsoFromEpoch(infoTime?.created, runtime.now);
  })();
  const messageCompletedAt = infoRecord ? readMessageCompletedAt(infoRecord) : undefined;
  const messageModel = readMessageModelSelection(infoRecord);
  const session = runtime.getSession(runtime.sessionId);
  const previousActiveAssistantMessageId = session?.activeAssistantMessageId ?? null;
  const previousRole = messageId ? runtime.messageRoleById.get(messageId) : undefined;
  const finish = infoRecord ? readStringProp(infoRecord, ["finish"]) : undefined;
  const rawParts = readRawMessageParts(properties, infoRecord);
  const parentId = infoRecord
    ? readStringProp(infoRecord, ["parentID", "parentId", "parent_id"])
    : undefined;
  if (messageId && role) {
    runtime.messageRoleById.set(messageId, role);
    session?.messageMetadataById.set(messageId, {
      timestamp: messageTimestamp,
      ...(messageModel ? { model: messageModel } : {}),
      ...(parentId ? { parentId } : {}),
    });
  }

  if (messageId && role === "assistant") {
    const assistantMessageCompleted =
      messageCompletedAt !== undefined ||
      finish === "stop" ||
      rawPartsHaveTerminalStopSignal(rawParts) ||
      hasTerminalStopSignal(getKnownMessageParts(runtime, messageId), finish);

    if (!assistantMessageCompleted) {
      if (session) {
        session.activeAssistantMessageId = messageId;
      }
      session?.completedAssistantMessageIds.delete(messageId);
    } else {
      if (session?.activeAssistantMessageId === messageId) {
        session.activeAssistantMessageId = null;
      }
      session?.completedAssistantMessageIds.add(messageId);
    }

    if (previousActiveAssistantMessageId !== (session?.activeAssistantMessageId ?? null)) {
      reconcileUserMessageQueuedStates(runtime);
    }
  }

  const normalizedParts: Part[] = [];
  if (messageId && rawParts.length > 0) {
    for (const rawPart of rawParts) {
      const rawPartRecord = asUnknownRecord(rawPart);
      if (!rawPartRecord) {
        continue;
      }

      const rawPartId = readStringProp(rawPartRecord, ["id"]);
      if (!rawPartId) {
        continue;
      }

      const normalizedPart = normalizeMessagePart(
        rawPartRecord,
        messageId,
        runtime.externalSessionId,
      );
      const partWithPendingDelta = applyPendingDeltas(runtime, rawPartId, normalizedPart);

      runtime.partsById.set(rawPartId, partWithPendingDelta);
      normalizedParts.push(partWithPendingDelta);
      emitAssistantPart(runtime, partWithPendingDelta, role);
    }
  }

  if (
    messageId &&
    role === "assistant" &&
    previousRole !== "assistant" &&
    normalizedParts.length === 0
  ) {
    emitKnownAssistantPartsForMessage(runtime, messageId, role);
  }

  if (messageId && role === "user") {
    const userParts =
      normalizedParts.length > 0 ? normalizedParts : getKnownMessageParts(runtime, messageId);
    const textFromParts = readTextFromParts(userParts);
    const visible = textFromParts.length > 0 ? textFromParts : readTextFromMessageInfo(infoRecord);
    if (visible.trim().length === 0) {
      return true;
    }

    const existingMetadata = session?.messageMetadataById.get(messageId);
    session?.messageMetadataById.set(messageId, {
      timestamp: existingMetadata?.timestamp ?? messageTimestamp,
      ...(existingMetadata?.model ? { model: existingMetadata.model } : {}),
      ...(existingMetadata?.parentId ? { parentId: existingMetadata.parentId } : {}),
      text: visible,
    });

    const explicitState = readExplicitUserMessageState(infoRecord, properties);
    return emitUserMessage(runtime, {
      messageId,
      timestamp: messageTimestamp,
      message: visible,
      state: resolveLiveUserMessageState(runtime, {
        messageId,
        visible,
        ...(explicitState ? { explicitState } : {}),
        ...(messageModel ? { model: messageModel } : {}),
      }),
      ...(messageModel ? { model: messageModel } : {}),
    });
  }

  const assistantParts =
    messageId && role === "assistant"
      ? normalizedParts.length > 0
        ? normalizedParts
        : getKnownMessageParts(runtime, messageId)
      : [];
  const hasStopSignal = hasTerminalStopSignal(assistantParts, finish);
  const shouldEmitCompletedMessage =
    messageId !== undefined && role === "assistant" && assistantParts.length > 0 && hasStopSignal;
  if (!shouldEmitCompletedMessage || !messageId) {
    return true;
  }

  const text = readTextFromParts(assistantParts);
  const visible = sanitizeAssistantMessage(text);
  if (visible.length === 0) {
    emitSessionIdle(runtime);
    reconcileUserMessageQueuedStates(runtime);
    return true;
  }

  const totalTokens = extractMessageTotalTokens(infoRecord, assistantParts);
  const assistantModel = readMessageModelSelection(infoRecord);
  const emittedMessageIds = session?.emittedAssistantMessageIds;
  if (emittedMessageIds?.has(messageId)) {
    return true;
  }

  runtime.emit(runtime.sessionId, {
    type: "assistant_message",
    sessionId: runtime.sessionId,
    timestamp: messageTimestamp,
    messageId,
    message: visible,
    ...(typeof totalTokens === "number" ? { totalTokens } : {}),
    ...(assistantModel ? { model: assistantModel } : {}),
  });
  emittedMessageIds?.add(messageId);

  emitSessionIdle(runtime);
  reconcileUserMessageQueuedStates(runtime);
  return true;
};

const handleMessagePartDeltaEvent = (event: Event, runtime: EventStreamRuntime): boolean => {
  if (event.type !== "message.part.delta") {
    return false;
  }

  const deltaEvent = readEventProperties(event);
  if (!deltaEvent) {
    return true;
  }
  const partId = readStringProp(deltaEvent, ["partID", "partId", "part_id"]) ?? "";
  const messageId = readStringProp(deltaEvent, ["messageID", "messageId", "message_id"]);
  const field = readStringProp(deltaEvent, ["field"]) ?? "";
  const deltaValue = readUnknownProp(deltaEvent, "delta");
  const delta = typeof deltaValue === "string" ? deltaValue : "";

  const knownPart = partId ? runtime.partsById.get(partId) : undefined;
  if (knownPart && field.length > 0) {
    const updatedPart = applyDeltaToPart(knownPart, field, delta);
    if (updatedPart) {
      runtime.partsById.set(partId, updatedPart);
      emitAssistantPart(runtime, updatedPart);
      return true;
    }
  }

  if (partId && field.length > 0) {
    const pending = runtime.pendingDeltasByPartId.get(partId) ?? [];
    pending.push({ field, delta });
    runtime.pendingDeltasByPartId.set(partId, pending);
    return true;
  }

  if (delta.length === 0) {
    return true;
  }
  if (!messageId) {
    return true;
  }
  const deltaRole = runtime.messageRoleById.get(messageId);
  if (deltaRole !== "assistant") {
    return true;
  }
  if (shouldPreserveIdleForCompletedAssistantMessage(runtime, messageId, deltaRole)) {
    return true;
  }
  const channel = isReasoningDeltaField(field) ? "reasoning" : "text";

  markSessionActive(runtime);

  runtime.emit(runtime.sessionId, {
    type: "assistant_delta",
    sessionId: runtime.sessionId,
    timestamp: runtime.now(),
    channel,
    messageId,
    delta,
  });
  return true;
};

const handleMessagePartUpdatedEvent = (event: Event, runtime: EventStreamRuntime): boolean => {
  if (event.type !== "message.part.updated") {
    return false;
  }

  const properties = readEventProperties(event);
  const rawPartRecord = properties ? readEventPart(properties) : undefined;
  if (!rawPartRecord) {
    return true;
  }

  const partId = readStringProp(rawPartRecord, ["id"]);
  if (!partId) {
    return true;
  }

  const current = rawPartRecord as Part;
  const nextPart = applyPendingDeltas(runtime, partId, current);
  runtime.partsById.set(partId, nextPart);
  emitAssistantPart(runtime, nextPart);
  const messageId = nextPart.messageID;
  const role = runtime.messageRoleById.get(messageId);
  if (role === "user") {
    const session = runtime.getSession(runtime.sessionId);
    const metadata = session?.messageMetadataById.get(messageId);
    const visible = readTextFromParts(getKnownMessageParts(runtime, messageId));
    if (visible.trim().length > 0) {
      session?.messageMetadataById.set(messageId, {
        timestamp: metadata?.timestamp ?? runtime.now(),
        ...(metadata?.model ? { model: metadata.model } : {}),
        ...(metadata?.parentId ? { parentId: metadata.parentId } : {}),
        text: visible,
      });
    }
    emitKnownUserMessage(runtime, {
      messageId,
      timestamp: metadata?.timestamp ?? runtime.now(),
      state: resolveLiveUserMessageState(runtime, {
        messageId,
        visible,
        ...(metadata?.model ? { model: metadata.model } : {}),
      }),
      ...(metadata?.model ? { model: metadata.model } : {}),
    });
  }
  return true;
};

const handleMessagePartRemovedEvent = (event: Event, runtime: EventStreamRuntime): boolean => {
  if (event.type !== "message.part.removed") {
    return false;
  }

  const properties = readEventProperties(event);
  const removedPartId = properties
    ? readStringProp(properties, ["partID", "partId", "part_id"])
    : undefined;
  if (!removedPartId) {
    return true;
  }

  runtime.partsById.delete(removedPartId);
  runtime.pendingDeltasByPartId.delete(removedPartId);
  return true;
};

export const handleMessageEvent = (event: Event, runtime: EventStreamRuntime): boolean => {
  return (
    handleMessageUpdatedEvent(event, runtime) ||
    handleMessagePartDeltaEvent(event, runtime) ||
    handleMessagePartUpdatedEvent(event, runtime) ||
    handleMessagePartRemovedEvent(event, runtime)
  );
};
