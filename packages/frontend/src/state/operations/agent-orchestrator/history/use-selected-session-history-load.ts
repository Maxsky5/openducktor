import { useEffect, useRef } from "react";
import { agentSessionIdentityKey, toAgentSessionIdentity } from "@/lib/agent-session-identity";
import type { RuntimeReadinessState } from "@/lib/runtime-readiness";
import { useStableAgentSessionIdentity } from "@/lib/use-stable-agent-session-identity";
import { useAgentSessionHistoryLoadContext } from "@/state/app-state-contexts";
import type { AgentSessionIdentity, AgentSessionState } from "@/types/agent-orchestrator";
import { runOrchestratorSideEffect } from "../support/async-side-effects";
import { isFreshCodexSessionAwaitingKickoff } from "../support/fresh-codex-session";
import { shouldRequestSelectedSessionBaselineHistory } from "./session-history-load-policy";

type SelectedSessionHistoryAction = {
  identity: AgentSessionIdentity;
  kind: "baseline" | "revalidate";
};

const resolveSelectedSessionHistoryAction = ({
  session,
  runtimeReadinessState,
}: {
  session: AgentSessionState | null;
  runtimeReadinessState: RuntimeReadinessState;
}): SelectedSessionHistoryAction | null => {
  if (session === null || runtimeReadinessState !== "ready") {
    return null;
  }

  if (isFreshCodexSessionAwaitingKickoff(session)) {
    return null;
  }

  if (shouldRequestSelectedSessionBaselineHistory(session)) {
    return { identity: toAgentSessionIdentity(session), kind: "baseline" };
  }

  if (session.historyLoadState === "loaded") {
    return { identity: toAgentSessionIdentity(session), kind: "revalidate" };
  }

  return null;
};

export const useSelectedSessionHistoryLoad = ({
  session,
  runtimeReadinessState,
}: {
  session: AgentSessionState | null;
  runtimeReadinessState: RuntimeReadinessState;
}): void => {
  const { loadSelectedSessionBaselineHistory, revalidateAgentSessionHistory } =
    useAgentSessionHistoryLoadContext();
  const action = resolveSelectedSessionHistoryAction({
    session,
    runtimeReadinessState,
  });
  const stableTarget = useStableAgentSessionIdentity(action?.identity ?? null);
  const previousTargetKeyRef = useRef<string | null>(null);
  const hasSelectedSession = session !== null;

  useEffect(() => {
    if (!hasSelectedSession) {
      previousTargetKeyRef.current = null;
      return;
    }

    // Run once per selected session, not on every state it passes through. A
    // baseline load turns the state loading, then loaded; both must not start a
    // revalidation of the history that just arrived.
    if (stableTarget === null) {
      return;
    }

    const targetKey = agentSessionIdentityKey(stableTarget);
    if (previousTargetKeyRef.current === targetKey) {
      return;
    }
    previousTargetKeyRef.current = targetKey;

    if (action?.kind === "revalidate") {
      runOrchestratorSideEffect(
        "selected-session-history-revalidate",
        revalidateAgentSessionHistory(stableTarget),
        { tags: stableTarget },
      );
      return;
    }

    runOrchestratorSideEffect(
      "selected-session-history-load",
      loadSelectedSessionBaselineHistory(stableTarget),
      { tags: stableTarget },
    );
  }, [
    action?.kind,
    hasSelectedSession,
    loadSelectedSessionBaselineHistory,
    revalidateAgentSessionHistory,
    stableTarget,
  ]);
};
