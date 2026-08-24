import type { ParsedOpencodeEvent as Event } from "../../opencode-global-event-ingress";
import type { EventStreamRuntime } from "../shared";
import { removeMessageProjectionState } from "./message-state";
import { publishUserMessageReadStateChanges } from "./user";

export const handleMessageRemovedEvent = (event: Event, runtime: EventStreamRuntime): boolean => {
  if (event.type !== "message.removed") {
    return false;
  }

  const messageId = event.properties.messageID;

  if (removeMessageProjectionState(runtime, messageId)) {
    publishUserMessageReadStateChanges(runtime);
  }

  runtime.emit(runtime.externalSessionId, {
    type: "transcript_retracted",
    externalSessionId: runtime.externalSessionId,
    timestamp: runtime.now(),
    messageIds: [messageId],
  });
  return true;
};
