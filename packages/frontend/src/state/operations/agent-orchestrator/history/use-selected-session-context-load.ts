import { useEffect, useMemo, useState } from "react";
import { toAgentSessionIdentity } from "@/lib/agent-session-identity";
import type { RepoRuntimeReadinessState } from "@/lib/repo-runtime-readiness";
import { useStableAgentSessionIdentity } from "@/lib/use-stable-agent-session-identity";
import { useAgentOperations } from "@/state/app-state-provider";
import type { AgentSessionContextLoadTarget, AgentSessionState } from "@/types/agent-orchestrator";
import { runOrchestratorSideEffect } from "../support/async-side-effects";

const missingContextTarget = ({
  session,
  repoReadinessState,
}: {
  session: AgentSessionState | null;
  repoReadinessState: RepoRuntimeReadinessState;
}): AgentSessionContextLoadTarget | null => {
  if (session === null || session.contextUsage != null || repoReadinessState !== "ready") {
    return null;
  }
  const identity = toAgentSessionIdentity(session);
  return session.role === null
    ? identity
    : {
        ...identity,
        sessionScope: { kind: "workflow", taskId: session.taskId, role: session.role },
      };
};

export const useSelectedSessionContextLoad = ({
  session,
  repoReadinessState,
}: {
  session: AgentSessionState | null;
  repoReadinessState: RepoRuntimeReadinessState;
}): string | null => {
  const { loadAgentSessionContext } = useAgentOperations();
  const [loadError, setLoadError] = useState<string | null>(null);
  const target = missingContextTarget({ session, repoReadinessState });
  const stableIdentity = useStableAgentSessionIdentity(target);
  const scopeTaskId = target?.sessionScope?.taskId ?? null;
  const scopeRole = target?.sessionScope?.role ?? null;
  const stableTarget = useMemo<AgentSessionContextLoadTarget | null>(() => {
    if (stableIdentity === null) {
      return null;
    }
    return scopeTaskId === null || scopeRole === null
      ? stableIdentity
      : {
          ...stableIdentity,
          sessionScope: { kind: "workflow", taskId: scopeTaskId, role: scopeRole },
        };
  }, [scopeRole, scopeTaskId, stableIdentity]);

  useEffect(() => {
    let isCurrentTarget = true;
    setLoadError(null);
    if (stableTarget === null) {
      return () => {
        isCurrentTarget = false;
      };
    }
    runOrchestratorSideEffect(
      "selected-session-context-load",
      loadAgentSessionContext(stableTarget),
      {
        tags: {
          externalSessionId: stableTarget.externalSessionId,
          runtimeKind: stableTarget.runtimeKind,
          workingDirectory: stableTarget.workingDirectory,
        },
        logLevel: "none",
        onFailure: ({ reason }) => {
          if (!isCurrentTarget) {
            return;
          }
          setLoadError(
            `Failed to load context usage for session "${stableTarget.externalSessionId}": ${reason}`,
          );
        },
      },
    );
    return () => {
      isCurrentTarget = false;
    };
  }, [loadAgentSessionContext, stableTarget]);

  return loadError;
};
