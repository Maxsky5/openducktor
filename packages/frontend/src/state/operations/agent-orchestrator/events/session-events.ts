import { toast } from "sonner";
import { matchesAgentSessionIdentity } from "@/lib/agent-session-identity";
import { createSessionEventBatcher, isImmediateSessionEvent } from "./session-event-batching";
import type {
  ListenToAgentSessionParams,
  SessionEvent,
  SessionEventHandlerContext,
} from "./session-event-types";
import { createSessionEventHandlerContext } from "./session-event-types";
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

const hasSessionStateChanges = (current: object, next: object): boolean => {
  for (const key of Object.keys(next) as Array<keyof typeof next>) {
    if (next[key] !== current[key]) {
      return true;
    }
  }

  return false;
};

const handleMcpReconnectStarted = (
  event: Extract<SessionEvent, { type: "mcp_reconnect_started" }>,
): void => {
  const details = event.errorDetails ? ` ${event.errorDetails}.` : "";
  toast.info("Reconnecting OpenDucktor MCP", {
    description: `OpenDucktor MCP is ${event.status} for ${event.workingDirectory}.${details} OpenDucktor is trying to reconnect.`,
  });
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
    case "approval_required":
      handlePermissionRequired(context.lifecycle, event);
      return;
    case "approval_resolved":
      handlePermissionResolved(context.lifecycle, event);
      return;
    case "mcp_reconnect_started":
      handleMcpReconnectStarted(event);
      return;
    case "question_required":
      handleQuestionRequired(context.lifecycle, event);
      return;
    case "question_resolved":
      handleQuestionResolved(context.lifecycle, event);
      return;
    case "session_todos_updated":
      handleSessionTodosUpdated(context.lifecycle, event);
      return;
    case "session_compaction_started":
      handleSessionCompactionStarted(context.lifecycle, event);
      return;
    case "session_compacted":
      handleSessionCompacted(context.lifecycle, event);
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

const isObservedSessionMounted = ({
  sessionRef,
  sessionsRef,
}: Pick<ListenToAgentSessionParams, "sessionRef" | "sessionsRef">): boolean =>
  matchesAgentSessionIdentity(sessionsRef.current[sessionRef.externalSessionId], sessionRef);

export const listenToAgentSessionEvents = async (
  context: ListenToAgentSessionParams,
): Promise<() => void> => {
  const externalSessionId = context.sessionRef.externalSessionId;
  const contextUsageMessageIdBySessionRef = context.contextUsageMessageIdBySessionRef ?? {
    current: {} as Record<string, string>,
  };
  const eventContext = {
    ...context,
    contextUsageMessageIdBySessionRef,
  };
  const handlerContext = createSessionEventHandlerContext(eventContext);
  const batchWindowMs = context.eventBatchWindowMs ?? SESSION_EVENT_BATCH_WINDOW_MS;
  const batcher = createSessionEventBatcher();
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

    if (!isObservedSessionMounted(eventContext)) {
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

    const batchedSessionsRef = {
      current: context.sessionsRef.current,
    };
    let shouldPersistBufferedSession = false;
    let hasBufferedSessionUpdate = false;
    const batchedHandlerContext = createSessionEventHandlerContext({
      ...eventContext,
      sessionsRef: batchedSessionsRef,
      updateSession: (targetExternalSessionId, updater, options) => {
        if (targetExternalSessionId !== externalSessionId) {
          context.updateSession(targetExternalSessionId, updater, options);
          return;
        }

        const current = batchedSessionsRef.current[targetExternalSessionId];
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
          [targetExternalSessionId]: next,
        };
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

    const nextSession = batchedSessionsRef.current[externalSessionId];
    if (!nextSession) {
      if (queuedEvents.length > 0) {
        scheduleQueuedFlush(nextDelayMs ?? batchWindowMs);
      }
      return;
    }

    context.updateSession(
      externalSessionId,
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
    if (!isObservedSessionMounted(eventContext)) {
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
