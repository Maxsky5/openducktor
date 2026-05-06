import type { Event, Part } from "@opencode-ai/sdk/v2/client";
import { readStringProp, readUnknownProp } from "../../guards";
import { readEventPart, readEventProperties } from "../schemas";
import type { EventStreamRuntime } from "../shared";
import { applyDeltaToPart, isReasoningDeltaField, markSessionActive } from "../shared";
import {
  emitAssistantPart,
  maybeEmitCompletedAssistantMessage,
  shouldSuppressAssistantStreamingAfterIdle,
} from "./assistant";
import { applyPendingDeltas } from "./helpers";
import { removeSubagentCorrelationForPart } from "./subagent";
import { handleUserPartUpdated } from "./user";

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
  const delta = typeof deltaValue === "string" ? deltaValue : "";

  const knownPart = partId ? runtime.partsById.get(partId) : undefined;
  if (knownPart && field.length > 0) {
    const updatedPart = applyDeltaToPart(knownPart, field, delta);
    if (updatedPart) {
      runtime.partsById.set(partId, updatedPart);
      emitAssistantPart(runtime, updatedPart);
      maybeEmitCompletedAssistantMessage(runtime, {
        messageId: updatedPart.messageID,
      });
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

  const current = rawPartRecord as Part;
  const nextPart = applyPendingDeltas(runtime, partId, current);
  runtime.partsById.set(partId, nextPart);
  emitAssistantPart(runtime, nextPart);
  const messageId = nextPart.messageID;
  const role = runtime.messageRoleById.get(messageId);
  if (role === "assistant") {
    maybeEmitCompletedAssistantMessage(runtime, {
      messageId,
    });
    return true;
  }
  if (role === "user") {
    handleUserPartUpdated(runtime, messageId);
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

  runtime.partsById.delete(removedPartId);
  runtime.pendingDeltasByPartId.delete(removedPartId);
  removeSubagentCorrelationForPart(runtime, removedPartId);
  return true;
};
