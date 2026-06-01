import type { Event, GlobalEvent, OpencodeClient } from "@opencode-ai/sdk/v2/client";
import type { AgentEvent } from "@openducktor/core";
import { handleMessageEvent } from "./event-stream/message-events";
import { handleSessionEvent } from "./event-stream/session-events";
import type { SubagentSessionLink } from "./event-stream/shared";
import {
  isRelevantEvent,
  readEventDirectory,
  readEventParentExternalSessionId,
  readEventSessionId,
} from "./event-stream/shared";
import { asUnknownRecord } from "./guards";
import type {
  EventStreamSubscriber,
  OpencodeEventLogger,
  SessionInput,
  SessionRecord,
} from "./types";

type ProcessOpencodeEventInput = {
  context: {
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
  onEvent: (event: Event) => void | Promise<void>;
};

type SubscribeOpencodeEventsInput = {
  context: {
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

type RelevantSubscriberEventOptions = {
  isKnownChildExternalSessionId?: (externalSessionId: string) => boolean;
};

type GlobalEventStream = {
  stream: AsyncIterable<GlobalEvent>;
};

type GlobalEventApi = {
  event: (options?: { signal?: AbortSignal }) => Promise<GlobalEventStream> | GlobalEventStream;
};

const SYNC_EVENT_TYPE_BY_NAME = {
  "message.updated.1": "message.updated",
  "message.part.updated.1": "message.part.updated",
  "message.part.removed.1": "message.part.removed",
  "session.created.1": "session.created",
  "session.updated.1": "session.updated",
} as const;

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

const normalizeGlobalEventPayload = (payload: Event): Event => {
  const payloadRecord = asUnknownRecord(payload);
  if (payloadRecord?.type !== "sync") {
    return payload;
  }

  const name = payloadRecord.name;
  if (typeof name !== "string") {
    return payload;
  }

  const eventType = SYNC_EVENT_TYPE_BY_NAME[name as keyof typeof SYNC_EVENT_TYPE_BY_NAME];
  const data = asUnknownRecord(payloadRecord.data);
  if (!eventType || !data) {
    return payload;
  }

  return {
    ...payloadRecord,
    type: eventType,
    properties: data,
  } as unknown as Event;
};

const toDirectoryScopedEvent = (event: GlobalEvent): Event => {
  const payload = normalizeGlobalEventPayload(event.payload as Event) as Event & {
    properties?: Record<string, unknown>;
  };
  return {
    ...payload,
    properties: {
      ...(payload.properties ?? {}),
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
  const session = input.getSession(input.context.externalSessionId);
  if (!session) {
    return;
  }
  const runtime = {
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
    subagentCorrelationKeyByExternalSessionId: session.subagentCorrelationKeyByExternalSessionId,
    subagentPartIdByCorrelationKey: session.subagentPartIdByCorrelationKey,
    subagentPartIdByExternalSessionId: session.subagentPartIdByExternalSessionId,
    pendingSubagentCorrelationKeysBySignature: session.pendingSubagentCorrelationKeysBySignature,
    pendingSubagentCorrelationKeys: session.pendingSubagentCorrelationKeys,
    pendingSubagentSessionsByExternalSessionId: session.pendingSubagentSessionsByExternalSessionId,
    pendingSubagentPartEmissionsByExternalSessionId:
      session.pendingSubagentPartEmissionsByExternalSessionId,
    pendingSubagentInputEventsByExternalSessionId:
      session.pendingSubagentInputEventsByExternalSessionId,
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
    await input.onEvent(toDirectoryScopedEvent(event));
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

  const eventExternalSessionId = readEventSessionId(event);
  if (eventExternalSessionId) {
    const properties = "properties" in event ? event.properties : undefined;
    const parentExternalSessionId = readEventParentExternalSessionId(properties);

    if (event.type === "question.asked" && parentExternalSessionId) {
      return parentExternalSessionId === subscriber.externalSessionId;
    }

    if (parentExternalSessionId === subscriber.externalSessionId) {
      return true;
    }

    if (
      (event.type === "permission.asked" ||
        event.type === "permission.replied" ||
        event.type === "question.asked" ||
        event.type === "question.replied") &&
      options?.isKnownChildExternalSessionId?.(eventExternalSessionId)
    ) {
      return true;
    }

    return false;
  }

  return isEventDirectoryScopedToSubscriber(subscriber, event);
};

/** @internal Test-only seam for direct event stream subscription coverage. */
export const subscribeOpencodeEvents = async (
  input: SubscribeOpencodeEventsInput,
): Promise<void> => {
  const isKnownChildExternalSessionId = (externalSessionId: string): boolean => {
    const link = input.resolveSubagentSessionLink?.(externalSessionId);
    if (link && link.parentExternalSessionId === input.context.externalSessionId) {
      return true;
    }

    const session = input.getSession(input.context.externalSessionId);
    return Boolean(
      session?.subagentCorrelationKeyByExternalSessionId.has(externalSessionId) ||
        session?.pendingSubagentSessionsByExternalSessionId.has(externalSessionId),
    );
  };
  return subscribeGlobalEvents({
    client: input.client,
    controller: input.controller,
    onEvent: (event) => {
      const subscriber = {
        externalSessionId: input.context.externalSessionId,
        input: input.context.input,
      };
      const relevant = isRelevantSubscriberEvent(subscriber, event, {
        isKnownChildExternalSessionId,
      });
      logStreamEvent({
        subscriber,
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
