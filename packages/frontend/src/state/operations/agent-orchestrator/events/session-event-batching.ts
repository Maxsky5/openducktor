import type { SessionEvent } from "./session-event-types";

const IMMEDIATE_SESSION_EVENT_TYPE_LIST = [
  "user_message",
  "approval_required",
  "approval_resolved",
  "mcp_reconnect_started",
  "question_required",
  "question_resolved",
  "session_compaction_started",
  "session_compacted",
  "transcript_retracted",
  "session_context_updated",
  "session_context_error",
  "runtime_slash_commands_changed",
  "session_error",
  "session_idle",
  "session_finished",
] as const satisfies readonly SessionEvent["type"][];

type ImmediateSessionEvent = Extract<
  SessionEvent,
  { type: (typeof IMMEDIATE_SESSION_EVENT_TYPE_LIST)[number] }
>;

export type QueuedSessionEvent = Exclude<SessionEvent, ImmediateSessionEvent>;

type QueuedSessionEventEntry<
  Item extends QueuedSessionEventBatchItem = QueuedSessionEventBatchItem,
> = {
  key: string;
  item: Item;
};

const IMMEDIATE_SESSION_EVENT_TYPES = new Set<SessionEvent["type"]>(
  IMMEDIATE_SESSION_EVENT_TYPE_LIST,
);

const minAssistantPartEmitIntervalMs = (
  event: Extract<QueuedSessionEvent, { type: "assistant_part" }>,
): number | null => {
  if (event.part.kind === "text" || event.part.kind === "reasoning") {
    return event.part.completed ? null : 500;
  }
  if (event.part.kind === "tool") {
    return event.part.status === "completed" || event.part.status === "error" ? null : 400;
  }
  return null;
};

const assertUnhandledQueuedSessionEvent = (event: never): never => {
  throw new Error(`Unhandled queued session event '${JSON.stringify(event)}'.`);
};

const queuedSessionEventKey = (event: QueuedSessionEvent): string => {
  switch (event.type) {
    case "session_started":
      return "session_started";
    case "assistant_delta":
      return `assistant_delta:${event.channel}:${event.messageId}`;
    case "assistant_part":
      return `assistant_part:${event.part.kind}:${event.part.messageId}:${event.part.partId}`;
    case "assistant_message":
      return `assistant_message:${event.messageId}`;
    case "session_status":
      return "session_status";
    case "session_todos_updated":
      return "session_todos_updated";
    default:
      return assertUnhandledQueuedSessionEvent(event);
  }
};

const queuedSessionEventMinEmitIntervalMs = (event: QueuedSessionEvent): number | null => {
  switch (event.type) {
    case "assistant_delta":
    case "assistant_message":
      return 500;
    case "assistant_part":
      return minAssistantPartEmitIntervalMs(event);
    case "session_started":
    case "session_status":
    case "session_todos_updated":
      return null;
    default:
      return assertUnhandledQueuedSessionEvent(event);
  }
};

const mergeQueuedSessionEvent = (
  previous: QueuedSessionEvent,
  event: QueuedSessionEvent,
): QueuedSessionEvent => {
  if (previous.type === "assistant_delta" && event.type === "assistant_delta") {
    return {
      ...event,
      delta: `${previous.delta}${event.delta}`,
    };
  }

  if (
    previous.type === "assistant_part" &&
    previous.part.kind === "subagent" &&
    event.type === "assistant_part" &&
    event.part.kind === "subagent"
  ) {
    return {
      ...event,
      part: {
        ...previous.part,
        ...event.part,
      },
    };
  }

  return event;
};

const shouldDropQueuedCandidate = (
  item: QueuedSessionEventBatchItem,
  candidate: QueuedSessionEventBatchItem,
): boolean => {
  const { event } = item;
  if (candidate.routeKey !== item.routeKey) {
    return false;
  }

  if (candidate.event.externalSessionId !== event.externalSessionId) {
    return false;
  }

  if (event.type === "assistant_message") {
    if (candidate.event.type === "assistant_delta") {
      return candidate.event.messageId === event.messageId;
    }

    if (candidate.event.type === "assistant_part") {
      return (
        candidate.event.part.messageId === event.messageId && candidate.event.part.kind === "text"
      );
    }
  }

  if (
    event.type === "assistant_part" &&
    event.part.kind === "text" &&
    event.part.completed &&
    !event.part.synthetic &&
    candidate.event.type === "assistant_delta"
  ) {
    return candidate.event.messageId === event.part.messageId && candidate.event.channel === "text";
  }

  return false;
};

export const isImmediateSessionEvent = (event: SessionEvent): event is ImmediateSessionEvent => {
  return IMMEDIATE_SESSION_EVENT_TYPES.has(event.type);
};

export const shouldFlushQueuedSessionEventImmediately = (event: QueuedSessionEvent): boolean =>
  event.type === "assistant_part" &&
  event.part.kind === "text" &&
  minAssistantPartEmitIntervalMs(event) === null;

const mergeQueuedSessionEvents = <Item extends QueuedSessionEventBatchItem>(
  events: Item[],
): QueuedSessionEventEntry<Item>[] => {
  const entries: QueuedSessionEventEntry<Item>[] = [];

  for (const item of events) {
    for (let index = entries.length - 1; index >= 0; index -= 1) {
      const candidate = entries[index]?.item;
      if (candidate && shouldDropQueuedCandidate(item, candidate)) {
        entries.splice(index, 1);
      }
    }

    const key = `${item.routeKey}:${queuedSessionEventKey(item.event)}`;
    const existingIndex = entries.findIndex((entry) => entry.key === key);
    if (existingIndex === -1) {
      entries.push({ key, item });
      continue;
    }

    const previous = entries[existingIndex]?.item;
    if (!previous) {
      entries[existingIndex] = { key, item };
      continue;
    }

    entries[existingIndex] = {
      key,
      item: {
        ...item,
        event: mergeQueuedSessionEvent(previous.event, item.event),
      } as Item,
    };
  }

  return entries;
};

export const prepareForcedQueuedSessionEvents = <Item extends QueuedSessionEventBatchItem>(
  events: Item[],
): Item[] => mergeQueuedSessionEvents(events).map((entry) => entry.item);

export type QueuedSessionEventBatchItem<Event extends QueuedSessionEvent = QueuedSessionEvent> = {
  event: Event;
  routeKey: string;
};

export type PreparedQueuedSessionEvents<
  Item extends QueuedSessionEventBatchItem = QueuedSessionEventBatchItem,
> = {
  readyEvents: Item[];
  deferredEvents: Item[];
  nextDelayMs: number | null;
};

export type SessionEventBatcher = {
  prepareQueuedSessionEvents: <Item extends QueuedSessionEventBatchItem>(
    events: Item[],
  ) => PreparedQueuedSessionEvents<Item>;
};

type CreateSessionEventBatcherOptions = {
  nowMs?: () => number;
};

export const createSessionEventBatcher = (
  options: CreateSessionEventBatcherOptions = {},
): SessionEventBatcher => {
  const lastEmittedAtByKey = new Map<string, number>();
  const nowMs = options.nowMs ?? (() => Date.now());

  return {
    prepareQueuedSessionEvents: (events) => {
      const mergedEntries = mergeQueuedSessionEvents(events);
      const readyEvents: typeof events = [];
      const deferredEvents: typeof events = [];
      let nextDelayMs: number | null = null;
      const emittedAtMs = nowMs();

      for (const entry of mergedEntries) {
        const minEmitIntervalMs = queuedSessionEventMinEmitIntervalMs(entry.item.event);
        if (!minEmitIntervalMs) {
          lastEmittedAtByKey.set(entry.key, emittedAtMs);
          readyEvents.push(entry.item);
          continue;
        }

        const lastEmittedAt = lastEmittedAtByKey.get(entry.key);
        if (lastEmittedAt === undefined) {
          lastEmittedAtByKey.set(entry.key, emittedAtMs);
          readyEvents.push(entry.item);
          continue;
        }

        const elapsedMs = emittedAtMs - lastEmittedAt;
        if (elapsedMs >= minEmitIntervalMs) {
          lastEmittedAtByKey.set(entry.key, emittedAtMs);
          readyEvents.push(entry.item);
          continue;
        }

        deferredEvents.push(entry.item);
        const remainingMs = minEmitIntervalMs - elapsedMs;
        nextDelayMs = nextDelayMs === null ? remainingMs : Math.min(nextDelayMs, remainingMs);
      }

      return {
        readyEvents,
        deferredEvents,
        nextDelayMs,
      };
    },
  };
};
