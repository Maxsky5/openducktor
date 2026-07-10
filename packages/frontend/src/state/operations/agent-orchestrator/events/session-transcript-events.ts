import type { AgentSessionTranscriptEvent } from "@openducktor/contracts";
import { toast } from "sonner";
import { agentSessionIdentityKey, toAgentSessionIdentity } from "@/lib/agent-session-identity";
import type { SessionTurnState } from "../support/session-turn-state";
import {
  createSessionEventBatcher,
  isImmediateSessionEvent,
  prepareForcedQueuedSessionEvents,
  type QueuedSessionEvent,
  type QueuedSessionEventBatchItem,
  shouldFlushQueuedSessionEventImmediately,
} from "./session-event-batching";
import type {
  EnsureSession,
  ReadSession,
  SessionTranscriptEventContext,
  UpdateSession,
  UpdateSessionTodos,
  WorkflowToolAliasesByCanonical,
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
  handleTranscriptRetracted,
  handleUserMessage,
} from "./session-lifecycle";
import { handleAssistantDelta, handleAssistantPart } from "./session-parts";

const TRANSCRIPT_EVENT_BATCH_WINDOW_MS = process.env.NODE_ENV === "test" ? 0 : 500;

type TranscriptEventDependencies = {
  readSession: ReadSession;
  ensureSession: EnsureSession;
  updateSession: UpdateSession;
  updateSessionTodos: UpdateSessionTodos;
  sessionTurnState: SessionTurnState;
  refreshTaskData: (
    repoPath: string,
    taskIdOrIds?: string | string[],
    options?: { forceFreshTaskList?: boolean },
  ) => Promise<void>;
  workflowToolAliasesByCanonical?: WorkflowToolAliasesByCanonical;
};

type QueuedTranscriptEvent = QueuedSessionEventBatchItem<
  Extract<AgentSessionTranscriptEvent, QueuedSessionEvent>
>;

const transcriptEventContext = (
  dependencies: TranscriptEventDependencies,
  event: AgentSessionTranscriptEvent,
): SessionTranscriptEventContext => {
  const identity = toAgentSessionIdentity(event.sessionRef);
  return {
    session: {
      identity,
      key: agentSessionIdentityKey(identity),
      repoPath: event.sessionRef.repoPath,
    },
    store: {
      readSession: dependencies.readSession,
      ensureSession: dependencies.ensureSession,
      updateSession: dependencies.updateSession,
      isSessionObserved: (candidate) => dependencies.readSession(candidate) !== null,
    },
    turn: {
      turnMetadata: dependencies.sessionTurnState.metadata,
      recordTurnActivityTimestamp: dependencies.sessionTurnState.timing.recordTurnActivityTimestamp,
      recordTurnUserMessageTimestamp:
        dependencies.sessionTurnState.timing.recordTurnUserMessageTimestamp,
      resolveTurnDurationMs: dependencies.sessionTurnState.timing.resolveTurnDurationMs,
      clearTurnDuration: dependencies.sessionTurnState.timing.clearTurnDuration,
    },
    refresh: {
      refreshTaskData: dependencies.refreshTaskData,
      workflowToolAliasesByCanonical: dependencies.workflowToolAliasesByCanonical,
    },
    todos: {
      updateSessionTodos: dependencies.updateSessionTodos,
    },
  };
};

const notifyMcpReconnectStarted = (
  event: Extract<AgentSessionTranscriptEvent, { type: "mcp_reconnect_started" }>,
): void => {
  const details = event.errorDetails ? ` ${event.errorDetails}.` : "";
  toast.info("Reconnecting OpenDucktor MCP", {
    description: `OpenDucktor MCP is ${event.status} for ${event.workingDirectory}.${details} OpenDucktor is trying to reconnect.`,
  });
};

const dispatchTranscriptEvent = (
  dependencies: TranscriptEventDependencies,
  event: AgentSessionTranscriptEvent,
): void => {
  if (!dependencies.readSession(toAgentSessionIdentity(event.sessionRef))) {
    return;
  }
  const context = transcriptEventContext(dependencies, event);
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
    case "transcript_retracted":
      handleTranscriptRetracted(context, event);
      return;
    case "user_message":
      handleUserMessage(context, event);
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
    case "mcp_reconnect_started":
      notifyMcpReconnectStarted(event);
      return;
    case "session_status":
      handleSessionStatus(context, event);
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

export type AgentSessionTranscriptEventConsumer = {
  handle: (event: AgentSessionTranscriptEvent) => void;
  close: () => void;
};

export const createAgentSessionTranscriptEventConsumer = (
  dependencies: TranscriptEventDependencies,
  options: { batchWindowMs?: number } = {},
): AgentSessionTranscriptEventConsumer => {
  const batchWindowMs = options.batchWindowMs ?? TRANSCRIPT_EVENT_BATCH_WINDOW_MS;
  const batcher = createSessionEventBatcher();
  const queuedEventsBySession = new Map<string, QueuedTranscriptEvent[]>();
  let batchTimeoutId: ReturnType<typeof setTimeout> | null = null;

  const cancelScheduledFlush = (): void => {
    if (batchTimeoutId !== null) {
      clearTimeout(batchTimeoutId);
      batchTimeoutId = null;
    }
  };
  const forceFlushSession = (sessionKey: string): void => {
    const queued = queuedEventsBySession.get(sessionKey) ?? [];
    queuedEventsBySession.delete(sessionKey);
    for (const item of prepareForcedQueuedSessionEvents(queued)) {
      dispatchTranscriptEvent(dependencies, item.event);
    }
  };
  const flushReady = (): void => {
    cancelScheduledFlush();
    let nextDelayMs: number | null = null;
    for (const [sessionKey, queued] of queuedEventsBySession) {
      const prepared = batcher.prepareQueuedSessionEvents(queued);
      for (const item of prepared.readyEvents) {
        dispatchTranscriptEvent(dependencies, item.event);
      }
      if (prepared.deferredEvents.length === 0) {
        queuedEventsBySession.delete(sessionKey);
      } else {
        queuedEventsBySession.set(sessionKey, prepared.deferredEvents);
        if (prepared.nextDelayMs !== null) {
          nextDelayMs =
            nextDelayMs === null
              ? prepared.nextDelayMs
              : Math.min(nextDelayMs, prepared.nextDelayMs);
        }
      }
    }
    if (queuedEventsBySession.size > 0) {
      batchTimeoutId = setTimeout(flushReady, nextDelayMs ?? batchWindowMs);
    }
  };
  const scheduleFlush = (): void => {
    if (batchWindowMs <= 0) {
      flushReady();
      return;
    }
    if (batchTimeoutId === null) {
      batchTimeoutId = setTimeout(flushReady, batchWindowMs);
    }
  };

  return {
    handle: (event) => {
      const sessionKey = agentSessionIdentityKey(toAgentSessionIdentity(event.sessionRef));
      if (isImmediateSessionEvent(event)) {
        forceFlushSession(sessionKey);
        dispatchTranscriptEvent(dependencies, event);
        return;
      }
      const queued = queuedEventsBySession.get(sessionKey) ?? [];
      queued.push({ routeKey: sessionKey, event });
      queuedEventsBySession.set(sessionKey, queued);
      if (shouldFlushQueuedSessionEventImmediately(event)) {
        forceFlushSession(sessionKey);
        return;
      }
      scheduleFlush();
    },
    close: () => {
      cancelScheduledFlush();
      for (const sessionKey of [...queuedEventsBySession.keys()]) {
        forceFlushSession(sessionKey);
      }
      dependencies.sessionTurnState.clearAll();
    },
  };
};
