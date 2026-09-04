import type { TaskCard } from "@openducktor/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import type { AgentSessionSummary } from "@/state/agent-sessions-store";
import { host } from "@/state/operations/host";
import { repoConfigQueryOptions } from "@/state/queries/workspace";
import type { AgentSessionReadModelLoadState } from "@/types/agent-session-read-model";
import { buildAgentStudioStateLoad } from "./agent-studio-workspace-state-load-model";

type AgentStudioWorkspaceStateHost = Pick<typeof host, "workspaceGetRepoConfig">;

const INACTIVE_AGENT_STUDIO_WORKSPACE_ID = "__inactive_agent_studio_workspace__";

export function useAgentStudioWorkspaceStateLoad({
  activeWorkspaceId,
  tasks,
  isLoadingTasks,
  hasCurrentTaskSnapshot,
  sessions,
  sessionReadModelLoadState,
  hostClient = host,
}: {
  activeWorkspaceId: string | null;
  tasks: TaskCard[];
  isLoadingTasks: boolean;
  hasCurrentTaskSnapshot: boolean;
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
      buildAgentStudioStateLoad({
        activeWorkspaceId,
        repoConfig: repoConfigQuery.data,
        queryError: repoConfigQuery.error,
        isQueryPending: repoConfigQuery.isPending,
        isQueryFetching: repoConfigQuery.isFetching,
        tasks,
        isLoadingTasks,
        hasCurrentTaskSnapshot,
        sessions,
        sessionReadModelLoadState,
      }),
    [
      activeWorkspaceId,
      hasCurrentTaskSnapshot,
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
    agentStudioStateLoadKey:
      loadModel.loadedAgentStudioState === null
        ? null
        : `${dataUpdateCount}:${repoConfigQuery.dataUpdatedAt}`,
    retry,
  };
}
