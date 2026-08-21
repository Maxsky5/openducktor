import type { EventStreamRuntime } from "../shared";
import { deleteMessagePart, getMessageParts } from "../shared";
import { removeSubagentCorrelationForPart } from "./subagent";

export const removeMessageProjectionState = (
  runtime: EventStreamRuntime,
  messageId: string,
): boolean => {
  const { session } = runtime;
  for (const part of getMessageParts(session, messageId)) {
    deleteMessagePart(session, part.id);
    session.pendingDeltasByPartId.delete(part.id);
    removeSubagentCorrelationForPart(runtime, part.id);
  }

  session.messageRoleById.delete(messageId);
  session.messageMetadataById.delete(messageId);
  session.compactionMessageIds.delete(messageId);
  session.completedAssistantMessageIds.delete(messageId);
  session.pendingCompletedAssistantMessageIds.delete(messageId);
  session.emittedAssistantMessageIds.delete(messageId);
  session.emittedUserMessageSignatures.delete(messageId);
  session.emittedUserMessageStates.delete(messageId);
  if (session.activeAssistantMessageId !== messageId) {
    return false;
  }
  session.activeAssistantMessageId = null;
  return true;
};
