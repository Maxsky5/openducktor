import type { AgentEvent, EventUnsubscribe } from "@openducktor/core";

export type SessionEventListener = (event: AgentEvent) => void;
export type SessionEventListeners = Map<string, Set<SessionEventListener>>;

export const subscribeSessionEvents = (
  listenersBySession: SessionEventListeners,
  externalSessionId: string,
  listener: SessionEventListener,
): EventUnsubscribe => {
  const listeners = listenersBySession.get(externalSessionId) ?? new Set<SessionEventListener>();
  listeners.add(listener);
  listenersBySession.set(externalSessionId, listeners);

  return () => {
    const active = listenersBySession.get(externalSessionId);
    if (!active) {
      return;
    }
    active.delete(listener);
    if (active.size === 0) {
      listenersBySession.delete(externalSessionId);
    }
  };
};

export const emitSessionEvent = (
  listenersBySession: SessionEventListeners,
  externalSessionId: string,
  event: AgentEvent,
): void => {
  const listeners = listenersBySession.get(externalSessionId);
  if (!listeners || listeners.size === 0) {
    return;
  }

  for (const listener of listeners) {
    listener(event);
  }
};

export const clearSessionListeners = (
  listenersBySession: SessionEventListeners,
  externalSessionId: string,
): void => {
  listenersBySession.delete(externalSessionId);
};
