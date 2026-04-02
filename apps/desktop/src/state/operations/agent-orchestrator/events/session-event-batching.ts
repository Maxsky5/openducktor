import type { SessionEvent } from "./session-event-types";

type SessionEventBatchRule<TEvent extends SessionEvent = SessionEvent> = {
  immediate: boolean;
  dedupeKey?: (event: TEvent) => string | null;
  merge?: (previous: TEvent, next: TEvent) => TEvent;
  supersedes?: (candidate: SessionEvent, incoming: TEvent) => boolean;
};

type SessionEventBatchRules = {
  [TType in SessionEvent["type"]]: SessionEventBatchRule<Extract<SessionEvent, { type: TType }>>;
};

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
  },
  assistant_part: {
    immediate: false,
    dedupeKey: (event) =>
      `assistant_part:${event.part.kind}:${event.part.messageId}:${event.part.partId}`,
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
  },
  tool_result: {
    immediate: false,
  },
};

export const isImmediateSessionEvent = (event: SessionEvent): boolean => {
  return SESSION_EVENT_BATCH_RULES[event.type].immediate;
};

export const prepareQueuedSessionEvents = (events: SessionEvent[]): SessionEvent[] => {
  const entries: QueuedSessionEventEntry[] = [];
  let keyIndex = new Map<string, number>();

  for (const event of events) {
    const rule = SESSION_EVENT_BATCH_RULES[event.type];

    if (rule.supersedes) {
      let removed = false;
      for (let index = entries.length - 1; index >= 0; index -= 1) {
        const candidate = entries[index]?.event;
        if (!candidate || !rule.supersedes(candidate, event as never)) {
          continue;
        }

        entries.splice(index, 1);
        removed = true;
      }

      if (removed) {
        keyIndex = rebuildKeyIndex(entries);
      }
    }

    const key = rule.dedupeKey?.(event as never) ?? null;
    if (!key) {
      entries.push({ key: null, event });
      continue;
    }

    const existingIndex = keyIndex.get(key);
    if (existingIndex === undefined) {
      keyIndex.set(key, entries.length);
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
      event: rule.merge ? rule.merge(previous as never, event as never) : event,
    };
  }

  return entries.map((entry) => entry.event);
};
