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
import { asUnknownRecord, readStringProp } from "./guards";
import {
  parseOpencodeDirectEvent,
  type OpencodeGlobalEventPayload,
  type ParsedOpencodeEvent as Event,
} from "./opencode-global-event-ingress";
import type { EventStreamSubscriber, OpencodeEventLogger } from "./types";

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

type GlobalEventStream = {
  stream: AsyncIterable<OpencodeGlobalEvent>;
};

type OpencodeGlobalEvent = Omit<GlobalEvent, "payload"> & {
  payload: OpencodeGlobalEventPayload;
};

type GlobalEventApi = {
  event: (options?: { signal?: AbortSignal }) => Promise<GlobalEventStream> | GlobalEventStream;
};

const getGlobalEventApi = (client: GlobalEventClient): GlobalEventApi => {
  const globalApi = client.global;
  if (typeof globalApi.event !== "function") {
    throw new Error(
      "OpenCode SDK does not expose global event streaming via client.global.event(). Update @opencode-ai/sdk before using the adapter.",
    );
  }
  return globalApi;
};

const resolveGlobalEventStream = async (
  client: GlobalEventClient,
  signal: AbortSignal,
): Promise<AsyncIterable<OpencodeGlobalEvent>> => {
  const stream = await getGlobalEventApi(client).event({ signal });
  if (
    typeof stream === "object" &&
    stream !== null &&
    "stream" in stream &&
    stream.stream &&
    typeof stream.stream[Symbol.asyncIterator] === "function"
  ) {
    return stream.stream;
  }
  throw new Error("OpenCode SDK global event stream must expose a stream async iterator.");
};

const toDirectoryScopedEvent = (event: Event, directory: string): Event => {
  return parseOpencodeDirectEvent({
    ...event,
    properties: {
      ...event.properties,
      directory,
    },
  });
};

const readGlobalEventFailureScope = (
  event: OpencodeGlobalEvent,
): OpencodeGlobalEventFailureScope => {
  const payload = asUnknownRecord(event.payload);
  const syncEvent = payload?.type === "sync" ? asUnknownRecord(payload.syncEvent) : undefined;
  const properties = syncEvent
    ? asUnknownRecord(syncEvent.data)
    : asUnknownRecord(payload?.properties);
  const externalSessionId =
    (properties ? readStringProp(properties, ["sessionID"]) : undefined) ??
    (typeof syncEvent?.aggregateID === "string" ? syncEvent.aggregateID : undefined);
  const payloadType =
    typeof syncEvent?.type === "string"
      ? syncEvent.type.replace(/\.1$/u, "")
      : typeof payload?.type === "string"
        ? payload.type
        : undefined;
  const info = properties ? asUnknownRecord(properties.info) : undefined;
  const parentExternalSessionId =
    payloadType === "session.created" ||
    payloadType === "session.updated" ||
    payloadType === "session.deleted"
      ? readStringProp(info, ["parentID"])
      : undefined;
  return {
    directory: event.directory,
    ...(externalSessionId ? { externalSessionId } : undefined),
    ...(parentExternalSessionId ? { parentExternalSessionId } : undefined),
  };
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

export const assertGlobalEventSupport = (client: GlobalEventClient): void => {
  void getGlobalEventApi(client);
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
