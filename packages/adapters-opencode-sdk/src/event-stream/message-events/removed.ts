import type { Event } from "@opencode-ai/sdk/v2/client";
import { readStringProp } from "../../guards";
import { readEventProperties } from "../schemas";
import type { EventStreamRuntime } from "../shared";
import { deleteMessagePart, getMessageParts } from "../shared";
import { removeSubagentCorrelationForPart } from "./subagent";
import { publishUserMessageReadStateChanges } from "./user";

export const handleMessageRemovedEvent = (event: Event, runtime: EventStreamRuntime): boolean => {
  if (event.type !== "message.removed") {
    return false;
  }

  const properties = readEventProperties(event);
  const messageId = properties
    ? readStringProp(properties, ["messageID", "messageId", "message_id"])
    : undefined;
  if (!messageId) {
    return true;
  }

  for (const part of getMessageParts(runtime, messageId)) {
    deleteMessagePart(runtime, part.id);
    runtime.pendingDeltasByPartId.delete(part.id);
    removeSubagentCorrelationForPart(runtime, part.id);
  }

  runtime.messageRoleById.delete(messageId);
  runtime.compactionMessageIds.delete(messageId);
  const session = runtime.getSession(runtime.externalSessionId);
  if (session) {
    session.messageMetadataById.delete(messageId);
    session.completedAssistantMessageIds.delete(messageId);
    session.pendingCompletedAssistantMessageIds.delete(messageId);
    session.emittedAssistantMessageIds.delete(messageId);
    session.emittedUserMessageSignatures.delete(messageId);
    session.emittedUserMessageStates.delete(messageId);
    if (session.activeAssistantMessageId === messageId) {
      session.activeAssistantMessageId = null;
      publishUserMessageReadStateChanges(runtime);
    }
  }

  runtime.emit(runtime.externalSessionId, {
    type: "transcript_retracted",
    externalSessionId: runtime.externalSessionId,
    timestamp: runtime.now(),
    messageIds: [messageId],
  });
  return true;
};
