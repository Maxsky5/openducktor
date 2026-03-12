import type {
  AttachAgentSessionListenerParams,
  SessionEvent,
  SessionEventContext,
} from "./session-event-types";
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
} from "./session-lifecycle";
import { handleAssistantDelta, handleAssistantPart } from "./session-parts";

const SESSION_EVENT_BATCH_WINDOW_MS = process.env.NODE_ENV === "test" ? 0 : 200;

const handleSessionEvent = (context: SessionEventContext, event: SessionEvent): void => {
  switch (event.type) {
    case "session_started":
      handleSessionStarted(context, event);
      return;
    case "assistant_delta":
      handleAssistantDelta(context, event);
      return;
    case "assistant_part":
      handleAssistantPart(context, event);
      return;
    case "assistant_message":
      handleAssistantMessage(context, event);
      return;
    case "session_status":
      handleSessionStatus(context, event);
      return;
    case "permission_required":
      handlePermissionRequired(context, event);
      return;
    case "question_required":
      handleQuestionRequired(context, event);
      return;
    case "session_todos_updated":
      handleSessionTodosUpdated(context, event);
      return;
    case "session_error":
      handleSessionError(context, event);
      return;
    case "session_idle":
      handleSessionIdle(context, event);
      return;
    case "session_finished":
      handleSessionFinished(context, event);
      return;
    case "tool_call":
    case "tool_result":
      return;
  }
};

const isImmediateSessionEvent = (event: SessionEvent): boolean => {
  switch (event.type) {
    case "assistant_message":
    case "permission_required":
    case "question_required":
    case "session_error":
    case "session_idle":
    case "session_finished":
      return true;
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

    const eventsToHandle = queuedEvents;
    queuedEvents = [];
    for (const queuedEvent of eventsToHandle) {
      handleSessionEvent(context, queuedEvent);
    }
  };

  const scheduleQueuedFlush = (): void => {
    if (SESSION_EVENT_BATCH_WINDOW_MS <= 0) {
      flushQueuedEvents();
      return;
    }
    if (batchTimeoutId !== null) {
      return;
    }
    batchTimeoutId = setTimeout(() => {
      batchTimeoutId = null;
      flushQueuedEvents();
    }, SESSION_EVENT_BATCH_WINDOW_MS);
  };

  const unsubscribe = context.adapter.subscribeEvents(context.sessionId, (event) => {
    if (isImmediateSessionEvent(event)) {
      flushQueuedEvents();
      handleSessionEvent(context, event);
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
