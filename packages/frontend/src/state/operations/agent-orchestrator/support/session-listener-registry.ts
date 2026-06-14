import type { AgentSessionRef } from "@openducktor/core";
import { agentSessionIdentityKey } from "@/lib/agent-session-identity";

type SessionListenerEntry = {
  externalSessionId: string;
  unsubscribe: () => void;
};

export type SessionListenerRegistry = Map<string, SessionListenerEntry>;

export const createSessionListenerRegistry = (): SessionListenerRegistry => new Map();

export const hasSessionListener = (
  registry: SessionListenerRegistry,
  sessionRef: AgentSessionRef,
): boolean => registry.has(agentSessionIdentityKey(sessionRef));

export const hasSessionListenerForExternalSessionId = (
  registry: SessionListenerRegistry,
  externalSessionId: string,
): boolean => {
  for (const listener of registry.values()) {
    if (listener.externalSessionId === externalSessionId) {
      return true;
    }
  }
  return false;
};

export const setSessionListener = (
  registry: SessionListenerRegistry,
  sessionRef: AgentSessionRef,
  unsubscribe: () => void,
): void => {
  registry.set(agentSessionIdentityKey(sessionRef), {
    externalSessionId: sessionRef.externalSessionId,
    unsubscribe,
  });
};

export const removeSessionListenersByExternalSessionId = (
  registry: SessionListenerRegistry,
  externalSessionIds: string | string[],
): void => {
  const ids = new Set(
    Array.isArray(externalSessionIds) ? externalSessionIds : [externalSessionIds],
  );
  const removedListeners: SessionListenerEntry[] = [];
  for (const [listenerKey, listener] of registry) {
    if (!ids.has(listener.externalSessionId)) {
      continue;
    }
    removedListeners.push(listener);
    registry.delete(listenerKey);
  }
  for (const listener of removedListeners) {
    listener.unsubscribe();
  }
};

export const clearSessionListenerRegistry = (registry: SessionListenerRegistry): void => {
  const listeners = [...registry.values()];
  registry.clear();
  for (const listener of listeners) {
    listener.unsubscribe();
  }
};
