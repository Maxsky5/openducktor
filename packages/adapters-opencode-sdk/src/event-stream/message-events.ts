import type { Event, Part } from "@opencode-ai/sdk/v2/client";
import {
  extractMessageTotalTokens,
  readTextFromParts,
  sanitizeAssistantMessage,
} from "../message-normalizers";
import { mapPartToAgentStreamPart } from "../stream-part-mapper";
import type { EventStreamRuntime } from "./shared";
import { applyDeltaToPart, readStringProp } from "./shared";

const emitAssistantPart = (runtime: EventStreamRuntime, part: Part, roleHint?: string): boolean => {
  const mapped = mapPartToAgentStreamPart(part);
  if (!mapped) {
    return false;
  }

  const mappedRole = roleHint ?? runtime.messageRoleById.get(mapped.messageId);
  if (mappedRole === "user" && mapped.kind === "text") {
    return false;
  }

  runtime.emit(runtime.sessionId, {
    type: "assistant_part",
    sessionId: runtime.sessionId,
    timestamp: runtime.now(),
    part: mapped,
  });
  return true;
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

const readRawMessageParts = (
  properties: Record<string, unknown>,
  info: Record<string, unknown> | undefined,
): unknown[] => {
  if (Array.isArray(properties.parts)) {
    return properties.parts as unknown[];
  }
  const nestedParts = info?.parts;
  return Array.isArray(nestedParts) ? (nestedParts as unknown[]) : [];
};

const normalizeMessagePart = (
  rawPartRecord: Record<string, unknown>,
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

  const properties = event.properties as Record<string, unknown>;
  const info = properties.info;
  const infoRecord =
    info && typeof info === "object" ? (info as Record<string, unknown>) : undefined;

  const messageId = infoRecord
    ? readStringProp(infoRecord, ["id", "messageID", "messageId", "message_id"])
    : undefined;
  const role = infoRecord ? readStringProp(infoRecord, ["role"]) : undefined;
  if (messageId && role) {
    runtime.messageRoleById.set(messageId, role);
  }

  const normalizedParts: Part[] = [];
  const rawParts = readRawMessageParts(properties, infoRecord);
  if (messageId && rawParts.length > 0) {
    for (const rawPart of rawParts) {
      if (!rawPart || typeof rawPart !== "object") {
        continue;
      }
      const rawPartRecord = rawPart as Record<string, unknown>;
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

  const completedAt = infoRecord
    ? ((infoRecord as { time?: { completed?: unknown } }).time?.completed ?? null)
    : null;
  const finish = infoRecord ? readStringProp(infoRecord, ["finish"]) : undefined;
  const shouldEmitCompletedMessage =
    messageId !== undefined &&
    role === "assistant" &&
    normalizedParts.length > 0 &&
    (typeof completedAt === "number" || finish === "stop");
  if (!shouldEmitCompletedMessage || !messageId) {
    return true;
  }

  const text = readTextFromParts(normalizedParts);
  const visible = sanitizeAssistantMessage(text);
  if (visible.length === 0) {
    return true;
  }

  const totalTokens = extractMessageTotalTokens(infoRecord, normalizedParts);
  const session = runtime.getSession(runtime.sessionId);
  const emittedAssistantMessageIds = session?.emittedAssistantMessageIds;
  if (emittedAssistantMessageIds?.has(messageId)) {
    return true;
  }

  runtime.emit(runtime.sessionId, {
    type: "assistant_message",
    sessionId: runtime.sessionId,
    timestamp: runtime.now(),
    message: visible,
    ...(typeof totalTokens === "number" ? { totalTokens } : {}),
  });
  emittedAssistantMessageIds?.add(messageId);
  return true;
};

const handleMessagePartDeltaEvent = (event: Event, runtime: EventStreamRuntime): boolean => {
  if (event.type !== "message.part.delta") {
    return false;
  }

  const deltaEvent = event.properties as Record<string, unknown>;
  const partId = readStringProp(deltaEvent, ["partID", "partId", "part_id"]) ?? "";
  const messageId = readStringProp(deltaEvent, ["messageID", "messageId", "message_id"]);
  const field = readStringProp(deltaEvent, ["field"]) ?? "";
  const delta = typeof deltaEvent.delta === "string" ? deltaEvent.delta : "";

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
  if (messageId) {
    const deltaRole = runtime.messageRoleById.get(messageId);
    if (deltaRole === "user") {
      return true;
    }
  }

  runtime.emit(runtime.sessionId, {
    type: "assistant_delta",
    sessionId: runtime.sessionId,
    timestamp: runtime.now(),
    delta,
  });
  return true;
};

const handleMessagePartUpdatedEvent = (event: Event, runtime: EventStreamRuntime): boolean => {
  if (event.type !== "message.part.updated") {
    return false;
  }

  const rawPart = (event.properties as { part?: unknown }).part;
  if (!rawPart || typeof rawPart !== "object") {
    return true;
  }

  const current = rawPart as Part;
  const nextPart = applyPendingDeltas(runtime, current.id, current);
  runtime.partsById.set(nextPart.id, nextPart);
  emitAssistantPart(runtime, nextPart);
  return true;
};

const handleMessagePartRemovedEvent = (event: Event, runtime: EventStreamRuntime): boolean => {
  if (event.type !== "message.part.removed") {
    return false;
  }

  const removedPartId = readStringProp(event.properties as Record<string, unknown>, [
    "partID",
    "partId",
    "part_id",
  ]);
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
