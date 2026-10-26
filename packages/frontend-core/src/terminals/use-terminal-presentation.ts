import { useCallback, useEffect, useLayoutEffect, useState, useSyncExternalStore } from "react";
import { useClientConnection } from "../connection/client-connection-react";
import { perConnection } from "../lib/per-connection";
import {
  createTerminalPresentationState,
  emptyTerminalScopePresentation,
  terminalPresentationReducer,
  type TerminalPresentationEvent,
} from "./terminal-presentation-state";

/** Share pending tabs and live lifecycle state between views of the same terminal owner. */
export function useTerminalPresentation(scopeKey: string | null) {
  const store = storeOf(useClientConnection());
  const [lease] = useState(() => Symbol());
  const read = useCallback(() => store.read(scopeKey), [scopeKey, store]);
  const visibleState = useSyncExternalStore(store.subscribe, read, read);
  useLayoutEffect(() => {
    store.keep(lease, scopeKey);
  }, [lease, scopeKey, store]);
  // Replacement views acquire in layout before an evicted view releases its scope.
  useEffect(() => () => store.release(lease), [lease, store]);
  return {
    visibleState,
    /** Reads the current state of the scope in an event handler. */
    readState: read,
    dispatch: store.dispatch,
    cancelledCreates: store.cancelledCreates,
  };
}

const storeOf = perConnection(createStore);
const EMPTY_SCOPE = emptyTerminalScopePresentation();

function createStore() {
  let state = createTerminalPresentationState();
  const leases = new Map<symbol, string | null>();
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const listener of listeners) listener();
  };
  const owns = (key: string) => [...leases.values()].includes(key);
  const prune = () => {
    const entries = Object.entries(state.scopes).filter(([key]) => owns(key));
    if (entries.length === Object.keys(state.scopes).length) return;
    state = { scopes: Object.fromEntries(entries) };
    notify();
  };
  return {
    cancelledCreates: new Set<string>(),
    read: (key: string | null) => (key === null ? EMPTY_SCOPE : (state.scopes[key] ?? EMPTY_SCOPE)),
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    keep(lease: symbol, key: string | null) {
      leases.set(lease, key);
      prune();
    },
    release(lease: symbol) {
      leases.delete(lease);
      prune();
    },
    dispatch(event: TerminalPresentationEvent) {
      if (!owns(event.scopeKey)) return;
      const next = terminalPresentationReducer(state, event);
      if (next === state) return;
      state = next;
      notify();
    },
  };
}
