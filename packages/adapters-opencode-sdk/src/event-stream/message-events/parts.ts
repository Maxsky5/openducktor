import { type ParsedOpencodeEvent as Event } from "../../opencode-global-event-ingress";
import type { ParsedOpencodePart } from "../../opencode-ingress";
import type { EventStreamRuntime } from "../shared";
import { applyDeltaToPart, deleteMessagePart, setMessagePart } from "../shared";
import { emitAssistantPart, maybeEmitCompletedAssistantMessage } from "./assistant";
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

type OpencodePartTime =
  | NonNullable<Extract<ParsedOpencodePart, { type: "text" }>["time"]>
  | Extract<ParsedOpencodePart, { type: "retry" }>["time"];

const readIsoTimestampFromTime = (time: OpencodePartTime | undefined): string | undefined => {
  if (time === undefined) {
    return undefined;
  }
  if ("end" in time) {
    return toIsoTimestamp(time.end);
  }
  if ("created" in time) {
    return toIsoTimestamp(time.created);
  }
  return undefined;
};

const readPartUpdatedTimestamp = (
  eventTime: number,
  part: ParsedOpencodePart,
): string | undefined => {
  const eventTimestamp = toIsoTimestamp(eventTime);
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

  const { delta, field, messageID: messageId, partID: partId } = event.properties;

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

  return true;
};

export const handleMessagePartUpdatedEvent = (
  event: Event,
  runtime: EventStreamRuntime,
): boolean => {
  if (event.type !== "message.part.updated") {
    return false;
  }

  const { part: current, time } = event.properties;
  const partId = current.id;
  const messageId = current.messageID;
  if (current.type === "compaction") {
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
    handleUserPartUpdated(runtime, nextMessageId, readPartUpdatedTimestamp(time, nextPart));
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

  const removedPartId = event.properties.partID;

  deleteMessagePart(runtime.session, removedPartId);
  runtime.session.pendingDeltasByPartId.delete(removedPartId);
  removeSubagentCorrelationForPart(runtime, removedPartId);
  return true;
};
