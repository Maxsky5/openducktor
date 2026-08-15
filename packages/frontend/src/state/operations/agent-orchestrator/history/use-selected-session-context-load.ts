import type { AgentSessionAssociation } from "@openducktor/contracts";
import { useEffect, useMemo, useState } from "react";
import { toAgentSessionIdentity } from "@/lib/agent-session-identity";
import type { RepoRuntimeReadinessState } from "@/lib/repo-runtime-readiness";
import { useStableAgentSessionIdentity } from "@/lib/use-stable-agent-session-identity";
import { useStableAgentSessionScope } from "@/lib/use-stable-agent-session-scope";
import { useAgentOperations, useAgentSessionLiveAssociation } from "@/state/app-state-provider";
import type { AgentSessionContextLoadTarget, AgentSessionState } from "@/types/agent-orchestrator";
import { runOrchestratorSideEffect } from "../support/async-side-effects";

const missingContextTarget = ({
  session,
  liveSessionAssociation,
  repoReadinessState,
}: {
  session: AgentSessionState | null;
  liveSessionAssociation: AgentSessionAssociation | null;
  repoReadinessState: RepoRuntimeReadinessState;
}): AgentSessionContextLoadTarget | null => {
  if (session === null || session.contextUsage != null || repoReadinessState !== "ready") {
    return null;
  }
  const identity = toAgentSessionIdentity(session);
  if (session.role !== null) {
    return {
      ...identity,
      sessionScope: { kind: "workflow", taskId: session.taskId, role: session.role },
    };
  }
  if (!liveSessionAssociation || liveSessionAssociation.kind === "unbound") {
    return identity;
  }
  return { ...identity, sessionScope: liveSessionAssociation };
};

export const useSelectedSessionContextLoad = ({
  session,
  repoReadinessState,
}: {
  session: AgentSessionState | null;
  repoReadinessState: RepoRuntimeReadinessState;
}): string | null => {
  const { loadAgentSessionContext } = useAgentOperations();
  const liveSessionAssociation = useAgentSessionLiveAssociation(session);
  const [loadError, setLoadError] = useState<string | null>(null);
  const target = missingContextTarget({
    session,
    liveSessionAssociation,
    repoReadinessState,
  });
  const stableIdentity = useStableAgentSessionIdentity(target);
  const stableSessionScope = useStableAgentSessionScope(target?.sessionScope);
  const stableTarget = useMemo<AgentSessionContextLoadTarget | null>(() => {
    if (stableIdentity === null) {
      return null;
    }
    return {
      ...stableIdentity,
      ...(stableSessionScope ? { sessionScope: stableSessionScope } : {}),
    };
  }, [stableIdentity, stableSessionScope]);

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
