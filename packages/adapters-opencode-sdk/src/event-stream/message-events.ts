import type { Event, Part } from "@opencode-ai/sdk/v2/client";
import {
  asUnknownRecord,
  readArrayProp,
  readStringProp,
  readUnknownProp,
  type UnknownRecord,
} from "../guards";
import {
  extractMessageTotalTokens,
  readMessageModelSelection,
  readTextFromParts,
  sanitizeAssistantMessage,
} from "../message-normalizers";
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

const emitAssistantPart = (runtime: EventStreamRuntime, part: Part, roleHint?: string): boolean => {
  const mapped = mapPartToAgentStreamPart(part);
  if (!mapped) {
    return false;
  }

  const mappedRole = roleHint ?? runtime.messageRoleById.get(mapped.messageId);
  if (mappedRole !== "assistant") {
    return false;
  }

  markSessionActive(runtime);

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
): void => {
  for (const part of runtime.partsById.values()) {
    if (part.messageID !== messageId) {
      continue;
    }
    emitAssistantPart(runtime, part, roleHint);
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
  const previousRole = messageId ? runtime.messageRoleById.get(messageId) : undefined;
  if (messageId && role) {
    runtime.messageRoleById.set(messageId, role);
  }

  const normalizedParts: Part[] = [];
  const rawParts = readRawMessageParts(properties, infoRecord);
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

  const completedAt = infoRecord ? readMessageCompletedAt(infoRecord) : undefined;
  const finish = infoRecord ? readStringProp(infoRecord, ["finish"]) : undefined;
  const shouldEmitIdle =
    messageId !== undefined &&
    role === "assistant" &&
    (completedAt !== undefined || finish === "stop");
  const shouldEmitCompletedMessage =
    messageId !== undefined &&
    role === "assistant" &&
    normalizedParts.length > 0 &&
    (completedAt !== undefined || finish === "stop");
  if (!shouldEmitCompletedMessage || !messageId) {
    if (shouldEmitIdle) {
      emitSessionIdle(runtime, messageId);
    }
    return true;
  }

  const text = readTextFromParts(normalizedParts);
  const visible = sanitizeAssistantMessage(text);
  if (visible.length === 0) {
    if (shouldEmitIdle) {
      emitSessionIdle(runtime, messageId);
    }
    return true;
  }

  const totalTokens = extractMessageTotalTokens(infoRecord, normalizedParts);
  const assistantModel = readMessageModelSelection(infoRecord);
  const session = runtime.getSession(runtime.sessionId);
  const emittedAssistantMessageIds = session?.emittedAssistantMessageIds;
  if (emittedAssistantMessageIds?.has(messageId)) {
    if (shouldEmitIdle) {
      emitSessionIdle(runtime, messageId);
    }
    return true;
  }

  runtime.emit(runtime.sessionId, {
    type: "assistant_message",
    sessionId: runtime.sessionId,
    timestamp: runtime.now(),
    messageId,
    message: visible,
    ...(typeof totalTokens === "number" ? { totalTokens } : {}),
    ...(assistantModel ? { model: assistantModel } : {}),
  });
  emittedAssistantMessageIds?.add(messageId);
  if (shouldEmitIdle) {
    emitSessionIdle(runtime, messageId);
  }
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
      markSessionActive(runtime);
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
