import {
  type AgentSessionIdentityLike,
  agentSessionIdentityKey,
} from "@/lib/agent-session-identity";

type SessionObserverUnsubscribe = () => void;

export type SessionObservers = {
  has: (session: AgentSessionIdentityLike) => boolean;
  add: (session: AgentSessionIdentityLike, unsubscribe: SessionObserverUnsubscribe) => void;
  remove: (session: AgentSessionIdentityLike) => void;
  removeMany: (sessions: readonly AgentSessionIdentityLike[]) => void;
  clear: () => void;
};

export const createSessionObservers = (): SessionObservers => {
  const unsubscribeBySessionKey = new Map<string, SessionObserverUnsubscribe>();

  const take = (session: AgentSessionIdentityLike): SessionObserverUnsubscribe | null => {
    const sessionKey = agentSessionIdentityKey(session);
    const unsubscribe = unsubscribeBySessionKey.get(sessionKey);
    if (!unsubscribe) {
      return null;
    }
    unsubscribeBySessionKey.delete(sessionKey);
    return unsubscribe;
  };

  const unsubscribeAll = (unsubscribers: readonly SessionObserverUnsubscribe[]): void => {
    for (const unsubscribe of unsubscribers) {
      unsubscribe();
    }
  };

  return {
    has: (session) => unsubscribeBySessionKey.has(agentSessionIdentityKey(session)),
    add: (session, unsubscribe) => {
      const sessionKey = agentSessionIdentityKey(session);
      if (unsubscribeBySessionKey.has(sessionKey)) {
        throw new Error(`Session observer already exists for '${session.externalSessionId}'.`);
      }
      unsubscribeBySessionKey.set(sessionKey, unsubscribe);
    },
    remove: (session) => {
      const unsubscribe = take(session);
      if (!unsubscribe) {
        return;
      }
      unsubscribe();
    },
    removeMany: (sessions) => {
      const removedObservers: SessionObserverUnsubscribe[] = [];
      for (const session of sessions) {
        const unsubscribe = take(session);
        if (unsubscribe) {
          removedObservers.push(unsubscribe);
        }
      }
      unsubscribeAll(removedObservers);
    },
    clear: () => {
      const observers = [...unsubscribeBySessionKey.values()];
      unsubscribeBySessionKey.clear();
      unsubscribeAll(observers);
    },
  };
};
