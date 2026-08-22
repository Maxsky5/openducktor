import { hasRuntimeType } from "@openducktor/contracts";
import type { Part } from "@opencode-ai/sdk/v2/client";
import { readNumberProp, readStringProp, readUnknownProp } from "../../guards";
import type { JsonValue } from "@openducktor/contracts";
import type { ParsedOpencodeEvent as Event } from "../../opencode-ingress";
import { readEventPart, readEventProperties } from "../schemas";
import type { EventStreamRuntime } from "../shared";
import {
  applyDeltaToPart,
  deleteMessagePart,
  isReasoningDeltaField,
  markSessionActive,
  setMessagePart,
} from "../shared";
import {
  emitAssistantPart,
  maybeEmitCompletedAssistantMessage,
  shouldSuppressAssistantStreamingAfterIdle,
} from "./assistant";
import { applyPendingDeltas, suppressCompactionMessage } from "./helpers";
import { removeSubagentCorrelationForPart } from "./subagent";
import { handleUserPartUpdated } from "./user";

const toIsoTimestamp = (timestampMs: number | undefined): string | undefined => {
  if (timestampMs === undefined) {
    return undefined;
  }
  const timestamp = new Date(timestampMs);
  return Number.isNaN(timestamp.getTime()) ? undefined : timestamp.toISOString();
};

const readIsoTimestampFromTime = (time: JsonValue | undefined): string | undefined => {
  if (hasRuntimeType(time, "number")) {
    return toIsoTimestamp(time);
  }
  return toIsoTimestamp(readNumberProp(time, ["end", "completed", "updated", "created"]));
};

const readPartUpdatedTimestamp = (
  properties: JsonValue | undefined,
  part: Part,
): string | undefined => {
  const eventTimestamp = readIsoTimestampFromTime(readUnknownProp(properties, "time"));
  if (eventTimestamp) {
    return eventTimestamp;
  }

  const partTime =
    part.type === "tool" && part.state.status !== "pending"
      ? part.state.time
      : "time" in part
        ? part.time
        : undefined;
  return readIsoTimestampFromTime(partTime);
};

export const handleMessagePartDeltaEvent = (event: Event, runtime: EventStreamRuntime): boolean => {
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
  const delta = hasRuntimeType(deltaValue, "string") ? deltaValue : "";

  const knownPart = partId ? runtime.session.partsById.get(partId) : undefined;
  const deltaMessageId = knownPart?.messageID ?? messageId;
  if (deltaMessageId && runtime.session.compactionMessageIds.has(deltaMessageId)) {
    if (partId) {
      runtime.session.pendingDeltasByPartId.delete(partId);
    }
    return true;
  }
  if (knownPart && field.length > 0) {
    const updatedPart = applyDeltaToPart(knownPart, field, delta);
    if (updatedPart) {
      setMessagePart(runtime.session, updatedPart);
      emitAssistantPart(runtime, updatedPart);
      maybeEmitCompletedAssistantMessage(runtime, {
        messageId: updatedPart.messageID,
      });
      return true;
    }
  }

  if (partId && field.length > 0) {
    const pending = runtime.session.pendingDeltasByPartId.get(partId) ?? [];
    pending.push({ field, delta });
    runtime.session.pendingDeltasByPartId.set(partId, pending);
    return true;
  }

  if (delta.length === 0) {
    return true;
  }
  if (!messageId) {
    return true;
  }
  const deltaRole = runtime.session.messageRoleById.get(messageId);
  if (deltaRole !== "assistant") {
    return true;
  }
  if (shouldSuppressAssistantStreamingAfterIdle(runtime, messageId, deltaRole)) {
    return true;
  }
  const channel = isReasoningDeltaField(field) ? "reasoning" : "text";

  markSessionActive(runtime);

  runtime.emit(runtime.externalSessionId, {
    type: "assistant_delta",
    externalSessionId: runtime.externalSessionId,
    timestamp: runtime.now(),
    channel,
    messageId,
    delta,
  });
  return true;
};

export const handleMessagePartUpdatedEvent = (
  event: Event,
  runtime: EventStreamRuntime,
): boolean => {
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

  const messageId = readStringProp(rawPartRecord, ["messageID", "messageId", "message_id"]);
  if (readStringProp(rawPartRecord, ["type"]) === "compaction") {
    if (messageId) {
      suppressCompactionMessage(runtime, messageId);
    }
    deleteMessagePart(runtime.session, partId);
    runtime.session.pendingDeltasByPartId.delete(partId);
    return true;
  }
  if (messageId && runtime.session.compactionMessageIds.has(messageId)) {
    deleteMessagePart(runtime.session, partId);
    runtime.session.pendingDeltasByPartId.delete(partId);
    return true;
  }

  // SAFETY: The preceding runtime guard establishes `Part` before this assertion.
  const current = rawPartRecord as Part;
  const nextPart = applyPendingDeltas(runtime, partId, current);
  setMessagePart(runtime.session, nextPart);
  emitAssistantPart(runtime, nextPart);
  const nextMessageId = nextPart.messageID;
  const role = runtime.session.messageRoleById.get(nextMessageId);
  if (role === "assistant") {
    maybeEmitCompletedAssistantMessage(runtime, {
      messageId: nextMessageId,
    });
    return true;
  }
  if (role === "user") {
    handleUserPartUpdated(runtime, nextMessageId, readPartUpdatedTimestamp(properties, nextPart));
  }
  return true;
};

export const handleMessagePartRemovedEvent = (
  event: Event,
  runtime: EventStreamRuntime,
): boolean => {
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

  deleteMessagePart(runtime.session, removedPartId);
  runtime.session.pendingDeltasByPartId.delete(removedPartId);
  removeSubagentCorrelationForPart(runtime, removedPartId);
  return true;
};
