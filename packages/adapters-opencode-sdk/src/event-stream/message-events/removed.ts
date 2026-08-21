import type { Event } from "@opencode-ai/sdk/v2/client";
import { readStringProp } from "../../guards";
import { readEventProperties } from "../schemas";
import type { EventStreamRuntime } from "../shared";
import { removeMessageProjectionState } from "./message-state";
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
