import type { Event, GlobalEvent, OpencodeClient } from "@opencode-ai/sdk/v2/client";
import {
  isRelevantEvent,
  readEventDirectory,
  readEventParentExternalSessionId,
  readEventSessionId,
  readSessionLifecycleEvent,
} from "./event-stream/shared";
import { asUnknownRecord } from "./guards";
import {
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

type GlobalEventPayload = GlobalEvent["payload"];
type SyncGlobalEventPayload = Extract<GlobalEventPayload, { type: "sync" }>;
type SyncEventType = SyncGlobalEventPayload["syncEvent"]["type"];

type GlobalEventApi = {
  event: (options?: { signal?: AbortSignal }) => Promise<GlobalEventStream> | GlobalEventStream;
};

const NORMALIZED_EVENT_TYPE_BY_SYNC_TYPE = {
  "message.updated.1": "message.updated",
  "message.removed.1": "message.removed",
  "message.part.updated.1": "message.part.updated",
  "message.part.removed.1": "message.part.removed",
  "session.created.1": "session.created",
  "session.updated.1": "session.updated",
  "session.deleted.1": "session.deleted",
  "session.next.agent.switched.1": "session.next.agent.switched",
  "session.next.model.switched.1": "session.next.model.switched",
  "session.next.moved.1": "session.next.moved",
  "session.next.prompted.1": "session.next.prompted",
  "session.next.prompt.admitted.1": "session.next.prompt.admitted",
  "session.next.context.updated.1": "session.next.context.updated",
  "session.next.synthetic.1": "session.next.synthetic",
  "session.next.shell.started.1": "session.next.shell.started",
  "session.next.shell.ended.1": "session.next.shell.ended",
  "session.next.step.started.1": "session.next.step.started",
  "session.next.step.ended.2": "session.next.step.ended",
  "session.next.step.failed.2": "session.next.step.failed",
  "session.next.text.started.1": "session.next.text.started",
  "session.next.text.ended.1": "session.next.text.ended",
  "session.next.reasoning.started.1": "session.next.reasoning.started",
  "session.next.reasoning.ended.1": "session.next.reasoning.ended",
  "session.next.tool.input.started.1": "session.next.tool.input.started",
  "session.next.tool.input.ended.1": "session.next.tool.input.ended",
  "session.next.tool.called.1": "session.next.tool.called",
  "session.next.tool.progress.1": "session.next.tool.progress",
  "session.next.tool.success.1": "session.next.tool.success",
  "session.next.tool.failed.1": "session.next.tool.failed",
  "session.next.retried.1": "session.next.retried",
  "session.next.compaction.started.1": "session.next.compaction.started",
  "session.next.compaction.ended.1": "session.next.compaction.ended",
  "session.next.revert.staged.1": "session.next.revert.staged",
  "session.next.revert.cleared.1": "session.next.revert.cleared",
  "session.next.revert.committed.1": "session.next.revert.committed",
} as const satisfies Record<SyncEventType, Event["type"]>;

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

  if (!Object.hasOwn(NORMALIZED_EVENT_TYPE_BY_SYNC_TYPE, syncEventType)) {
    throw new Error(
      `OpenCode sync event '${syncEventType}' has no normalization decision; update the adapter for this SDK event.`,
    );
  }
  const eventType =
    NORMALIZED_EVENT_TYPE_BY_SYNC_TYPE[
      syncEventType as keyof typeof NORMALIZED_EVENT_TYPE_BY_SYNC_TYPE
    ];
  const data = asUnknownRecord(syncEvent.data);
  if (!data) {
    throw new Error(
      `OpenCode ${syncEventType} event is missing object syncEvent.data; update the runtime or adapter to a supported event contract.`,
    );
  }

  return {
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
        eventType === "permission.v2.replied" ||
        eventType === "question.asked" ||
        eventType === "question.v2.asked" ||
        eventType === "question.replied" ||
        eventType === "question.v2.replied" ||
        eventType === "question.rejected" ||
        eventType === "question.v2.rejected") &&
      options?.resolveParentExternalSessionId?.(eventExternalSessionId) ===
        subscriber.externalSessionId
    ) {
      return true;
    }

    return false;
  }

  return isEventDirectoryScopedToSubscriber(subscriber, event);
};
