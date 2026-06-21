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
  "session_error",
  "session_idle",
  "session_finished",
] as const satisfies readonly SessionEvent["type"][];

type ImmediateSessionEvent = Extract<
  SessionEvent,
  { type: (typeof IMMEDIATE_SESSION_EVENT_TYPE_LIST)[number] }
>;

export type QueuedSessionEvent = Exclude<SessionEvent, ImmediateSessionEvent>;

type QueuedSessionEventEntry = {
  key: string;
  event: QueuedSessionEvent;
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

  return event;
};

const shouldDropQueuedCandidate = (
  event: QueuedSessionEvent,
  candidate: QueuedSessionEvent,
): boolean => {
  if (event.type !== "assistant_message") {
    return false;
  }

  if (candidate.type === "assistant_delta") {
    return candidate.messageId === event.messageId;
  }

  if (candidate.type === "assistant_part") {
    return candidate.part.messageId === event.messageId && candidate.part.kind === "text";
  }

  return false;
};

export const isImmediateSessionEvent = (event: SessionEvent): event is ImmediateSessionEvent => {
  return IMMEDIATE_SESSION_EVENT_TYPES.has(event.type);
};

export const closesQueuedSessionEvents = (event: ImmediateSessionEvent): boolean =>
  event.type === "session_error" ||
  event.type === "session_finished" ||
  event.type === "session_idle";

const mergeQueuedSessionEvents = (events: QueuedSessionEvent[]): QueuedSessionEventEntry[] => {
  const entries: QueuedSessionEventEntry[] = [];

  for (const event of events) {
    for (let index = entries.length - 1; index >= 0; index -= 1) {
      const candidate = entries[index]?.event;
      if (candidate && shouldDropQueuedCandidate(event, candidate)) {
        entries.splice(index, 1);
      }
    }

    const key = queuedSessionEventKey(event);
    const existingIndex = entries.findIndex((entry) => entry.key === key);
    if (existingIndex === -1) {
      entries.push({ key, event });
      continue;
    }

    const previous = entries[existingIndex]?.event;
    if (!previous) {
      entries[existingIndex] = { key, event };
      continue;
    }

    entries[existingIndex] = {
      key,
      event: mergeQueuedSessionEvent(previous, event),
    };
  }

  return entries;
};

export type PreparedQueuedSessionEvents = {
  readyEvents: QueuedSessionEvent[];
  deferredEvents: QueuedSessionEvent[];
  nextDelayMs: number | null;
};

export type SessionEventBatcher = {
  prepareQueuedSessionEvents: (events: QueuedSessionEvent[]) => PreparedQueuedSessionEvents;
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
      const readyEvents: QueuedSessionEvent[] = [];
      const deferredEvents: QueuedSessionEvent[] = [];
      let nextDelayMs: number | null = null;
      const emittedAtMs = nowMs();

      for (const entry of mergedEntries) {
        const minEmitIntervalMs = queuedSessionEventMinEmitIntervalMs(entry.event);

        if (!minEmitIntervalMs) {
          lastEmittedAtByKey.set(entry.key, emittedAtMs);
          readyEvents.push(entry.event);
          continue;
        }

        const lastEmittedAt = lastEmittedAtByKey.get(entry.key);
        if (lastEmittedAt === undefined) {
          lastEmittedAtByKey.set(entry.key, emittedAtMs);
          readyEvents.push(entry.event);
          continue;
        }

        const elapsedMs = emittedAtMs - lastEmittedAt;
        if (elapsedMs >= minEmitIntervalMs) {
          lastEmittedAtByKey.set(entry.key, emittedAtMs);
          readyEvents.push(entry.event);
          continue;
        }

        deferredEvents.push(entry.event);
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
