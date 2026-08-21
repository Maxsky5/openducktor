import type { Event, GlobalEvent, OpencodeClient } from "@opencode-ai/sdk/v2/client";
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
import type { EventStreamSubscriber, OpencodeEventLogger } from "./types";

type ProcessOpencodeEventInput = ProjectOpencodeAgentSessionEventInput;

type SubscribeGlobalEventsInput = {
  client: OpencodeClient;
  controller: AbortController;
  onEvent: (event: Event) => void | Promise<void>;
  onReady?: () => void;
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
  stream: AsyncIterable<GlobalEvent>;
};

type GlobalEventApi = {
  event: (options?: { signal?: AbortSignal }) => Promise<GlobalEventStream> | GlobalEventStream;
};

const getGlobalEventApi = (client: OpencodeClient): GlobalEventApi => {
  const globalApi = (client as OpencodeClient & { global?: { event?: unknown } }).global;
  if (!globalApi || typeof globalApi.event !== "function") {
    throw new Error(
      "OpenCode SDK does not expose global event streaming via client.global.event(). Update @opencode-ai/sdk before using the adapter.",
    );
  }
  return globalApi as GlobalEventApi;
};

const resolveGlobalEventStream = async (
  client: OpencodeClient,
  signal: AbortSignal,
): Promise<AsyncIterable<GlobalEvent>> => {
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

const toDirectoryScopedEvent = (event: GlobalEvent): Event => {
  const payload = normalizeOpencodeGlobalEventPayload(event.payload) as Event & {
    properties?: Record<string, unknown>;
  };
  return {
    ...payload,
    properties: {
      ...payload.properties,
      directory: event.directory,
    },
  } as Event;
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

export const assertGlobalEventSupport = (client: OpencodeClient): void => {
  void getGlobalEventApi(client);
};

export const subscribeGlobalEvents = async (input: SubscribeGlobalEventsInput): Promise<void> => {
  const stream = await resolveGlobalEventStream(input.client, input.controller.signal);
  let ready = false;
  for await (const event of stream) {
    if (input.controller.signal.aborted) {
      break;
    }
    await input.onEvent(toDirectoryScopedEvent(event));
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
    const properties = "properties" in event ? event.properties : undefined;
    const parentExternalSessionId = lifecycleEvent
      ? lifecycleEvent.parentExternalSessionId
      : readEventParentExternalSessionId(properties);

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
