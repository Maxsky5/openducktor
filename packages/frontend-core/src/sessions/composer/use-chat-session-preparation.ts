import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { errorMessage } from "../../lib/errors";
import { useStableAgentSessionIdentity } from "../../lib/use-stable-agent-session-identity";
import { useSessionViewActive } from "../navigation/session-view-context";
import { useAgentSessionsContext } from "../session-contexts";
import type { AgentSessionIdentity } from "../../types/agent-orchestrator";

type Attempt = {
  key: string;
  enabled: boolean;
  prepare: () => Promise<void>;
  token: object;
  closed: boolean;
  result: { error: string | null } | null;
};

export function useChatSessionPreparation({
  identity: targetIdentity,
  targetKey,
  enabled,
  prepare,
}: {
  identity: AgentSessionIdentity | null;
  targetKey: string;
  enabled: boolean;
  prepare: () => Promise<void>;
}): { ready: boolean; error: string | null } {
  const store = useAgentSessionsContext();
  const isActive = useSessionViewActive();
  const identity = useStableAgentSessionIdentity(targetIdentity);
  // Read only the presence, so streamed text does not render the caller again.
  const readPresence = () => store.getSessionSnapshot(identity)?.livePresence ?? "unobserved";
  const presence = useSyncExternalStore(store.subscribe, readPresence, readPresence);
  const [attempt, setAttempt] = useState(() => createAttempt(targetKey, enabled, prepare));
  const pendingPreparation = useRef<{ token: object; promise: Promise<void> } | null>(null);
  const changed =
    attempt.key !== targetKey || attempt.enabled !== enabled || attempt.prepare !== prepare;
  // Reset during render so a new target cannot use the previous target's ready state.
  if (changed) setAttempt(createAttempt(targetKey, enabled, prepare));
  const { token } = attempt;
  useEffect(() => {
    if (!enabled || !identity) return;
    let previous = presence;
    const observe = () => {
      const next = store.getSessionSnapshot(identity)?.livePresence ?? "unobserved";
      if (previous === "present" && next !== "present")
        setAttempt((current) => closeAttempt(current, targetKey, prepare));
      previous = next;
    };
    // Observe every transition, including an attach and close that React batches together.
    const unsubscribe = store.subscribe(observe);
    observe();
    return unsubscribe;
  }, [enabled, identity, prepare, presence, store, targetKey]);
  const needsPreparation = enabled && isActive && !changed && attempt.result === null;
  useEffect(() => {
    if (!needsPreparation) return;
    let active = true;
    const settle = (error: string | null) => {
      if (!active) return;
      setAttempt((current) => {
        if (current.token !== token) return current;
        return { ...current, result: { error } };
      });
    };
    if (pendingPreparation.current?.token !== token)
      pendingPreparation.current = { token, promise: prepare() };
    void pendingPreparation.current.promise.then(
      () => settle(null),
      (cause: unknown) => settle(errorMessage(cause)),
    );
    return () => {
      active = false;
    };
  }, [needsPreparation, prepare, token]);
  return useMemo(
    () => preparationResult(enabled && !changed ? attempt : null, presence),
    [attempt, changed, enabled, presence],
  );
}

const createAttempt = (key: string, enabled: boolean, prepare: () => Promise<void>): Attempt => ({
  key,
  enabled,
  prepare,
  token: {},
  closed: false,
  result: null,
});

function closeAttempt(current: Attempt, key: string, prepare: () => Promise<void>): Attempt {
  if (current.key !== key || current.prepare !== prepare || !current.enabled) return current;
  if (current.result && current.result.error !== null) return current;
  if (current.result === null) return { ...current, closed: true };
  return createAttempt(key, true, prepare);
}

function preparationResult(attempt: Attempt | null, presence: string) {
  const result = attempt?.result;
  let error = result?.error ?? null;
  if (result && error === null && (attempt?.closed || presence === "absent"))
    error = "The session closed during preparation. Reopen the chat.";
  return { ready: result != null && error === null, error };
}
