import { useQuery } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import type { AgentSessionSummary } from "@openducktor/frontend-core/sessions/agent-sessions-store";
import { repoConfigQueryOptionsOrSkip } from "@openducktor/frontend-core/queries/workspace";
import type { AgentSessionReadModelLoadState } from "@openducktor/frontend-core/types/agent-session-read-model";
import { buildAgentStudioStateLoad } from "./agent-studio-workspace-state-load-model";
import type { ResolvedTaskCard as TaskCard } from "@openducktor/workflows";

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
  const repoConfigQuery = useQuery({
    ...repoConfigQueryOptionsOrSkip(activeWorkspaceId),
    refetchOnMount: false,
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
