import { toast } from "sonner";
import {
  closesQueuedSessionEvents,
  createSessionEventBatcher,
  isImmediateSessionEvent,
} from "./session-event-batching";
import { createSessionEventRouter } from "./session-event-router";
import type {
  ObserveAgentSessionParams,
  SessionEvent,
  SessionEventContext,
} from "./session-event-types";
import {
  handleAssistantMessage,
  handleSessionCompacted,
  handleSessionCompactionStarted,
  handleSessionError,
  handleSessionFinished,
  handleSessionIdle,
  handleSessionStarted,
  handleSessionStatus,
  handleSessionTodosUpdated,
  handleUserMessage,
} from "./session-lifecycle";
import { handleAssistantDelta, handleAssistantPart } from "./session-parts";
import {
  handlePermissionRequired,
  handlePermissionResolved,
  handleQuestionRequired,
  handleQuestionResolved,
} from "./session-pending-input";

const SESSION_EVENT_BATCH_WINDOW_MS = process.env.NODE_ENV === "test" ? 0 : 500;

const handleMcpReconnectStarted = (
  event: Extract<SessionEvent, { type: "mcp_reconnect_started" }>,
): void => {
  const details = event.errorDetails ? ` ${event.errorDetails}.` : "";
  toast.info("Reconnecting OpenDucktor MCP", {
    description: `OpenDucktor MCP is ${event.status} for ${event.workingDirectory}.${details} OpenDucktor is trying to reconnect.`,
  });
};

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
    case "user_message":
      handleUserMessage(context, event);
      return;
    case "session_status":
      handleSessionStatus(context, event);
      return;
    case "approval_required":
      handlePermissionRequired(context, event);
      return;
    case "approval_resolved":
      handlePermissionResolved(context, event);
      return;
    case "mcp_reconnect_started":
      handleMcpReconnectStarted(event);
      return;
    case "question_required":
      handleQuestionRequired(context, event);
      return;
    case "question_resolved":
      handleQuestionResolved(context, event);
      return;
    case "session_todos_updated":
      handleSessionTodosUpdated(context, event);
      return;
    case "session_compaction_started":
      handleSessionCompactionStarted(context, event);
      return;
    case "session_compacted":
      handleSessionCompacted(context, event);
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
  }
};

export const listenToAgentSessionEvents = async (
  context: ObserveAgentSessionParams,
): Promise<() => void> => {
  const batchWindowMs = context.eventBatchWindowMs ?? SESSION_EVENT_BATCH_WINDOW_MS;
  const router = createSessionEventRouter({
    createBatcher: createSessionEventBatcher,
    context,
    handleEvent: handleSessionEvent,
  });
  let batchTimeoutId: ReturnType<typeof setTimeout> | null = null;

  const cancelQueuedFlush = (): void => {
    if (batchTimeoutId !== null) {
      clearTimeout(batchTimeoutId);
      batchTimeoutId = null;
    }
  };

  const flushQueuedEvents = (): void => {
    cancelQueuedFlush();

    if (!router.hasQueuedEvents()) {
      return;
    }

    const nextDelayMs = router.flushReady();

    if (router.hasQueuedEvents()) {
      scheduleQueuedFlush(nextDelayMs ?? batchWindowMs);
    }
  };

  const scheduleQueuedFlush = (delayMs = batchWindowMs): void => {
    if (delayMs <= 0) {
      flushQueuedEvents();
      return;
    }
    if (batchTimeoutId !== null) {
      return;
    }
    batchTimeoutId = setTimeout(() => {
      batchTimeoutId = null;
      flushQueuedEvents();
    }, delayMs);
  };

  const unsubscribe = await context.adapter.subscribeEvents(context.sessionRef, (event) => {
    if (isImmediateSessionEvent(event)) {
      router.handleImmediate(event, {
        clearQueuedSession: closesQueuedSessionEvents(event),
      });
      return;
    }

    if (router.enqueue(event)) {
      scheduleQueuedFlush();
    }
  });
  return () => {
    cancelQueuedFlush();
    router.flushAll();
    unsubscribe();
  };
};

export type { SessionEventAdapter } from "./session-event-types";
