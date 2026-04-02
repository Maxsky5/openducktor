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

const mergeAdjacentQueuedEvents = (events: SessionEvent[]): SessionEvent[] => {
  const merged: SessionEvent[] = [];

  for (const event of events) {
    const previousEvent = merged[merged.length - 1];

    if (
      previousEvent?.type === "assistant_delta" &&
      event.type === "assistant_delta" &&
      previousEvent.channel === event.channel &&
      previousEvent.messageId === event.messageId
    ) {
      merged[merged.length - 1] = {
        ...event,
        delta: `${previousEvent.delta}${event.delta}`,
      };
      continue;
    }

    if (
      previousEvent?.type === "assistant_part" &&
      event.type === "assistant_part" &&
      previousEvent.part.kind === event.part.kind &&
      previousEvent.part.messageId === event.part.messageId &&
      previousEvent.part.partId === event.part.partId &&
      (event.part.kind === "text" || event.part.kind === "reasoning")
    ) {
      merged[merged.length - 1] = event;
      continue;
    }

    merged.push(event);
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

    const eventsToHandle = mergeAdjacentQueuedEvents(queuedEvents);
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
