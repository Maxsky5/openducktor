import type { GlobalEvent, OpencodeClient } from "@opencode-ai/sdk/v2/client";
import {
  isRelevantEvent,
  readEventDirectory,
  readEventParentExternalSessionId,
  readEventSessionId,
  readSessionLifecycleEvent,
} from "./event-stream/shared";
import {
  normalizeOpencodeGlobalEventPayload,
  opencodeEventUsesParentSessionRouting,
  type ProjectOpencodeAgentSessionEventInput,
  projectOpencodeAgentSessionEvent,
} from "./opencode-agent-session-projection";
import type { ParsedOpencodeEvent as Event } from "./opencode-global-event-ingress";
import type { EventStreamSubscriber, OpencodeEventLogger } from "./types";
import { z } from "zod";

type ProcessOpencodeEventInput = ProjectOpencodeAgentSessionEventInput;

type GlobalEventClient = Pick<OpencodeClient, "global">;

type SubscribeGlobalEventsInput = {
  client: GlobalEventClient;
  controller: AbortController;
  onEvent: (event: Event) => void | Promise<void>;
  onEventError?: (cause: unknown, scope: OpencodeGlobalEventFailureScope) => void | Promise<void>;
  onReady?: () => void;
};

export type OpencodeGlobalEventFailureScope = {
  directory: string;
  externalSessionId?: string;
  parentExternalSessionId?: string;
};

type LogEventInput = {
  subscriber: EventStreamSubscriber;
  event: Event;
  relevant: boolean;
  logEvent?: OpencodeEventLogger;
};

type RelevantSubscriberEventOptions = {
  resolveParentExternalSessionId?: (childExternalSessionId: string) => string | undefined;
};

type OpencodeGlobalEvent = GlobalEvent;

const resolveGlobalEventStream = async (
  client: GlobalEventClient,
  signal: AbortSignal,
): Promise<AsyncIterable<OpencodeGlobalEvent>> => {
  const stream = await client.global.event({ signal });
  return stream.stream;
};

const failureScopePayloadSchema = z.union([
  z.object({
    type: z.literal("sync"),
    syncEvent: z.object({
      aggregateID: z.string().optional(),
      data: z.object({
        info: z.object({ parentID: z.string().optional() }).optional(),
        sessionID: z.string().optional(),
      }),
      type: z.string(),
    }),
  }),
  z.object({
    properties: z.object({
      info: z.object({ parentID: z.string().optional() }).optional(),
      sessionID: z.string().optional(),
    }),
    type: z.string(),
  }),
]);

const toDirectoryScopedEvent = <ScopedEvent extends Event>(
  event: ScopedEvent,
  directory: string,
): ScopedEvent => {
  return {
    ...event,
    properties: {
      ...event.properties,
      directory,
    },
  };
};

const readGlobalEventFailureScope = (
  event: OpencodeGlobalEvent,
): OpencodeGlobalEventFailureScope => {
  const payload = failureScopePayloadSchema.safeParse(event.payload);
  if (!payload.success) {
    return { directory: event.directory };
  }
  const syncEvent = "syncEvent" in payload.data ? payload.data.syncEvent : undefined;
  const properties =
    "properties" in payload.data ? payload.data.properties : payload.data.syncEvent.data;
  const externalSessionId = properties.sessionID ?? syncEvent?.aggregateID;
  const payloadType = (syncEvent?.type ?? payload.data.type).replace(/\.1$/u, "");
  const info = properties.info;
  const parentExternalSessionId =
    payloadType === "session.created" ||
    payloadType === "session.updated" ||
    payloadType === "session.deleted"
      ? info?.parentID
      : undefined;
  const scope: OpencodeGlobalEventFailureScope = { directory: event.directory };
  if (externalSessionId) {
    scope.externalSessionId = externalSessionId;
  }
  if (parentExternalSessionId) {
    scope.parentExternalSessionId = parentExternalSessionId;
  }
  return scope;
};

const normalizeDirectory = (directory: string): string => directory.trim();

const isEventDirectoryScopedToSubscriber = (
  subscriber: EventStreamSubscriber,
  event: Event,
): boolean => {
  const eventDirectory = readEventDirectory(event);
  if (!eventDirectory) {
    return false;
  }

  return (
    normalizeDirectory(eventDirectory) === normalizeDirectory(subscriber.input.workingDirectory)
  );
};

export const processOpencodeEvent = (input: ProcessOpencodeEventInput): void => {
  projectOpencodeAgentSessionEvent(input);
};

export const logStreamEvent = ({ subscriber, event, relevant, logEvent }: LogEventInput): void => {
  if (!logEvent) {
    return;
  }
  logEvent({
    externalSessionId: subscriber.externalSessionId,
    relevant,
    event,
  });
};

export const subscribeGlobalEvents = async (input: SubscribeGlobalEventsInput): Promise<void> => {
  const stream = await resolveGlobalEventStream(input.client, input.controller.signal);
  let ready = false;
  for await (const event of stream) {
    if (input.controller.signal.aborted) {
      break;
    }
    try {
      const payloadDecision = normalizeOpencodeGlobalEventPayload(event.payload);
      if (payloadDecision.kind === "event") {
        await input.onEvent(toDirectoryScopedEvent(payloadDecision.event, event.directory));
      }
    } catch (error) {
      if (!input.onEventError) {
        throw error;
      }
      await input.onEventError(error, readGlobalEventFailureScope(event));
    }
    if (!ready) {
      ready = true;
      input.onReady?.();
    }
  }
};

export const isRelevantSubscriberEvent = (
  subscriber: EventStreamSubscriber,
  event: Event,
  options?: RelevantSubscriberEventOptions,
): boolean => {
  if (isRelevantEvent(subscriber.externalSessionId, event)) {
    return true;
  }

  const lifecycleEvent = readSessionLifecycleEvent(event);
  const eventExternalSessionId = lifecycleEvent
    ? lifecycleEvent.externalSessionId
    : readEventSessionId(event);
  if (eventExternalSessionId) {
    const parentExternalSessionId = lifecycleEvent
      ? lifecycleEvent.parentExternalSessionId
      : readEventParentExternalSessionId(event);

    if (parentExternalSessionId) {
      return parentExternalSessionId === subscriber.externalSessionId;
    }

    if (
      opencodeEventUsesParentSessionRouting(event) &&
      options?.resolveParentExternalSessionId?.(eventExternalSessionId) ===
        subscriber.externalSessionId
    ) {
      return true;
    }

    return false;
  }

  return isEventDirectoryScopedToSubscriber(subscriber, event);
};
