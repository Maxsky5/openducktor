import type { ParsedOpencodeEvent as Event } from "../opencode-ingress";
import {
  handleMessagePartDeltaEvent,
  handleMessagePartRemovedEvent,
  handleMessagePartUpdatedEvent,
} from "./message-events/parts";
import { handleMessageRemovedEvent } from "./message-events/removed";
import { handleMessageUpdatedEvent } from "./message-events/updated";
import type { EventStreamRuntime } from "./shared";

export {
  emitCompletedAssistantMessages,
  emitSubagentPartsForSession,
} from "./message-events/assistant";
export { publishUserMessageReadStateChanges } from "./message-events/user";

export const handleMessageEvent = (event: Event, runtime: EventStreamRuntime): boolean => {
  return (
    handleMessageUpdatedEvent(event, runtime) ||
    handleMessageRemovedEvent(event, runtime) ||
    handleMessagePartDeltaEvent(event, runtime) ||
    handleMessagePartUpdatedEvent(event, runtime) ||
    handleMessagePartRemovedEvent(event, runtime)
  );
};
