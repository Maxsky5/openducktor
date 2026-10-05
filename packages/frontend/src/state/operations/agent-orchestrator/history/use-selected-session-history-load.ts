import { useEffect, useRef } from "react";
import { agentSessionIdentityKey, toAgentSessionIdentity } from "@/lib/agent-session-identity";
import type { RuntimeReadinessState } from "@/lib/runtime-readiness";
import { useStableAgentSessionIdentity } from "@/lib/use-stable-agent-session-identity";
import {
  useAgentSessionHistoryLoadContext,
  useAgentSessionReadModelStateContext,
} from "@/state/app-state-contexts";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import { runOrchestratorSideEffect } from "../support/async-side-effects";
import { isFreshCodexSessionAwaitingKickoff } from "../support/fresh-codex-session";

export const useSelectedSessionHistoryLoad = ({
  session,
  runtimeReadinessState,
}: {
  session: AgentSessionState | null;
  runtimeReadinessState: RuntimeReadinessState;
}): void => {
  const { loadAgentSessionHistory } = useAgentSessionHistoryLoadContext();
  const { sessionReadModelLoadState } = useAgentSessionReadModelStateContext();
  const target = useStableAgentSessionIdentity(session ? toAgentSessionIdentity(session) : null);
  const ready = runtimeReadinessState === "ready" && sessionReadModelLoadState.kind === "ready";
  const awaitingKickoff = session !== null && isFreshCodexSessionAwaitingKickoff(session);
  const state = session?.historyLoadState;
  const failure = session?.historyLoadFailure;
  const previousRef = useRef<{ key: string | null; state: typeof state; attempted: boolean }>({
    key: null,
    state: undefined,
    attempted: false,
  });

  useEffect(() => {
    const key = target ? agentSessionIdentityKey(target) : null;
    const previous = previousRef.current;
    // A failed read waits for an explicit retry or a new visit. A coverage gap allows a new read.
    const attempted =
      previous.key === key &&
      ready &&
      state !== "loaded" &&
      !(state === "stale" && previous.state === "refreshing" && failure == null) &&
      !(state === "not_requested" && previous.state === "loading") &&
      previous.attempted;
    previousRef.current = { key, state, attempted };
    if (!ready || awaitingKickoff || target === null || attempted) return;
    if (state !== "not_requested" && state !== "failed" && !(state === "stale" && failure == null))
      return;
    previousRef.current.attempted = true;
    runOrchestratorSideEffect("selected-session-history-load", loadAgentSessionHistory(target), {
      tags: target,
    });
  }, [awaitingKickoff, failure, loadAgentSessionHistory, ready, state, target]);
};
