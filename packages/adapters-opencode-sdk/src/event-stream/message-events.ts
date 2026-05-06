import type { Event } from "@opencode-ai/sdk/v2/client";
import {
  handleMessagePartDeltaEvent,
  handleMessagePartRemovedEvent,
  handleMessagePartUpdatedEvent,
} from "./message-part-events";
import { handleMessageUpdatedEvent } from "./message-updated-events";
import type { EventStreamRuntime } from "./shared";

export { flushPendingSubagentPartEmissionsForSession } from "./assistant-message-events";
export { reconcileUserMessageQueuedStates } from "./user-message-events";

export const handleMessageEvent = (event: Event, runtime: EventStreamRuntime): boolean => {
  return (
    handleMessageUpdatedEvent(event, runtime) ||
    handleMessagePartDeltaEvent(event, runtime) ||
    handleMessagePartUpdatedEvent(event, runtime) ||
    handleMessagePartRemovedEvent(event, runtime)
  );
};
