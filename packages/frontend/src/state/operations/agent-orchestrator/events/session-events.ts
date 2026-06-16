import { toast } from "sonner";
import { matchesAgentSessionIdentity } from "@/lib/agent-session-identity";
import { hasAgentSessionStateChanges } from "@/state/agent-session-collection";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import {
  createSessionEventBatcher,
  isImmediateSessionEvent,
  type QueuedSessionEvent,
} from "./session-event-batching";
import type {
  ObserveAgentSessionParams,
  SessionEvent,
  SessionEventContext,
} from "./session-event-types";
import { createSessionEventContext } from "./session-event-types";
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

const isObservedSessionMounted = ({
  sessionRef,
  readSession,
}: Pick<ObserveAgentSessionParams, "sessionRef" | "readSession">): boolean =>
  readSession(sessionRef) !== null;

export const listenToAgentSessionEvents = async (
  context: ObserveAgentSessionParams,
): Promise<() => void> => {
  const handlerContext = createSessionEventContext(context);
  const batchWindowMs = context.eventBatchWindowMs ?? SESSION_EVENT_BATCH_WINDOW_MS;
  const batcher = createSessionEventBatcher();
  let queuedEvents: QueuedSessionEvent[] = [];
  let batchTimeoutId: ReturnType<typeof setTimeout> | null = null;

  const flushQueuedEvents = (): void => {
    if (batchTimeoutId !== null) {
      clearTimeout(batchTimeoutId);
      batchTimeoutId = null;
    }

    if (queuedEvents.length === 0) {
      return;
    }

    if (!isObservedSessionMounted(context)) {
      queuedEvents = [];
      return;
    }

    const { readyEvents, deferredEvents, nextDelayMs } =
      batcher.prepareQueuedSessionEvents(queuedEvents);
    queuedEvents = deferredEvents;

    if (readyEvents.length === 0) {
      if (queuedEvents.length > 0) {
        scheduleQueuedFlush(nextDelayMs ?? batchWindowMs);
      }
      return;
    }

    let bufferedSession: AgentSessionState | null = context.readSession(context.sessionRef);
    let shouldPersistBufferedSession = false;
    let hasBufferedSessionUpdate = false;
    const batchedHandlerContext = createSessionEventContext({
      ...context,
      readSession: (identity) => {
        if (matchesAgentSessionIdentity(identity, context.sessionRef)) {
          return bufferedSession;
        }
        return context.readSession(identity);
      },
      updateSession: (targetSessionIdentity, updater, options) => {
        if (!matchesAgentSessionIdentity(targetSessionIdentity, context.sessionRef)) {
          return context.updateSession(targetSessionIdentity, updater, options);
        }

        const current = bufferedSession;
        if (!current) {
          return null;
        }

        const next = updater(current);
        if (next === current || !hasAgentSessionStateChanges(current, next)) {
          return null;
        }

        hasBufferedSessionUpdate = true;
        if (options?.persist === true) {
          shouldPersistBufferedSession = true;
        }
        bufferedSession = next;
        return next;
      },
    });

    for (const queuedEvent of readyEvents) {
      handleSessionEvent(batchedHandlerContext, queuedEvent);
    }

    if (!hasBufferedSessionUpdate) {
      if (queuedEvents.length > 0) {
        scheduleQueuedFlush(nextDelayMs ?? batchWindowMs);
      }
      return;
    }

    const nextSession = bufferedSession;
    if (!nextSession) {
      if (queuedEvents.length > 0) {
        scheduleQueuedFlush(nextDelayMs ?? batchWindowMs);
      }
      return;
    }

    context.updateSession(
      context.sessionRef,
      () => nextSession,
      shouldPersistBufferedSession ? { persist: true } : undefined,
    );

    if (queuedEvents.length > 0) {
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
    if (!isObservedSessionMounted(context)) {
      queuedEvents = [];
      return;
    }

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
