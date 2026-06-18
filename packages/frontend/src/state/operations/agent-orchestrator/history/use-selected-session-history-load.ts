import { useEffect } from "react";
import { toAgentSessionIdentity } from "@/lib/agent-session-identity";
import type { RepoRuntimeReadinessState } from "@/lib/repo-runtime-health";
import { useAgentOperationsContext } from "@/state/app-state-contexts";
import type { AgentSessionIdentity, AgentSessionState } from "@/types/agent-orchestrator";
import { runOrchestratorSideEffect } from "../support/async-side-effects";
import { hasRenderableSessionTranscript } from "../support/session-transcript-content";

export const resolveSelectedSessionHistoryLoadTarget = ({
  session,
  repoReadinessState,
}: {
  session: AgentSessionState | null;
  repoReadinessState: RepoRuntimeReadinessState;
}): AgentSessionIdentity | null => {
  if (
    session === null ||
    session.historyLoadState !== "not_requested" ||
    hasRenderableSessionTranscript(session) ||
    repoReadinessState !== "ready"
  ) {
    return null;
  }

  return toAgentSessionIdentity(session);
};

export const useSelectedSessionHistoryLoad = ({
  target,
}: {
  target: AgentSessionIdentity | null;
}): void => {
  const { loadAgentSessionHistory } = useAgentOperationsContext();
  const externalSessionId = target?.externalSessionId ?? null;
  const runtimeKind = target?.runtimeKind ?? null;
  const workingDirectory = target?.workingDirectory ?? null;

  useEffect(() => {
    if (!externalSessionId || !runtimeKind || !workingDirectory) {
      return;
    }

    runOrchestratorSideEffect(
      "selected-session-history-load",
      loadAgentSessionHistory({ externalSessionId, runtimeKind, workingDirectory }),
      {
        tags: {
          externalSessionId,
          runtimeKind,
          workingDirectory,
        },
      },
    );
  }, [externalSessionId, loadAgentSessionHistory, runtimeKind, workingDirectory]);
};
