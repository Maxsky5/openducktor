import type { SessionEvent } from "./session-event-types";

type SessionEventBatchRule<TEvent extends SessionEvent = SessionEvent> = {
  immediate: boolean;
  dedupeKey?: (event: TEvent) => string | null;
  merge?: (previous: TEvent, next: TEvent) => TEvent;
  supersedes?: (candidate: SessionEvent, incoming: TEvent) => boolean;
  minEmitIntervalMs?: number | ((event: TEvent) => number | null);
};

type SessionEventBatchRules = {
  [TType in SessionEvent["type"]]: SessionEventBatchRule<Extract<SessionEvent, { type: TType }>>;
};

type SessionEventOfType<TType extends SessionEvent["type"]> = Extract<
  SessionEvent,
  { type: TType }
>;

type QueuedSessionEventEntry = {
  key: string | null;
  event: SessionEvent;
};

const rebuildKeyIndex = (entries: QueuedSessionEventEntry[]): Map<string, number> => {
  const nextIndex = new Map<string, number>();

  for (let index = 0; index < entries.length; index += 1) {
    const key = entries[index]?.key;
    if (key) {
      nextIndex.set(key, index);
    }
  }

  return nextIndex;
};

const SESSION_EVENT_BATCH_RULES: SessionEventBatchRules = {
  session_started: {
    immediate: false,
    dedupeKey: () => "session_started",
  },
  assistant_delta: {
    immediate: false,
    dedupeKey: (event) => `assistant_delta:${event.channel}:${event.messageId}`,
    merge: (previous, next) => ({
      ...next,
      delta: `${previous.delta}${next.delta}`,
    }),
    minEmitIntervalMs: 500,
  },
  assistant_part: {
    immediate: false,
    dedupeKey: (event) =>
      `assistant_part:${event.part.kind}:${event.part.messageId}:${event.part.partId}`,
    minEmitIntervalMs: (event) => {
      if (event.part.kind === "text" || event.part.kind === "reasoning") {
        return event.part.completed ? 0 : 500;
      }
      if (event.part.kind === "tool") {
        return event.part.status === "completed" || event.part.status === "error" ? 0 : 400;
      }
      return 0;
    },
  },
  assistant_message: {
    immediate: false,
    dedupeKey: (event) => `assistant_message:${event.messageId}`,
    supersedes: (candidate, incoming) => {
      if (candidate.type === "assistant_delta") {
        return candidate.messageId === incoming.messageId;
      }

      if (candidate.type === "assistant_part") {
        return candidate.part.messageId === incoming.messageId && candidate.part.kind === "text";
      }

      return false;
    },
    minEmitIntervalMs: 500,
  },
  user_message: {
    immediate: true,
  },
  session_status: {
    immediate: false,
    dedupeKey: () => "session_status",
  },
  permission_required: {
    immediate: true,
  },
  question_required: {
    immediate: true,
  },
  session_todos_updated: {
    immediate: false,
    dedupeKey: () => "session_todos_updated",
  },
  session_error: {
    immediate: true,
  },
  session_idle: {
    immediate: true,
  },
  session_finished: {
    immediate: true,
  },
  tool_call: {
    immediate: false,
    dedupeKey: (event) => `tool_call:${event.call.tool}:${JSON.stringify(event.call.args)}`,
    minEmitIntervalMs: 400,
  },
  tool_result: {
    immediate: false,
    dedupeKey: (event) => `tool_result:${event.tool}:${event.success}:${event.message}`,
    minEmitIntervalMs: 400,
  },
};

const isSessionEventType = <TType extends SessionEvent["type"]>(
  event: SessionEvent,
  type: TType,
): event is SessionEventOfType<TType> => event.type === type;

const withTypedSessionEvent = <T>(
  event: SessionEvent,
  callback: <TType extends SessionEvent["type"]>(
    typedEvent: SessionEventOfType<TType>,
    rule: SessionEventBatchRules[TType],
  ) => T,
): T => {
  switch (event.type) {
    case "session_started":
      return callback(event, SESSION_EVENT_BATCH_RULES.session_started);
    case "assistant_delta":
      return callback(event, SESSION_EVENT_BATCH_RULES.assistant_delta);
    case "assistant_part":
      return callback(event, SESSION_EVENT_BATCH_RULES.assistant_part);
    case "assistant_message":
      return callback(event, SESSION_EVENT_BATCH_RULES.assistant_message);
    case "user_message":
      return callback(event, SESSION_EVENT_BATCH_RULES.user_message);
    case "session_status":
      return callback(event, SESSION_EVENT_BATCH_RULES.session_status);
    case "permission_required":
      return callback(event, SESSION_EVENT_BATCH_RULES.permission_required);
    case "question_required":
      return callback(event, SESSION_EVENT_BATCH_RULES.question_required);
    case "session_todos_updated":
      return callback(event, SESSION_EVENT_BATCH_RULES.session_todos_updated);
    case "session_error":
      return callback(event, SESSION_EVENT_BATCH_RULES.session_error);
    case "session_idle":
      return callback(event, SESSION_EVENT_BATCH_RULES.session_idle);
    case "session_finished":
      return callback(event, SESSION_EVENT_BATCH_RULES.session_finished);
    case "tool_call":
      return callback(event, SESSION_EVENT_BATCH_RULES.tool_call);
    case "tool_result":
      return callback(event, SESSION_EVENT_BATCH_RULES.tool_result);
  }
};

export const isImmediateSessionEvent = (event: SessionEvent): boolean => {
  return SESSION_EVENT_BATCH_RULES[event.type].immediate;
};

const mergeQueuedSessionEvents = (events: SessionEvent[]): QueuedSessionEventEntry[] => {
  const entries: QueuedSessionEventEntry[] = [];
  let keyIndex = new Map<string, number>();

  for (const event of events) {
    withTypedSessionEvent(event, (typedEvent, rule) => {
      if (rule.supersedes) {
        let removed = false;
        for (let index = entries.length - 1; index >= 0; index -= 1) {
          const candidate = entries[index]?.event;
          if (!candidate || !rule.supersedes(candidate, typedEvent)) {
            continue;
          }

          entries.splice(index, 1);
          removed = true;
        }

        if (removed) {
          keyIndex = rebuildKeyIndex(entries);
        }
      }

      const key = rule.dedupeKey?.(typedEvent) ?? null;
      if (!key) {
        entries.push({ key: null, event: typedEvent });
        return;
      }

      const existingIndex = keyIndex.get(key);
      if (existingIndex === undefined) {
        keyIndex.set(key, entries.length);
        entries.push({ key, event: typedEvent });
        return;
      }

      const previous = entries[existingIndex]?.event;
      if (!previous) {
        entries[existingIndex] = { key, event: typedEvent };
        return;
      }

      entries[existingIndex] = {
        key,
        event:
          rule.merge && isSessionEventType(previous, typedEvent.type)
            ? rule.merge(previous, typedEvent)
            : typedEvent,
      };
    });
  }

  return entries;
};

export type PreparedQueuedSessionEvents = {
  readyEvents: SessionEvent[];
  deferredEvents: SessionEvent[];
  nextDelayMs: number | null;
};

export type SessionEventBatcher = {
  prepareQueuedSessionEvents: (events: SessionEvent[]) => PreparedQueuedSessionEvents;
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
      const readyEvents: SessionEvent[] = [];
      const deferredEvents: SessionEvent[] = [];
      let nextDelayMs: number | null = null;
      const emittedAtMs = nowMs();

      for (const entry of mergedEntries) {
        withTypedSessionEvent(entry.event, (typedEvent, rule) => {
          const minEmitIntervalMs =
            typeof rule.minEmitIntervalMs === "function"
              ? rule.minEmitIntervalMs(typedEvent)
              : (rule.minEmitIntervalMs ?? null);

          if (!entry.key || !minEmitIntervalMs) {
            readyEvents.push(typedEvent);
            if (entry.key) {
              lastEmittedAtByKey.set(entry.key, emittedAtMs);
            }
            return;
          }

          const lastEmittedAt = lastEmittedAtByKey.get(entry.key);
          if (lastEmittedAt === undefined) {
            lastEmittedAtByKey.set(entry.key, emittedAtMs);
            readyEvents.push(typedEvent);
            return;
          }

          const elapsedMs = emittedAtMs - lastEmittedAt;
          if (elapsedMs >= minEmitIntervalMs) {
            lastEmittedAtByKey.set(entry.key, emittedAtMs);
            readyEvents.push(typedEvent);
            return;
          }

          deferredEvents.push(typedEvent);
          const remainingMs = minEmitIntervalMs - elapsedMs;
          nextDelayMs = nextDelayMs === null ? remainingMs : Math.min(nextDelayMs, remainingMs);
        });
      }

      return {
        readyEvents,
        deferredEvents,
        nextDelayMs,
      };
    },
  };
};
