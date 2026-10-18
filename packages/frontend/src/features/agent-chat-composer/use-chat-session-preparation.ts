import { useEffect, useMemo, useState } from "react";
import { errorMessage } from "@openducktor/frontend-core/lib/errors";
import { useStableAgentSessionIdentity } from "@openducktor/frontend-core/lib/use-stable-agent-session-identity";
import { useAgentSessionsContext } from "@openducktor/frontend-core/sessions/session-contexts";
import { useAgentSession } from "@/state/app-state-provider";
import type { AgentSessionIdentity } from "@openducktor/frontend-core/types/agent-orchestrator";

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
  const identity = useStableAgentSessionIdentity(targetIdentity);
  const session = useAgentSession(identity);
  const presence = session?.livePresence ?? "unobserved";
  const [attempt, setAttempt] = useState(() => createAttempt(targetKey, enabled, prepare));
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
        setAttempt((current) => {
          if (current.key !== targetKey || current.prepare !== prepare || !current.enabled)
            return current;
          if (current.result && current.result.error !== null) return current;
          if (current.result === null) return { ...current, closed: true };
          return createAttempt(targetKey, enabled, prepare);
        });
      previous = next;
    };
    // Observe every transition, including an attach and close that React batches together.
    const unsubscribe = store.subscribe(observe);
    observe();
    return unsubscribe;
  }, [enabled, identity, prepare, presence, store, targetKey]);
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    const settle = (error: string | null) => {
      if (!active) return;
      setAttempt((current) => {
        if (current.token !== token) return current;
        return { ...current, result: { error } };
      });
    };
    void prepare().then(
      () => settle(null),
      (cause: unknown) => settle(errorMessage(cause)),
    );
    return () => {
      active = false;
    };
  }, [enabled, prepare, token]);
  const result = enabled && !changed ? attempt.result : null;
  let error = result?.error ?? null;
  if (result && error === null && (attempt.closed || presence === "absent"))
    error = "The session closed during preparation. Reopen the chat.";
  const ready = result !== null && error === null;
  return useMemo(() => ({ ready, error }), [ready, error]);
}

const createAttempt = (key: string, enabled: boolean, prepare: () => Promise<void>): Attempt => ({
  key,
  enabled,
  prepare,
  token: {},
  closed: false,
  result: null,
});
