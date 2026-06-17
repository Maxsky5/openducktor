import {
  type AgentSessionIdentityLike,
  agentSessionIdentityKey,
} from "@/lib/agent-session-identity";

type SessionObserverUnsubscribe = () => void;
type SessionObserverFactory = () => Promise<SessionObserverUnsubscribe>;
type SessionObserverSeed = {
  session: AgentSessionIdentityLike;
  unsubscribe: SessionObserverUnsubscribe;
};
type PendingSessionObserver = {
  cancelled: boolean;
  promise: Promise<void>;
};

export type SessionObservers = {
  has: (session: AgentSessionIdentityLike) => boolean;
  ensureObserver: (
    session: AgentSessionIdentityLike,
    createObserver: SessionObserverFactory,
  ) => Promise<boolean>;
  remove: (session: AgentSessionIdentityLike) => void;
  removeMany: (sessions: readonly AgentSessionIdentityLike[]) => void;
  clear: () => void;
};

export const createSessionObservers = (
  initialObservers: readonly SessionObserverSeed[] = [],
): SessionObservers => {
  const unsubscribeBySessionKey = new Map<string, SessionObserverUnsubscribe>();
  const pendingBySessionKey = new Map<string, PendingSessionObserver>();

  for (const { session, unsubscribe } of initialObservers) {
    const sessionKey = agentSessionIdentityKey(session);
    if (unsubscribeBySessionKey.has(sessionKey)) {
      throw new Error(`Session observer already exists for '${session.externalSessionId}'.`);
    }
    unsubscribeBySessionKey.set(sessionKey, unsubscribe);
  }

  const cancelPending = (sessionKey: string): void => {
    const pending = pendingBySessionKey.get(sessionKey);
    if (!pending) {
      return;
    }
    pending.cancelled = true;
    pendingBySessionKey.delete(sessionKey);
  };

  const take = (session: AgentSessionIdentityLike): SessionObserverUnsubscribe | null => {
    const sessionKey = agentSessionIdentityKey(session);
    cancelPending(sessionKey);
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
    has: (session) => {
      const sessionKey = agentSessionIdentityKey(session);
      return unsubscribeBySessionKey.has(sessionKey) || pendingBySessionKey.has(sessionKey);
    },
    ensureObserver: (session, createObserver) => {
      const sessionKey = agentSessionIdentityKey(session);
      if (unsubscribeBySessionKey.has(sessionKey)) {
        return Promise.resolve(false);
      }
      const pending = pendingBySessionKey.get(sessionKey);
      if (pending) {
        return pending.promise.then(() => false);
      }

      const nextPending: PendingSessionObserver = {
        cancelled: false,
        promise: Promise.resolve(),
      };
      pendingBySessionKey.set(sessionKey, nextPending);
      const registration = (async (): Promise<boolean> => {
        const unsubscribe = await createObserver();
        if (nextPending.cancelled || unsubscribeBySessionKey.has(sessionKey)) {
          unsubscribe();
          return false;
        }
        unsubscribeBySessionKey.set(sessionKey, unsubscribe);
        return true;
      })().finally(() => {
        if (pendingBySessionKey.get(sessionKey) === nextPending) {
          pendingBySessionKey.delete(sessionKey);
        }
      });
      nextPending.promise = registration.then(() => undefined);
      return registration;
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
      for (const pending of pendingBySessionKey.values()) {
        pending.cancelled = true;
      }
      pendingBySessionKey.clear();
      const observers = [...unsubscribeBySessionKey.values()];
      unsubscribeBySessionKey.clear();
      unsubscribeAll(observers);
    },
  };
};
