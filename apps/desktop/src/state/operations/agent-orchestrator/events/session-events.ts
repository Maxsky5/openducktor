import type {
  AttachAgentSessionListenerParams,
  SessionEvent,
  SessionEventHandlerContext,
} from "./session-event-types";
import { createSessionEventHandlerContext } from "./session-event-types";
import {
  handleAssistantMessage,
  handlePermissionRequired,
  handleQuestionRequired,
  handleSessionError,
  handleSessionFinished,
  handleSessionIdle,
  handleSessionStarted,
  handleSessionStatus,
  handleSessionTodosUpdated,
  handleUserMessage,
} from "./session-lifecycle";
import { handleAssistantDelta, handleAssistantPart } from "./session-parts";

const SESSION_EVENT_BATCH_WINDOW_MS = process.env.NODE_ENV === "test" ? 0 : 200;

const hasSessionStateChanges = (current: object, next: object): boolean => {
  for (const key of Object.keys(next) as Array<keyof typeof next>) {
    if (next[key] !== current[key]) {
      return true;
    }
  }

  return false;
};

const queuedEventKey = (event: SessionEvent): string | null => {
  switch (event.type) {
    case "assistant_delta":
      return `assistant_delta:${event.channel}:${event.messageId}`;
    case "assistant_part":
      return `assistant_part:${event.part.kind}:${event.part.messageId}:${event.part.partId}`;
    case "assistant_message":
      return `assistant_message:${event.messageId}`;
    case "session_started":
    case "session_status":
    case "session_todos_updated":
      return event.type;
    case "user_message":
    case "permission_required":
    case "question_required":
    case "session_error":
    case "session_idle":
    case "session_finished":
    case "tool_call":
    case "tool_result":
      return null;
  }
};

const removeSupersededQueuedEvents = (merged: SessionEvent[], event: SessionEvent): void => {
  if (event.type !== "assistant_message") {
    return;
  }

  for (let index = merged.length - 1; index >= 0; index -= 1) {
    const candidate = merged[index];
    if (!candidate) {
      continue;
    }

    if (candidate.type === "assistant_delta" && candidate.messageId === event.messageId) {
      merged.splice(index, 1);
      continue;
    }

    if (
      candidate.type === "assistant_part" &&
      candidate.part.messageId === event.messageId &&
      candidate.part.kind === "text"
    ) {
      merged.splice(index, 1);
    }
  }
};

const mergeQueuedEvents = (events: SessionEvent[]): SessionEvent[] => {
  const merged: SessionEvent[] = [];
  const eventIndexByKey = new Map<string, number>();

  for (const event of events) {
    removeSupersededQueuedEvents(merged, event);

    const key = queuedEventKey(event);
    if (!key) {
      merged.push(event);
      continue;
    }

    const existingIndex = eventIndexByKey.get(key);
    if (existingIndex === undefined) {
      eventIndexByKey.set(key, merged.length);
      merged.push(event);
      continue;
    }

    const existing = merged[existingIndex];
    if (existing?.type === "assistant_delta" && event.type === "assistant_delta") {
      merged[existingIndex] = {
        ...event,
        delta: `${existing.delta}${event.delta}`,
      };
      continue;
    }

    merged[existingIndex] = event;
  }

  return merged;
};

const handleSessionEvent = (context: SessionEventHandlerContext, event: SessionEvent): void => {
  switch (event.type) {
    case "session_started":
      handleSessionStarted(context.lifecycle, event);
      return;
    case "assistant_delta":
      handleAssistantDelta(context.parts, event);
      return;
    case "assistant_part":
      handleAssistantPart(context.parts, event);
      return;
    case "assistant_message":
      handleAssistantMessage(context.lifecycle, event);
      return;
    case "user_message":
      handleUserMessage(context.lifecycle, event);
      return;
    case "session_status":
      handleSessionStatus(context.lifecycle, event);
      return;
    case "permission_required":
      handlePermissionRequired(context.lifecycle, event);
      return;
    case "question_required":
      handleQuestionRequired(context.lifecycle, event);
      return;
    case "session_todos_updated":
      handleSessionTodosUpdated(context.lifecycle, event);
      return;
    case "session_error":
      handleSessionError(context.lifecycle, event);
      return;
    case "session_idle":
      handleSessionIdle(context.lifecycle, event);
      return;
    case "session_finished":
      handleSessionFinished(context.lifecycle, event);
      return;
    case "tool_call":
    case "tool_result":
      return;
  }
};

const isImmediateSessionEvent = (event: SessionEvent): boolean => {
  switch (event.type) {
    case "user_message":
    case "permission_required":
    case "question_required":
    case "session_error":
    case "session_idle":
    case "session_finished":
      return true;
    case "assistant_message":
    case "session_started":
    case "assistant_delta":
    case "assistant_part":
    case "session_status":
    case "session_todos_updated":
    case "tool_call":
    case "tool_result":
      return false;
  }
};

export const attachAgentSessionListener = (
  context: AttachAgentSessionListenerParams,
): (() => void) => {
  const handlerContext = createSessionEventHandlerContext(context);
  const batchWindowMs = context.eventBatchWindowMs ?? SESSION_EVENT_BATCH_WINDOW_MS;
  let queuedEvents: SessionEvent[] = [];
  let batchTimeoutId: ReturnType<typeof setTimeout> | null = null;

  const flushQueuedEvents = (): void => {
    if (batchTimeoutId !== null) {
      clearTimeout(batchTimeoutId);
      batchTimeoutId = null;
    }

    if (queuedEvents.length === 0) {
      return;
    }

    const eventsToHandle = mergeQueuedEvents(queuedEvents);
    queuedEvents = [];

    const batchedSessionsRef = {
      current: context.sessionsRef.current,
    };
    let shouldPersistBufferedSession = false;
    let hasBufferedSessionUpdate = false;
    const batchedHandlerContext = createSessionEventHandlerContext({
      ...context,
      sessionsRef: batchedSessionsRef,
      updateSession: (sessionId, updater, options) => {
        if (sessionId !== context.sessionId) {
          context.updateSession(sessionId, updater, options);
          return;
        }

        const current = batchedSessionsRef.current[sessionId];
        if (!current) {
          return;
        }

        const next = updater(current);
        if (next === current || !hasSessionStateChanges(current, next)) {
          return;
        }

        hasBufferedSessionUpdate = true;
        if (options?.persist === true) {
          shouldPersistBufferedSession = true;
        }
        batchedSessionsRef.current = {
          ...batchedSessionsRef.current,
          [sessionId]: next,
        };
      },
    });

    for (const queuedEvent of eventsToHandle) {
      handleSessionEvent(batchedHandlerContext, queuedEvent);
    }

    if (!hasBufferedSessionUpdate) {
      return;
    }

    const nextSession = batchedSessionsRef.current[context.sessionId];
    if (!nextSession) {
      return;
    }

    context.updateSession(
      context.sessionId,
      () => nextSession,
      shouldPersistBufferedSession ? { persist: true } : undefined,
    );
  };

  const scheduleQueuedFlush = (): void => {
    if (batchWindowMs <= 0) {
      flushQueuedEvents();
      return;
    }
    if (batchTimeoutId !== null) {
      return;
    }
    batchTimeoutId = setTimeout(() => {
      batchTimeoutId = null;
      flushQueuedEvents();
    }, batchWindowMs);
  };

  const unsubscribe = context.adapter.subscribeEvents(context.sessionId, (event) => {
    if (isImmediateSessionEvent(event)) {
      flushQueuedEvents();
      handleSessionEvent(handlerContext, event);
      return;
    }

    queuedEvents.push(event);
    scheduleQueuedFlush();
  });

  return () => {
    flushQueuedEvents();
    unsubscribe();
  };
};

export type { SessionEventAdapter } from "./session-event-types";
