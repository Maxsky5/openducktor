import type { AgentEvent, EventUnsubscribe } from "@openducktor/core";

export type SessionEventListener = (event: AgentEvent) => void;
export type SessionEventListeners = Map<string, Set<SessionEventListener>>;

export const subscribeSessionEvents = (
  listenersBySession: SessionEventListeners,
  sessionId: string,
  listener: SessionEventListener,
): EventUnsubscribe => {
  const listeners = listenersBySession.get(sessionId) ?? new Set<SessionEventListener>();
  listeners.add(listener);
  listenersBySession.set(sessionId, listeners);

  return () => {
    const active = listenersBySession.get(sessionId);
    if (!active) {
      return;
    }
    active.delete(listener);
    if (active.size === 0) {
      listenersBySession.delete(sessionId);
    }
  };
};

export const emitSessionEvent = (
  listenersBySession: SessionEventListeners,
  sessionId: string,
  event: AgentEvent,
): void => {
  const listeners = listenersBySession.get(sessionId);
  if (!listeners || listeners.size === 0) {
    return;
  }

  for (const listener of listeners) {
    listener(event);
  }
};

export const clearSessionListeners = (
  listenersBySession: SessionEventListeners,
  sessionId: string,
): void => {
  listenersBySession.delete(sessionId);
};
