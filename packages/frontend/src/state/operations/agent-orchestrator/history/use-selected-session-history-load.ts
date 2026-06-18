import { useEffect } from "react";
import { toAgentSessionIdentity } from "@/lib/agent-session-identity";
import type { RepoRuntimeReadinessState } from "@/lib/repo-runtime-health";
import { useStableAgentSessionIdentity } from "@/lib/use-stable-agent-session-identity";
import { useAgentOperationsContext } from "@/state/app-state-contexts";
import type { AgentSessionIdentity, AgentSessionState } from "@/types/agent-orchestrator";
import { runOrchestratorSideEffect } from "../support/async-side-effects";
import { needsInitialSessionHistoryLoad } from "../support/session-transcript-content";

export const resolveSelectedSessionHistoryLoadTarget = ({
  session,
  repoReadinessState,
}: {
  session: AgentSessionState | null;
  repoReadinessState: RepoRuntimeReadinessState;
}): AgentSessionIdentity | null => {
  if (
    session === null ||
    !needsInitialSessionHistoryLoad(session) ||
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
  const { loadAgentSessionHistory } = useAgentOperationsContext();
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
      loadAgentSessionHistory(stableTarget),
      {
        tags: stableTarget,
      },
    );
  }, [loadAgentSessionHistory, stableTarget]);
};
