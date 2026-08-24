import type { ParsedOpencodeEvent as Event } from "../../opencode-global-event-ingress";
import { readMessageModelSelection } from "../../message-normalizers";
import { toIsoFromEpoch } from "../../session-runtime-utils";
import type { EventStreamRuntime } from "../shared";
import {
  emitKnownAssistantPartsForMessage,
  maybeEmitCompletedAssistantMessage,
  updateAssistantMessageCompletionState,
} from "./assistant";
import {
  getKnownMessageParts,
  hasMessageStopSignal,
  isAssistantMessage,
  isAssistantMessageSettled,
  suppressCompactionMessage,
  updateMessageMetadata,
} from "./helpers";
import { handleUserMessageUpdated } from "./user";

export const handleMessageUpdatedEvent = (event: Event, runtime: EventStreamRuntime): boolean => {
  if (event.type !== "message.updated") {
    return false;
  }

  const info = event.properties.info;
  const messageId = info.id;
  if (runtime.session.compactionMessageIds.has(messageId)) {
    suppressCompactionMessage(runtime, messageId);
    return true;
  }
  const role = info.role;
  const messageTimestamp = toIsoFromEpoch(info.time.created, runtime.now);
  const messageCompletedAt = info.role === "assistant" ? info.time.completed : undefined;
  const messageModel = readMessageModelSelection(info);
  const { session } = runtime;
  const previousRole = session.messageRoleById.get(messageId);
  const finish = info.role === "assistant" ? info.finish : undefined;
  const parentId = info.role === "assistant" ? info.parentID : undefined;
  const existingMetadata = session.messageMetadataById.get(messageId);
  session.messageRoleById.set(messageId, role);
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
    ...(existingMetadata?.text ? { text: existingMetadata.text } : undefined),
    ...(existingMetadata?.displayParts
      ? { displayParts: existingMetadata.displayParts }
      : undefined),
  });

  const isAssistantRole = isAssistantMessage(runtime, messageId, role);
  const assistantMessageHasStopSignal = isAssistantRole
    ? hasMessageStopSignal({ finish, parts: getKnownMessageParts(runtime, messageId) })
    : false;
  const assistantMessageSettled = isAssistantRole
    ? isAssistantMessageSettled({
        messageCompletedAt,
        hasStopSignal: assistantMessageHasStopSignal,
      })
    : false;

  if (isAssistantRole) {
    updateAssistantMessageCompletionState(runtime, messageId, assistantMessageSettled);
  }

  if (isAssistantRole && previousRole !== "assistant") {
    emitKnownAssistantPartsForMessage(runtime, messageId, role);
  }

  if (role === "user") {
    return handleUserMessageUpdated(runtime, {
      messageId,
      messageTimestamp,
      ...(messageModel ? { messageModel } : undefined),
    });
  }

  if (!isAssistantRole) {
    return true;
  }

  maybeEmitCompletedAssistantMessage(runtime, {
    messageId,
    timestamp: messageTimestamp,
    info,
    hasStopSignal: assistantMessageHasStopSignal,
  });
  return true;
};
