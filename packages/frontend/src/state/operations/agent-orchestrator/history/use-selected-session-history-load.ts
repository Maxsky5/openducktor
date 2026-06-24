import { useEffect } from "react";
import { toAgentSessionIdentity } from "@/lib/agent-session-identity";
import type { RepoRuntimeReadinessState } from "@/lib/repo-runtime-readiness";
import { useStableAgentSessionIdentity } from "@/lib/use-stable-agent-session-identity";
import { useAgentSessionHistoryLoadContext } from "@/state/app-state-contexts";
import type { AgentSessionIdentity, AgentSessionState } from "@/types/agent-orchestrator";
import { runOrchestratorSideEffect } from "../support/async-side-effects";
import { shouldRequestSelectedSessionBaselineHistory } from "./session-history-load-policy";

const resolveSelectedSessionHistoryLoadTarget = ({
  session,
  repoReadinessState,
}: {
  session: AgentSessionState | null;
  repoReadinessState: RepoRuntimeReadinessState;
}): AgentSessionIdentity | null => {
  if (
    session === null ||
    !shouldRequestSelectedSessionBaselineHistory(session) ||
    repoReadinessState !== "ready"
  ) {
    return null;
  }

  return toAgentSessionIdentity(session);
};

export const useSelectedSessionHistoryLoad = ({
  session,
  repoReadinessState,
}: {
  session: AgentSessionState | null;
  repoReadinessState: RepoRuntimeReadinessState;
}): void => {
  const { loadSelectedSessionBaselineHistory } = useAgentSessionHistoryLoadContext();
  const target = resolveSelectedSessionHistoryLoadTarget({
    session,
    repoReadinessState,
  });
  const stableTarget = useStableAgentSessionIdentity(target);

  useEffect(() => {
    if (stableTarget === null) {
      return;
    }

    runOrchestratorSideEffect(
      "selected-session-history-load",
      loadSelectedSessionBaselineHistory(stableTarget),
      {
        tags: stableTarget,
      },
    );
  }, [loadSelectedSessionBaselineHistory, stableTarget]);
};
