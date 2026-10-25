import { useAgentSessionsContext } from "@openducktor/frontend-core/sessions/session-contexts";
import type {
  AgentSessionIdentity,
  AgentSessionState,
} from "@openducktor/frontend-core/types/agent-orchestrator";
import { useCallback, useRef, useSyncExternalStore } from "react";

type Cached<Value> = {
  session: AgentSessionState | null;
  select: (session: AgentSessionState | null) => Value;
  value: Value;
};

/** True when two plain objects have the same keys and `Object.is` values. */
export const shallowEqual = <Value>(left: Value, right: Value): boolean => {
  if (Object.is(left, right)) return true;
  if (
    left === null ||
    right === null ||
    !(left instanceof Object) ||
    !(right instanceof Object) ||
    Array.isArray(left) !== Array.isArray(right)
  ) {
    return false;
  }
  const leftEntries = Object.entries(left);
  if (leftEntries.length !== Object.keys(right).length) return false;
  const rightMap = new Map(Object.entries(right));
  return leftEntries.every(
    ([key, value]) => rightMap.has(key) && Object.is(value, rightMap.get(key)),
  );
};

/**
 * Reads one slice of one session from the session store. The view renders again only when the
 * slice changes, so streaming text does not render a header or a panel that reads the status.
 * A stable `select`, for example one at module level, reads again only when the session changes.
 * A new `select` reads again at once.
 */
export function useSessionSelector<Value>(
  identity: AgentSessionIdentity | null,
  select: (session: AgentSessionState | null) => Value,
  isEqual: (left: Value, right: Value) => boolean = shallowEqual,
): Value {
  const store = useAgentSessionsContext();
  const cache = useRef<Cached<Value> | null>(null);
  const getSnapshot = useCallback((): Value => {
    const session = store.getSessionSnapshot(identity);
    const current = cache.current;
    if (current && current.session === session && current.select === select) return current.value;
    const value = select(session);
    if (current && isEqual(current.value, value)) {
      cache.current = { session, select, value: current.value };
      return current.value;
    }
    cache.current = { session, select, value };
    return value;
  }, [identity, isEqual, select, store]);
  return useSyncExternalStore(store.subscribe, getSnapshot, getSnapshot);
}
