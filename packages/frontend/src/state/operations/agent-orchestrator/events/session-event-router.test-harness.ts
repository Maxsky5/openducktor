import type { SessionRef } from "@openducktor/core";
import { agentSessionIdentityKey } from "@/lib/agent-session-identity";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import {
  prepareForcedQueuedSessionEvents,
  type QueuedSessionEvent,
  type SessionEventBatcher,
} from "./session-event-batching";
import { routeStreamEventSession } from "./session-event-identity";
import {
  createSessionEventContext,
  type ObserveAgentSessionParams,
} from "./session-event-test-types";
import type { SessionEvent, SessionEventContext } from "./session-event-types";

type RoutedSessionEventHandler = (context: SessionEventContext, event: SessionEvent) => void;

type RoutedSessionEvent<Event extends SessionEvent = SessionEvent> = {
  event: Event;
  routeKey: string;
  sessionRef: SessionRef;
  storeKey: string;
};

type RoutedQueuedSessionEvent = RoutedSessionEvent<QueuedSessionEvent>;

type QueuedSessionCommit = {
  sessionRef: SessionRef;
  nextSession: AgentSessionState;
  changed: boolean;
};

type FlushOptions = {
  force?: boolean;
};

const routeSessionEvent = <Event extends SessionEvent>(
  context: ObserveAgentSessionParams,
  event: Event,
): RoutedSessionEvent<Event> => {
  const { sessionRef, sessionKey } = routeStreamEventSession(context.sessionRef, event);
  return {
    event,
    routeKey: sessionKey,
    sessionRef,
    storeKey: agentSessionIdentityKey(sessionRef),
  };
};

const createRoutedSessionEventContext = (
  context: ObserveAgentSessionParams,
  routedEvent: RoutedSessionEvent,
): SessionEventContext =>
  createSessionEventContext({
    ...context,
    sessionRef: routedEvent.sessionRef,
  });

const applyQueuedSessionEvents = (
  context: ObserveAgentSessionParams,
  readyEvents: readonly RoutedQueuedSessionEvent[],
  handleEvent: RoutedSessionEventHandler,
): void => {
  const commitsBySessionKey = new Map<string, QueuedSessionCommit>();
  const getQueuedCommit = (routedEvent: RoutedQueuedSessionEvent): QueuedSessionCommit | null => {
    const existingCommit = commitsBySessionKey.get(routedEvent.storeKey);
    if (existingCommit) {
      return existingCommit;
    }

    const currentSession = context.readSession(routedEvent.sessionRef);
    if (!currentSession) {
      return null;
    }

    const commit: QueuedSessionCommit = {
      sessionRef: routedEvent.sessionRef,
      nextSession: currentSession,
      changed: false,
    };
    commitsBySessionKey.set(routedEvent.storeKey, commit);
    return commit;
  };

  const queuedContext = (routedEvent: RoutedQueuedSessionEvent): SessionEventContext | null => {
    const eventCommit = getQueuedCommit(routedEvent);
    if (!eventCommit) {
      return null;
    }

    return createSessionEventContext({
      ...context,
      sessionRef: eventCommit.sessionRef,
      readSession: (identity) => {
        const commit = commitsBySessionKey.get(agentSessionIdentityKey(identity));
        return commit?.nextSession ?? context.readSession(identity);
      },
      ensureSession: (identity, createSession) => {
        const commit = commitsBySessionKey.get(agentSessionIdentityKey(identity));
        if (!commit) {
          return context.ensureSession(identity, createSession);
        }

        return commit.nextSession;
      },
      updateSession: (targetSessionIdentity, updater, options) => {
        const commit = commitsBySessionKey.get(agentSessionIdentityKey(targetSessionIdentity));
        if (!commit) {
          return context.updateSession(targetSessionIdentity, updater, options);
        }

        if (options?.persist === true) {
          throw new Error(
            `Queued session event for '${targetSessionIdentity.externalSessionId}' requested durable persistence.`,
          );
        }

        commit.nextSession = updater(commit.nextSession);
        commit.changed = true;
        return commit.nextSession;
      },
    });
  };

  for (const routedEvent of readyEvents) {
    const eventContext = queuedContext(routedEvent);
    if (eventContext) {
      handleEvent(eventContext, routedEvent.event);
    }
  }

  for (const commit of commitsBySessionKey.values()) {
    if (commit.changed) {
      context.updateSession(commit.sessionRef, () => commit.nextSession);
    }
  }
};

const isSubscriptionSessionMounted = ({
  sessionRef,
  readSession,
}: Pick<ObserveAgentSessionParams, "sessionRef" | "readSession">): boolean =>
  readSession(sessionRef) !== null;

export const createSessionEventRouter = ({
  createBatcher,
  context,
  handleEvent,
}: {
  createBatcher: () => SessionEventBatcher;
  context: ObserveAgentSessionParams;
  handleEvent: RoutedSessionEventHandler;
}) => {
  const queuedEventsBySessionKey = new Map<string, RoutedQueuedSessionEvent[]>();
  const batchersBySessionKey = new Map<string, SessionEventBatcher>();

  const clearAll = (): void => {
    queuedEventsBySessionKey.clear();
    batchersBySessionKey.clear();
  };

  const clearSession = (sessionKey: string): void => {
    queuedEventsBySessionKey.delete(sessionKey);
    batchersBySessionKey.delete(sessionKey);
  };

  const hasQueuedEvents = (): boolean => queuedEventsBySessionKey.size > 0;

  const clearIfSubscriptionSessionUnmounted = (): boolean => {
    if (isSubscriptionSessionMounted(context)) {
      return false;
    }

    clearAll();
    return true;
  };

  const batcherForSession = (sessionKey: string): SessionEventBatcher => {
    const current = batchersBySessionKey.get(sessionKey);
    if (current) {
      return current;
    }

    const batcher = createBatcher();
    batchersBySessionKey.set(sessionKey, batcher);
    return batcher;
  };

  const enqueue = (event: QueuedSessionEvent): boolean => {
    if (clearIfSubscriptionSessionUnmounted()) {
      return false;
    }

    const routedEvent = routeSessionEvent(context, event);
    const queuedEvents = queuedEventsBySessionKey.get(routedEvent.routeKey) ?? [];
    queuedEvents.push(routedEvent);
    queuedEventsBySessionKey.set(routedEvent.routeKey, queuedEvents);
    return true;
  };

  const storeDeferredEvents = (
    sessionKey: string,
    deferredEvents: RoutedQueuedSessionEvent[],
  ): void => {
    if (deferredEvents.length === 0) {
      queuedEventsBySessionKey.delete(sessionKey);
      return;
    }

    queuedEventsBySessionKey.set(sessionKey, deferredEvents);
  };

  const handleImmediate = (event: SessionEvent): void => {
    if (clearIfSubscriptionSessionUnmounted()) {
      return;
    }

    const routedEvent = routeSessionEvent(context, event);
    flushSession(routedEvent.routeKey, { force: true });
    handleEvent(createRoutedSessionEventContext(context, routedEvent), event);
  };

  const flushSession = (sessionKey: string, options: FlushOptions = {}): number | null => {
    const queuedEvents = queuedEventsBySessionKey.get(sessionKey);
    if (!queuedEvents || queuedEvents.length === 0) {
      return null;
    }

    if (!isSubscriptionSessionMounted(context)) {
      clearAll();
      return null;
    }

    if (options.force === true) {
      applyQueuedSessionEvents(
        context,
        prepareForcedQueuedSessionEvents(queuedEvents),
        handleEvent,
      );
      clearSession(sessionKey);
      return null;
    }

    const batcher = batcherForSession(sessionKey);
    const preparedEvents = batcher.prepareQueuedSessionEvents(queuedEvents);
    const readyEvents = preparedEvents.readyEvents;
    const deferredEvents = preparedEvents.deferredEvents;
    if (readyEvents.length > 0) {
      applyQueuedSessionEvents(context, readyEvents, handleEvent);
    }

    storeDeferredEvents(sessionKey, deferredEvents);

    return deferredEvents.length > 0 ? preparedEvents.nextDelayMs : null;
  };

  const flushReady = (): number | null => {
    let nextDelayMs: number | null = null;
    for (const sessionKey of [...queuedEventsBySessionKey.keys()]) {
      const sessionDelayMs = flushSession(sessionKey);
      if (sessionDelayMs === null) {
        continue;
      }
      nextDelayMs = nextDelayMs === null ? sessionDelayMs : Math.min(nextDelayMs, sessionDelayMs);
    }
    return nextDelayMs;
  };

  const flushAll = (): void => {
    for (const sessionKey of [...queuedEventsBySessionKey.keys()]) {
      flushSession(sessionKey, { force: true });
    }
  };

  return {
    enqueue,
    flushAll,
    flushReady,
    handleImmediate,
    hasQueuedEvents,
  };
};
