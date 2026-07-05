import {
  type AgentEvent,
  agentSessionRefKey,
  type EventUnsubscribe,
  type SessionRef,
} from "@openducktor/core";

export type SessionEventListener = (event: AgentEvent) => void;
export type SessionEventListeners = Map<string, Set<SessionEventListener>>;

export const subscribeSessionEvents = (
  listenersBySession: SessionEventListeners,
  sessionRef: SessionRef,
  listener: SessionEventListener,
): EventUnsubscribe => {
  const sessionKey = agentSessionRefKey(sessionRef);
  const listeners = listenersBySession.get(sessionKey) ?? new Set<SessionEventListener>();
  listeners.add(listener);
  listenersBySession.set(sessionKey, listeners);

  return () => {
    const active = listenersBySession.get(sessionKey);
    if (!active) {
      return;
    }
    active.delete(listener);
    if (active.size === 0) {
      listenersBySession.delete(sessionKey);
    }
  };
};

export const emitSessionEvent = (
  listenersBySession: SessionEventListeners,
  sessionRef: SessionRef,
  event: AgentEvent,
): void => {
  const listeners = listenersBySession.get(agentSessionRefKey(sessionRef));
  if (!listeners || listeners.size === 0) {
    return;
  }

  for (const listener of listeners) {
    listener(event);
  }
};

export const clearSessionListeners = (
  listenersBySession: SessionEventListeners,
  sessionRef: SessionRef,
): void => {
  listenersBySession.delete(agentSessionRefKey(sessionRef));
};
