import type { Event } from "@opencode-ai/sdk/v2/client";
import {
  handleMessagePartDeltaEvent,
  handleMessagePartRemovedEvent,
  handleMessagePartUpdatedEvent,
} from "./message-events/parts";
import { handleMessageUpdatedEvent } from "./message-events/updated";
import type { EventStreamRuntime } from "./shared";

export { emitSubagentPartsForSession } from "./message-events/assistant";
export { publishUserMessageReadStateChanges } from "./message-events/user";

export const handleMessageEvent = (event: Event, runtime: EventStreamRuntime): boolean => {
  return (
    handleMessageUpdatedEvent(event, runtime) ||
    handleMessagePartDeltaEvent(event, runtime) ||
    handleMessagePartUpdatedEvent(event, runtime) ||
    handleMessagePartRemovedEvent(event, runtime)
  );
};
