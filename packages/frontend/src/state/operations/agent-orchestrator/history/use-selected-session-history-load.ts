import { useEffect, useRef } from "react";
import { agentSessionIdentityKey, toAgentSessionIdentity } from "@/lib/agent-session-identity";
import type { RepoRuntimeReadinessState } from "@/lib/repo-runtime-readiness";
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
  repoReadinessState,
}: {
  session: AgentSessionState | null;
  repoReadinessState: RepoRuntimeReadinessState;
}): SelectedSessionHistoryAction | null => {
  // The first live baseline supplies the generation that fences the history read.
  if (
    session === null ||
    repoReadinessState !== "ready" ||
    !session.runtimeGeneration ||
    session.historyReplayPending
  ) {
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
  repoReadinessState,
}: {
  session: AgentSessionState | null;
  repoReadinessState: RepoRuntimeReadinessState;
}): void => {
  const { loadSelectedSessionBaselineHistory, revalidateAgentSessionHistory } =
    useAgentSessionHistoryLoadContext();
  const action = resolveSelectedSessionHistoryAction({
    session,
    repoReadinessState,
  });
  const stableTarget = useStableAgentSessionIdentity(action?.identity ?? null);
  const previousRequestRef = useRef<{ targetKey: string; recoveryGeneration: number } | null>(null);
  const recoveryGeneration = session?.historyRecoveryGeneration ?? 0;
  const hasSelectedSession = session !== null;

  useEffect(() => {
    if (!hasSelectedSession) {
      previousRequestRef.current = null;
      return;
    }

    // Ordinary state changes do not request history again. A new recovery
    // generation restarts only an invalidated baseline read.
    if (stableTarget === null) {
      return;
    }

    const targetKey = agentSessionIdentityKey(stableTarget);
    const previous = previousRequestRef.current;
    if (
      previous?.targetKey === targetKey &&
      (action?.kind !== "baseline" || previous.recoveryGeneration === recoveryGeneration)
    ) {
      return;
    }
    previousRequestRef.current = { targetKey, recoveryGeneration };

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
    recoveryGeneration,
    stableTarget,
  ]);
};
