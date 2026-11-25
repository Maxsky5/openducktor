/** `reload-required`: the host refused this page, as after a host restart. Only a reload recovers. */
export type HostConnectionState = "connected" | "reconnecting" | "reload-required";

/** Passive view of the connection to the host. It performs no I/O and holds no stream. */
export type HostConnectionStateSource = {
  getSnapshot(): HostConnectionState;
  subscribe(listener: () => void): () => void;
};

/** A host that cannot become unreachable, such as the host of an unavailable shell. */
export const connectedHostConnectionState: HostConnectionStateSource = {
  getSnapshot: () => "connected",
  subscribe: () => () => {},
};

export type HostConnectionStore = HostConnectionStateSource & {
  setState(state: HostConnectionState): void;
};

/** One host connection state. A listener runs only when the state changes. */
export const createHostConnectionStore = (
  initialState: HostConnectionState = "connected",
): HostConnectionStore => {
  let state = initialState;
  const listeners = new Set<() => void>();
  return {
    getSnapshot: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    setState: (next) => {
      if (state === next) return;
      state = next;
      // oxlint-disable-next-line unicorn/no-useless-spread -- a listener can unsubscribe
      for (const listener of [...listeners]) listener();
    },
  };
};
