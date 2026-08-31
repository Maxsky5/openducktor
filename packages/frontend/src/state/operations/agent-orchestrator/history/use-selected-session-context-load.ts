import { useEffect, useMemo, useState } from "react";
import { toAgentSessionIdentity } from "@/lib/agent-session-identity";
import type { RepoRuntimeReadinessState } from "@/lib/repo-runtime-readiness";
import { useStableAgentSessionIdentity } from "@/lib/use-stable-agent-session-identity";
import { useStableAgentSessionScope } from "@/lib/use-stable-agent-session-scope";
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
  if (session === null || repoReadinessState !== "ready") {
    return null;
  }
  const needsCodexModel = session.runtimeKind === "codex" && session.selectedModel === null;
  if (session.contextUsage != null && !needsCodexModel) {
    return null;
  }
  const identity = toAgentSessionIdentity(session);
  if (session.sessionAssociation.kind === "unbound") {
    return { repoPath: session.repoPath, ...identity };
  }
  return { repoPath: session.repoPath, ...identity, sessionScope: session.sessionAssociation };
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
  const target = missingContextTarget({
    session,
    repoReadinessState,
  });
  const stableIdentity = useStableAgentSessionIdentity(target);
  const stableSessionScope = useStableAgentSessionScope(target?.sessionScope);
  const stableRepoPath = target?.repoPath ?? null;
  const stableTarget = useMemo<AgentSessionContextLoadTarget | null>(() => {
    if (stableIdentity === null || stableRepoPath === null) {
      return null;
    }
    const stableTarget: AgentSessionContextLoadTarget = {
      repoPath: stableRepoPath,
      ...stableIdentity,
    };
    if (stableSessionScope) {
      stableTarget.sessionScope = stableSessionScope;
    }
    return stableTarget;
  }, [stableIdentity, stableRepoPath, stableSessionScope]);

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
