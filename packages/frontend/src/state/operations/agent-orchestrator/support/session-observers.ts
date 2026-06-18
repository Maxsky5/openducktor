import {
  type AgentSessionIdentityLike,
  agentSessionIdentityKey,
} from "@/lib/agent-session-identity";

type SessionObserverUnsubscribe = () => void;
type SessionObserverFactory = () => Promise<SessionObserverUnsubscribe>;

type PendingSessionObserverSlot = {
  kind: "pending";
  cancelled: boolean;
  promise: Promise<void>;
};

type OpenSessionObserverSlot = {
  kind: "open";
  unsubscribe: SessionObserverUnsubscribe;
};

type SessionObserverSlot = PendingSessionObserverSlot | OpenSessionObserverSlot;

export type SessionObservers = {
  has: (session: AgentSessionIdentityLike) => boolean;
  ensureObserver: (
    session: AgentSessionIdentityLike,
    createObserver: SessionObserverFactory,
  ) => Promise<boolean>;
  remove: (session: AgentSessionIdentityLike) => void;
  clear: () => void;
};

export const createSessionObservers = (): SessionObservers => {
  const observerBySessionKey = new Map<string, SessionObserverSlot>();

  const closeSlot = (slot: SessionObserverSlot): void => {
    if (slot.kind === "pending") {
      slot.cancelled = true;
      return;
    }
    slot.unsubscribe();
  };

  return {
    has: (session) => {
      const sessionKey = agentSessionIdentityKey(session);
      return observerBySessionKey.has(sessionKey);
    },
    ensureObserver: (session, createObserver) => {
      const sessionKey = agentSessionIdentityKey(session);
      const currentSlot = observerBySessionKey.get(sessionKey);
      if (currentSlot?.kind === "open") {
        return Promise.resolve(false);
      }
      if (currentSlot?.kind === "pending") {
        return currentSlot.promise.then(() => false);
      }

      const pendingSlot: PendingSessionObserverSlot = {
        kind: "pending",
        cancelled: false,
        promise: Promise.resolve(),
      };
      observerBySessionKey.set(sessionKey, pendingSlot);
      const registration = (async (): Promise<boolean> => {
        const unsubscribe = await createObserver();
        if (pendingSlot.cancelled || observerBySessionKey.get(sessionKey) !== pendingSlot) {
          unsubscribe();
          return false;
        }
        observerBySessionKey.set(sessionKey, {
          kind: "open",
          unsubscribe,
        });
        return true;
      })().finally(() => {
        if (observerBySessionKey.get(sessionKey) === pendingSlot) {
          observerBySessionKey.delete(sessionKey);
        }
      });
      pendingSlot.promise = registration.then(() => undefined);
      return registration;
    },
    remove: (session) => {
      const sessionKey = agentSessionIdentityKey(session);
      const slot = observerBySessionKey.get(sessionKey);
      if (!slot) {
        return;
      }
      observerBySessionKey.delete(sessionKey);
      closeSlot(slot);
    },
    clear: () => {
      const slots = [...observerBySessionKey.values()];
      observerBySessionKey.clear();
      for (const slot of slots) {
        closeSlot(slot);
      }
    },
  };
};
