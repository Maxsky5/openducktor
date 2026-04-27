import type { Event, GlobalEvent, OpencodeClient } from "@opencode-ai/sdk/v2/client";
import type { AgentEvent } from "@openducktor/core";
import { handleMessageEvent } from "./event-stream/message-events";
import { handleSessionEvent } from "./event-stream/session-events";
import type { SubagentSessionLink } from "./event-stream/shared";
import { isRelevantEvent, readEventDirectory, readEventSessionId } from "./event-stream/shared";
import type {
  EventStreamSubscriber,
  OpencodeEventLogger,
  SessionInput,
  SessionRecord,
} from "./types";

type ProcessOpencodeEventInput = {
  context: {
    sessionId: string;
    externalSessionId: string;
    input: SessionInput;
  };
  event: Event;
  now: () => string;
  emit: (sessionId: string, event: AgentEvent) => void;
  getSession: (sessionId: string) => SessionRecord | undefined;
  resolveSubagentSessionLink?: (childExternalSessionId: string) => SubagentSessionLink | undefined;
};

type SubscribeGlobalEventsInput = {
  client: OpencodeClient;
  controller: AbortController;
  onEvent: (event: Event) => void;
};

type SubscribeOpencodeEventsInput = {
  context: {
    sessionId: string;
    externalSessionId: string;
    input: SessionInput;
  };
  client: OpencodeClient;
  controller: AbortController;
  now: () => string;
  emit: (sessionId: string, event: AgentEvent) => void;
  getSession: (sessionId: string) => SessionRecord | undefined;
  logEvent?: OpencodeEventLogger;
  resolveSubagentSessionLink?: (childExternalSessionId: string) => SubagentSessionLink | undefined;
};

type LogEventInput = {
  subscriber: EventStreamSubscriber;
  event: Event;
  relevant: boolean;
  logEvent?: OpencodeEventLogger;
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
  const payload = event.payload as Event & { properties?: Record<string, unknown> };
  return {
    ...payload,
    properties: {
      ...(payload.properties ?? {}),
      directory: event.directory,
    },
  } as Event;
};

const normalizeDirectory = (directory: string): string => directory.trim();

export const processOpencodeEvent = (input: ProcessOpencodeEventInput): void => {
  const session = input.getSession(input.context.sessionId);
  if (!session) {
    return;
  }
  const runtime = {
    sessionId: input.context.sessionId,
    externalSessionId: input.context.externalSessionId,
    input: input.context.input,
    now: input.now,
    emit: input.emit,
    getSession: input.getSession,
    ...(input.resolveSubagentSessionLink
      ? { resolveSubagentSessionLink: input.resolveSubagentSessionLink }
      : {}),
    partsById: session.partsById,
    messageRoleById: session.messageRoleById,
    pendingDeltasByPartId: session.pendingDeltasByPartId,
    subagentCorrelationKeyByPartId: session.subagentCorrelationKeyByPartId,
    subagentCorrelationKeyBySessionId: session.subagentCorrelationKeyBySessionId,
    pendingSubagentCorrelationKeysBySignature: session.pendingSubagentCorrelationKeysBySignature,
    pendingSubagentCorrelationKeys: session.pendingSubagentCorrelationKeys,
    pendingSubagentSessionsById: session.pendingSubagentSessionsById,
    pendingSubagentPartEmissionsBySessionId: session.pendingSubagentPartEmissionsBySessionId,
  };

  if (handleMessageEvent(input.event, runtime)) {
    return;
  }
  handleSessionEvent(input.event, runtime);
};

export const logStreamEvent = ({ subscriber, event, relevant, logEvent }: LogEventInput): void => {
  if (!logEvent) {
    return;
  }
  logEvent({
    sessionId: subscriber.sessionId,
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
  for await (const event of stream) {
    if (input.controller.signal.aborted) {
      break;
    }
    input.onEvent(toDirectoryScopedEvent(event));
  }
};

export const isRelevantSubscriberEvent = (
  subscriber: EventStreamSubscriber,
  event: Event,
): boolean => {
  if (isRelevantEvent(subscriber.externalSessionId, event)) {
    return true;
  }

  const eventSessionId = readEventSessionId(event);
  if (eventSessionId) {
    const properties = "properties" in event ? event.properties : undefined;
    const info =
      properties && typeof properties === "object" && properties !== null && "info" in properties
        ? (properties as { info?: unknown }).info
        : undefined;
    const parentSessionId =
      info && typeof info === "object" && info !== null
        ? (["parentID", "parentId", "parent_id"] as const).reduce<string | undefined>(
            (found, key) => {
              if (found) {
                return found;
              }
              const value = (info as Record<string, unknown>)[key];
              return typeof value === "string" && value.trim().length > 0 ? value : undefined;
            },
            undefined,
          )
        : undefined;

    if (parentSessionId === subscriber.externalSessionId) {
      return true;
    }

    return false;
  }

  const eventDirectory = readEventDirectory(event);
  if (!eventDirectory) {
    return false;
  }

  return (
    normalizeDirectory(eventDirectory) === normalizeDirectory(subscriber.input.workingDirectory)
  );
};

export const subscribeOpencodeEvents = async (
  input: SubscribeOpencodeEventsInput,
): Promise<void> => {
  return subscribeGlobalEvents({
    client: input.client,
    controller: input.controller,
    onEvent: (event) => {
      const relevant = isRelevantSubscriberEvent(
        {
          sessionId: input.context.sessionId,
          externalSessionId: input.context.externalSessionId,
          input: input.context.input,
        },
        event,
      );
      logStreamEvent({
        subscriber: {
          sessionId: input.context.sessionId,
          externalSessionId: input.context.externalSessionId,
          input: input.context.input,
        },
        event,
        relevant,
        ...(input.logEvent ? { logEvent: input.logEvent } : {}),
      });
      if (!relevant) {
        return;
      }
      processOpencodeEvent({
        context: input.context,
        event,
        now: input.now,
        emit: input.emit,
        getSession: input.getSession,
        ...(input.resolveSubagentSessionLink
          ? { resolveSubagentSessionLink: input.resolveSubagentSessionLink }
          : {}),
      });
    },
  });
};
