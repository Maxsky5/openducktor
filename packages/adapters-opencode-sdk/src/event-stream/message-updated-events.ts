import type { Event, Part } from "@opencode-ai/sdk/v2/client";
import { asUnknownRecord, readRecordProp, readStringProp } from "../guards";
import { readMessageModelSelection } from "../message-normalizers";
import { toIsoFromEpoch } from "../session-runtime-utils";
import {
  emitAssistantPart,
  emitKnownAssistantPartsForMessage,
  maybeEmitCompletedAssistantMessage,
  updateAssistantMessageCompletionState,
} from "./assistant-message-events";
import {
  applyPendingDeltas,
  getKnownMessageParts,
  hasMessageStopSignal,
  isAssistantMessage,
  isAssistantMessageSettled,
  normalizeMessagePart,
  readRawMessageParts,
  updateMessageMetadata,
} from "./message-event-helpers";
import { readEventInfo, readEventProperties, readMessageCompletedAt } from "./schemas";
import type { EventStreamRuntime } from "./shared";
import { handleUserMessageUpdated } from "./user-message-events";

export const handleMessageUpdatedEvent = (event: Event, runtime: EventStreamRuntime): boolean => {
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
  const session = runtime.getSession(runtime.externalSessionId);
  const previousRole = messageId ? runtime.messageRoleById.get(messageId) : undefined;
  const finish = infoRecord ? readStringProp(infoRecord, ["finish"]) : undefined;
  const rawParts = readRawMessageParts(properties, infoRecord);
  const parentId = infoRecord
    ? readStringProp(infoRecord, ["parentID", "parentId", "parent_id"])
    : undefined;
  const existingMetadata = messageId ? session?.messageMetadataById.get(messageId) : undefined;
  if (messageId && role) {
    runtime.messageRoleById.set(messageId, role);
    updateMessageMetadata(runtime, messageId, {
      timestamp: messageTimestamp,
      ...(messageModel
        ? { model: messageModel }
        : existingMetadata?.model
          ? { model: existingMetadata.model }
          : {}),
      ...(parentId
        ? { parentId }
        : existingMetadata?.parentId
          ? { parentId: existingMetadata.parentId }
          : {}),
      ...(existingMetadata?.text ? { text: existingMetadata.text } : {}),
      ...(existingMetadata?.displayParts ? { displayParts: existingMetadata.displayParts } : {}),
    });
  }

  const isAssistantRole = messageId ? isAssistantMessage(runtime, messageId, role) : false;
  const assistantMessageHasStopSignal =
    messageId && isAssistantRole
      ? hasMessageStopSignal({
          finish,
          rawParts,
          parts: getKnownMessageParts(runtime, messageId),
        })
      : false;
  const assistantMessageSettled =
    messageId && isAssistantRole
      ? isAssistantMessageSettled({
          messageCompletedAt,
          hasStopSignal: assistantMessageHasStopSignal,
        })
      : false;

  if (messageId && isAssistantRole) {
    updateAssistantMessageCompletionState(runtime, messageId, assistantMessageSettled);
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
    isAssistantRole &&
    previousRole !== "assistant" &&
    normalizedParts.length === 0
  ) {
    emitKnownAssistantPartsForMessage(runtime, messageId, role);
  }

  if (messageId && role === "user") {
    return handleUserMessageUpdated(runtime, {
      messageId,
      messageTimestamp,
      infoRecord,
      properties,
      normalizedParts,
      ...(messageModel ? { messageModel } : {}),
    });
  }

  if (!messageId || !isAssistantRole) {
    return true;
  }

  maybeEmitCompletedAssistantMessage(runtime, {
    messageId,
    timestamp: messageTimestamp,
    info: infoRecord,
    hasStopSignal: assistantMessageHasStopSignal,
  });
  return true;
};
