import { opencodeEventUsesParentSessionRouting } from "./opencode-agent-session-projection";
import type { ParsedOpencodeEvent } from "./opencode-global-event-ingress";
import {
  readEventDirectory,
  readEventSessionId,
  readSessionLifecycleEvent,
} from "./event-stream/shared";
import type { EventStreamSubscriber } from "./types";

export type OpencodeEventRecipients = {
  sessionIds: readonly string[];
  directory: string | undefined;
};

export const resolveOpencodeEventRecipients = (
  event: ParsedOpencodeEvent,
  parentByChild: ReadonlyMap<string, string>,
): OpencodeEventRecipients => {
  const externalSessionId = readEventSessionId(event);
  const lifecycle = readSessionLifecycleEvent(event);
  const eventSessionId = lifecycle ? lifecycle.externalSessionId : externalSessionId;
  const sessionIds: string[] = [];
  if (externalSessionId !== undefined) sessionIds.push(externalSessionId);
  if (!eventSessionId) {
    const directory = readEventDirectory(event);
    return { sessionIds, directory: directory ? directory.trim() : undefined };
  }
  const parentId =
    lifecycle?.parentExternalSessionId ??
    (opencodeEventUsesParentSessionRouting(event) ? parentByChild.get(eventSessionId) : undefined);
  if (parentId) sessionIds.push(parentId);
  return { sessionIds, directory: undefined };
};

export const isRelevantSubscriberEvent = (
  subscriber: EventStreamSubscriber,
  recipients: OpencodeEventRecipients,
): boolean =>
  recipients.sessionIds.includes(subscriber.externalSessionId) ||
  (recipients.directory !== undefined &&
    subscriber.input.workingDirectory.trim() === recipients.directory);
