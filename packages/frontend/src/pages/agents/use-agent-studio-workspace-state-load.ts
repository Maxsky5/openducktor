import type { TaskCard } from "@openducktor/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import type { AgentSessionSummary } from "@/state/agent-sessions-store";
import { host } from "@/state/operations/host";
import { repoConfigQueryOptions } from "@/state/queries/workspace";
import type { AgentSessionReadModelLoadState } from "@/types/agent-session-read-model";
import { resolveAgentStudioWorkspaceStateLoad } from "./agent-studio-workspace-state-load-model";

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
  const queryClient = useQueryClient();
  const queryOptions = repoConfigQueryOptions(
    activeWorkspaceId ?? INACTIVE_AGENT_STUDIO_WORKSPACE_ID,
    hostClient,
  );
  const repoConfigQuery = useQuery({
    ...queryOptions,
    enabled: activeWorkspaceId !== null,
    refetchOnMount: "always",
    staleTime: 0,
  });
  const loadModel = useMemo(
    () =>
      resolveAgentStudioWorkspaceStateLoad({
        activeWorkspaceId,
        repoConfig: repoConfigQuery.data,
        queryError: repoConfigQuery.error,
        isQueryPending: repoConfigQuery.isPending,
        isQueryFetching: repoConfigQuery.isFetching,
        tasks,
        isLoadingTasks,
        sessions,
        sessionReadModelLoadState,
      }),
    [
      activeWorkspaceId,
      isLoadingTasks,
      repoConfigQuery.data,
      repoConfigQuery.error,
      repoConfigQuery.isFetching,
      repoConfigQuery.isPending,
      sessionReadModelLoadState,
      sessions,
      tasks,
    ],
  );
  const refetchAgentStudioState = repoConfigQuery.refetch;
  const dataUpdateCount = queryClient.getQueryState(queryOptions.queryKey)?.dataUpdateCount ?? 0;
  const retry = useCallback((): void => {
    void refetchAgentStudioState();
  }, [refetchAgentStudioState]);

  return {
    ...loadModel,
    loadedAgentStudioStateVersion:
      loadModel.loadedAgentStudioState === null
        ? null
        : `${dataUpdateCount}:${repoConfigQuery.dataUpdatedAt}`,
    retry,
  };
}
