import type { TaskCard, WorkspaceAgentStudioState } from "@openducktor/contracts";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import type { AgentSessionSummary } from "@/state/agent-sessions-store";
import { host } from "@/state/operations/host";
import { repoConfigQueryOptions } from "@/state/queries/workspace";
import type { AgentSessionReadModelLoadState } from "@/types/agent-session-read-model";
import { reconcileAgentStudioStateForReadModel } from "./agent-studio-workspace-state";

type AgentStudioWorkspaceStateHost = Pick<typeof host, "workspaceGetRepoConfig">;

const INACTIVE_AGENT_STUDIO_WORKSPACE_ID = "__inactive_agent_studio_workspace__";

export function useAgentStudioWorkspaceStateLoad({
  activeWorkspaceId,
  tasks,
  isLoadingTasks,
  sessions,
  sessionReadModelLoadState,
  hostClient = host,
}: {
  activeWorkspaceId: string | null;
  tasks: TaskCard[];
  isLoadingTasks: boolean;
  sessions: AgentSessionSummary[];
  sessionReadModelLoadState: AgentSessionReadModelLoadState;
  hostClient?: AgentStudioWorkspaceStateHost;
}) {
  const repoConfigQuery = useQuery({
    ...repoConfigQueryOptions(activeWorkspaceId ?? INACTIVE_AGENT_STUDIO_WORKSPACE_ID, hostClient),
    enabled: activeWorkspaceId !== null,
    refetchOnMount: "always",
    staleTime: 0,
  });
  const error = repoConfigQuery.error instanceof Error ? repoConfigQuery.error : null;
  const loadedAgentStudioState =
    activeWorkspaceId && !repoConfigQuery.isFetching && !error
      ? (repoConfigQuery.data?.agentStudioState ?? null)
      : null;
  const isWaitingForSessionList = Boolean(
    loadedAgentStudioState?.activeTask?.externalSessionId &&
    sessionReadModelLoadState.kind !== "ready" &&
    sessionReadModelLoadState.kind !== "failed",
  );
  const agentStudioState = useMemo<WorkspaceAgentStudioState | null>(() => {
    if (!loadedAgentStudioState || isLoadingTasks || isWaitingForSessionList) {
      return null;
    }
    return reconcileAgentStudioStateForReadModel({
      state: loadedAgentStudioState,
      tasks,
      sessions,
      sessionListAuthoritative: sessionReadModelLoadState.kind === "ready",
    });
  }, [
    isLoadingTasks,
    isWaitingForSessionList,
    loadedAgentStudioState,
    sessionReadModelLoadState.kind,
    sessions,
    tasks,
  ]);
  const refetchAgentStudioState = repoConfigQuery.refetch;
  const retry = useCallback((): void => {
    void refetchAgentStudioState();
  }, [refetchAgentStudioState]);
  const isLoading =
    repoConfigQuery.isPending ||
    repoConfigQuery.isFetching ||
    isLoadingTasks ||
    isWaitingForSessionList;
  const canPersist =
    activeWorkspaceId !== null &&
    agentStudioState !== null &&
    !isLoading &&
    !error &&
    sessionReadModelLoadState.kind === "ready";

  return {
    loadedAgentStudioState,
    agentStudioState,
    isLoading,
    error,
    retry,
    canPersist,
  };
}
