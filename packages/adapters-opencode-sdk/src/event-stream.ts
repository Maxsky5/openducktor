import type { Event, GlobalEvent, OpencodeClient } from "@opencode-ai/sdk/v2/client";
import type { AgentEvent } from "@openducktor/core";
import { handleMessageEvent } from "./event-stream/message-events";
import { handleSessionEvent } from "./event-stream/session-events";
import type { SubagentSessionLink } from "./event-stream/shared";
import {
  type EventStreamRuntime,
  isRelevantEvent,
  readEventDirectory,
  readEventParentExternalSessionId,
  readEventSessionId,
  readSessionLifecycleEvent,
} from "./event-stream/shared";
import { asUnknownRecord } from "./guards";
import type {
  EventStreamSubscriber,
  OpencodeEventLogger,
  SessionInput,
  SessionRecord,
} from "./types";

type CreateEventStreamRuntimeInput = {
  context: {
    externalSessionId: string;
    input: SessionInput;
  };
  now: () => string;
  emit: (sessionId: string, event: AgentEvent) => void;
  getSession: (sessionId: string) => SessionRecord | undefined;
  resolveSubagentSessionLink?: (childExternalSessionId: string) => SubagentSessionLink | undefined;
};

type ProcessOpencodeEventInput = CreateEventStreamRuntimeInput & {
  event: Event;
};

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

type GlobalEventPayload = GlobalEvent["payload"];

type GlobalEventApi = {
  event: (options?: { signal?: AbortSignal }) => Promise<GlobalEventStream> | GlobalEventStream;
};

const NORMALIZED_EVENT_TYPE_BY_SYNC_TYPE = {
  "message.updated.1": "message.updated",
  "message.part.updated.1": "message.part.updated",
  "message.part.removed.1": "message.part.removed",
  "session.created.1": "session.created",
  "session.updated.1": "session.updated",
  "session.deleted.1": "session.deleted",
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

const normalizeGlobalEventPayload = (payload: GlobalEventPayload): Event => {
  const payloadRecord = asUnknownRecord(payload);
  if (payloadRecord?.type !== "sync") {
    return payload as Event;
  }

  const syncEvent = asUnknownRecord(payloadRecord.syncEvent);
  if (!syncEvent) {
    throw new Error(
      "OpenCode sync event is missing its syncEvent envelope; update the runtime or adapter to a supported event contract.",
    );
  }
  const syncEventType = syncEvent.type;
  if (typeof syncEventType !== "string") {
    throw new Error(
      "OpenCode sync event is missing syncEvent.type; update the runtime or adapter to a supported event contract.",
    );
  }

  const eventType =
    NORMALIZED_EVENT_TYPE_BY_SYNC_TYPE[
      syncEventType as keyof typeof NORMALIZED_EVENT_TYPE_BY_SYNC_TYPE
    ];
  if (!eventType) {
    return payload as unknown as Event;
  }
  const data = asUnknownRecord(syncEvent.data);
  if (!data) {
    throw new Error(
      `OpenCode ${syncEventType} event is missing object syncEvent.data; update the runtime or adapter to a supported event contract.`,
    );
  }

  return {
    ...payloadRecord,
    ...(typeof syncEvent.id === "string" ? { id: syncEvent.id } : {}),
    type: eventType,
    properties: data,
  } as unknown as Event;
};

const toDirectoryScopedEvent = (event: GlobalEvent): Event => {
  const payload = normalizeGlobalEventPayload(event.payload) as Event & {
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

export const createEventStreamRuntime = (
  input: CreateEventStreamRuntimeInput,
): EventStreamRuntime | null => {
  const session = input.getSession(input.context.externalSessionId);
  if (!session) {
    return null;
  }

  return {
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
    compactionMessageIds: session.compactionMessageIds,
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
    pendingBackgroundTaskResultsByExternalSessionId:
      session.pendingBackgroundTaskResultsByExternalSessionId,
  };
};

export const processOpencodeEvent = (input: ProcessOpencodeEventInput): void => {
  const runtime = createEventStreamRuntime(input);
  if (!runtime) {
    return;
  }

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
    const eventType = lifecycleEvent?.type ?? String(event.type);
    const properties = "properties" in event ? event.properties : undefined;
    const parentExternalSessionId = lifecycleEvent
      ? lifecycleEvent.parentExternalSessionId
      : readEventParentExternalSessionId(properties);

    if (parentExternalSessionId) {
      return parentExternalSessionId === subscriber.externalSessionId;
    }

    if (
      (eventType === "permission.asked" ||
        eventType === "permission.v2.asked" ||
        eventType === "permission.replied" ||
        eventType === "question.asked" ||
        eventType === "question.replied") &&
      options?.resolveParentExternalSessionId?.(eventExternalSessionId) ===
        subscriber.externalSessionId
    ) {
      return true;
    }

    return false;
  }

  return isEventDirectoryScopedToSubscriber(subscriber, event);
};
