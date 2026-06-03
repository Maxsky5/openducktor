import { toast } from "sonner";
import { runOrchestratorSideEffect } from "../support/async-side-effects";
import {
  mergeSubagentPendingApprovalOverlay,
  mergeSubagentPendingQuestionOverlay,
} from "../support/subagent-approval-overlay";
import { createSessionEventBatcher, isImmediateSessionEvent } from "./session-event-batching";
import type {
  AttachAgentSessionListenerParams,
  SessionEvent,
  SessionEventHandlerContext,
} from "./session-event-types";
import { createSessionEventHandlerContext } from "./session-event-types";
import {
  handleAssistantMessage,
  handlePermissionRequired,
  handlePermissionResolved,
  handleQuestionRequired,
  handleQuestionResolved,
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

const SESSION_EVENT_BATCH_WINDOW_MS = process.env.NODE_ENV === "test" ? 0 : 500;
const SUBAGENT_PENDING_INPUT_FOLLOWUP_SYNC_DELAY_MS = process.env.NODE_ENV === "test" ? 0 : 750;

type LinkedSubagentInputSync = {
  childExternalSessionId: string;
  needsFollowUp: boolean;
};

const collectLinkedSubagentInputSyncs = (events: SessionEvent[]): LinkedSubagentInputSync[] => {
  const syncsByChildExternalSessionId = new Map<string, LinkedSubagentInputSync>();
  for (const event of events) {
    if (event.type !== "assistant_part" || event.part.kind !== "subagent") {
      continue;
    }

    const externalSessionId = event.part.externalSessionId?.trim();
    if (externalSessionId) {
      const previous = syncsByChildExternalSessionId.get(externalSessionId);
      syncsByChildExternalSessionId.set(externalSessionId, {
        childExternalSessionId: externalSessionId,
        needsFollowUp:
          Boolean(previous?.needsFollowUp) ||
          event.part.status === "pending" ||
          event.part.status === "running",
      });
    }
  }
  return Array.from(syncsByChildExternalSessionId.values());
};

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

const syncLinkedSubagentPendingInput = (
  context: AttachAgentSessionListenerParams,
  childExternalSessionId: string,
): void => {
  if (!context.adapter.readSessionPresence) {
    return;
  }

  const parentSession = context.sessionsRef.current[context.externalSessionId];
  const runtimeKind = parentSession?.runtimeKind ?? null;
  const workingDirectory = parentSession?.workingDirectory.trim() ?? "";
  if (!parentSession || !runtimeKind || workingDirectory.length === 0) {
    return;
  }

  runOrchestratorSideEffect(
    "sync-subagent-pending-input",
    context.adapter
      .readSessionPresence({
        repoPath: context.repoPath,
        runtimeKind,
        workingDirectory,
        externalSessionId: childExternalSessionId,
      })
      .then((snapshot) => {
        const pendingApprovalsByChildExternalSessionId =
          snapshot.presence === "runtime" && snapshot.pendingApprovals.length > 0
            ? { [childExternalSessionId]: snapshot.pendingApprovals }
            : {};
        const pendingQuestionsByChildExternalSessionId =
          snapshot.presence === "runtime" && snapshot.pendingQuestions.length > 0
            ? { [childExternalSessionId]: snapshot.pendingQuestions }
            : {};

        context.updateSession(
          context.externalSessionId,
          (current) => ({
            ...current,
            subagentPendingApprovalsByExternalSessionId: mergeSubagentPendingApprovalOverlay({
              current: current.subagentPendingApprovalsByExternalSessionId,
              scannedChildExternalSessionIds: [childExternalSessionId],
              pendingApprovalsByChildExternalSessionId,
            }),
            subagentPendingQuestionsByExternalSessionId: mergeSubagentPendingQuestionOverlay({
              current: current.subagentPendingQuestionsByExternalSessionId,
              scannedChildExternalSessionIds: [childExternalSessionId],
              pendingQuestionsByChildExternalSessionId,
            }),
          }),
          { persist: false },
        );
      }),
    {
      tags: {
        repoPath: context.repoPath,
        externalSessionId: context.externalSessionId,
        childExternalSessionId,
      },
    },
  );
};

const syncLinkedSubagentPendingInputForEvents = (
  context: AttachAgentSessionListenerParams,
  events: SessionEvent[],
): void => {
  for (const { childExternalSessionId, needsFollowUp } of collectLinkedSubagentInputSyncs(events)) {
    syncLinkedSubagentPendingInput(context, childExternalSessionId);
    if (needsFollowUp) {
      setTimeout(() => {
        syncLinkedSubagentPendingInput(context, childExternalSessionId);
      }, SUBAGENT_PENDING_INPUT_FOLLOWUP_SYNC_DELAY_MS);
    }
  }
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

export const attachAgentSessionListener = (
  context: AttachAgentSessionListenerParams,
): (() => void) => {
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
      updateSession: (externalSessionId, updater, options) => {
        if (externalSessionId !== context.externalSessionId) {
          context.updateSession(externalSessionId, updater, options);
          return;
        }

        const current = batchedSessionsRef.current[externalSessionId];
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
          [externalSessionId]: next,
        };
      },
    });

    for (const queuedEvent of readyEvents) {
      handleSessionEvent(batchedHandlerContext, queuedEvent);
    }

    if (!hasBufferedSessionUpdate) {
      syncLinkedSubagentPendingInputForEvents(context, readyEvents);
      if (queuedEvents.length > 0) {
        scheduleQueuedFlush(nextDelayMs ?? batchWindowMs);
      }
      return;
    }

    const nextSession = batchedSessionsRef.current[context.externalSessionId];
    if (!nextSession) {
      if (queuedEvents.length > 0) {
        scheduleQueuedFlush(nextDelayMs ?? batchWindowMs);
      }
      return;
    }

    context.updateSession(
      context.externalSessionId,
      () => nextSession,
      shouldPersistBufferedSession ? { persist: true } : undefined,
    );
    syncLinkedSubagentPendingInputForEvents(context, readyEvents);

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

  const unsubscribe = context.adapter.subscribeEvents(context.externalSessionId, (event) => {
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
