import { useEffect } from "react";
import { toAgentSessionIdentity } from "@/lib/agent-session-identity";
import type { RepoRuntimeReadinessState } from "@/lib/repo-runtime-health";
import { useAgentOperationsContext } from "@/state/app-state-contexts";
import type { AgentSessionIdentity, AgentSessionState } from "@/types/agent-orchestrator";
import { runOrchestratorSideEffect } from "../support/async-side-effects";

export type SelectedSessionHistoryLoadTarget = {
  session: AgentSessionState | null;
  repoReadinessState: RepoRuntimeReadinessState;
};

export const resolveSelectedSessionHistoryLoadTarget = ({
  session,
  repoReadinessState,
}: SelectedSessionHistoryLoadTarget): AgentSessionIdentity | null => {
  if (
    session === null ||
    session.historyLoadState !== "not_requested" ||
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

  useEffect(() => {
    const target = resolveSelectedSessionHistoryLoadTarget({
      session,
      repoReadinessState,
    });
    if (!target) {
      return;
    }

    runOrchestratorSideEffect("selected-session-history-load", loadAgentSessionHistory(target), {
      tags: {
        externalSessionId: target.externalSessionId,
        runtimeKind: target.runtimeKind,
        workingDirectory: target.workingDirectory,
      },
    });
  }, [loadAgentSessionHistory, repoReadinessState, session]);
};
