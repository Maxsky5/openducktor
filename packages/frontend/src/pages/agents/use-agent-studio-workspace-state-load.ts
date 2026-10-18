import type { TaskCard } from "@openducktor/contracts";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import type { AgentSessionSummary } from "@openducktor/frontend-core/sessions/agent-sessions-store";
import { repoConfigQueryOptions } from "@openducktor/frontend-core/queries/workspace";
import type { AgentSessionReadModelLoadState } from "@openducktor/frontend-core/types/agent-session-read-model";
import { buildAgentStudioStateLoad } from "./agent-studio-workspace-state-load-model";

const INACTIVE_AGENT_STUDIO_WORKSPACE_ID = "__inactive_agent_studio_workspace__";

export function useAgentStudioWorkspaceStateLoad({
  activeWorkspaceId,
  tasks,
  isLoadingTasks,
  tasksAreCurrent,
  sessions,
  sessionReadModelLoadState,
}: {
  activeWorkspaceId: string | null;
  tasks: TaskCard[];
  isLoadingTasks: boolean;
  tasksAreCurrent: boolean;
  sessions: AgentSessionSummary[];
  sessionReadModelLoadState: AgentSessionReadModelLoadState;
}) {
  const queryOptions = repoConfigQueryOptions(
    activeWorkspaceId ?? INACTIVE_AGENT_STUDIO_WORKSPACE_ID,
  );
  const repoConfigQuery = useQuery({
    ...queryOptions,
    enabled: activeWorkspaceId !== null,
    refetchOnMount: false,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
  });
  const loadModel = useMemo(
    () =>
      buildAgentStudioStateLoad({
        activeWorkspaceId,
        repoConfig: repoConfigQuery.data,
        queryError: repoConfigQuery.error,
        isQueryPending: repoConfigQuery.isPending,
        tasks,
        isLoadingTasks,
        tasksAreCurrent,
        sessions,
        sessionReadModelLoadState,
      }),
    [
      activeWorkspaceId,
      tasksAreCurrent,
      isLoadingTasks,
      repoConfigQuery.data,
      repoConfigQuery.error,
      repoConfigQuery.isPending,
      sessionReadModelLoadState,
      sessions,
      tasks,
    ],
  );
  const refetchAgentStudioState = repoConfigQuery.refetch;
  const retry = useCallback(async (): Promise<void> => {
    await refetchAgentStudioState();
  }, [refetchAgentStudioState]);

  return {
    ...loadModel,
    retry,
  };
}
