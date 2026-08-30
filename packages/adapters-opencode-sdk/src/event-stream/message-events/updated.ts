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
  const metadataUpdates: Parameters<typeof updateMessageMetadata>[2] = {
    timestamp: messageTimestamp,
  };
  const model = messageModel ?? existingMetadata?.model;
  if (model) {
    metadataUpdates.model = model;
  }
  const resolvedParentId = parentId ?? existingMetadata?.parentId;
  if (resolvedParentId) {
    metadataUpdates.parentId = resolvedParentId;
  }
  if (existingMetadata?.text) {
    metadataUpdates.text = existingMetadata.text;
  }
  if (existingMetadata?.displayParts) {
    metadataUpdates.displayParts = existingMetadata.displayParts;
  }
  updateMessageMetadata(runtime, messageId, metadataUpdates);

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
    const userMessageInput: Parameters<typeof handleUserMessageUpdated>[1] = {
      messageId,
      messageTimestamp,
    };
    if (messageModel) {
      userMessageInput.messageModel = messageModel;
    }
    return handleUserMessageUpdated(runtime, userMessageInput);
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
