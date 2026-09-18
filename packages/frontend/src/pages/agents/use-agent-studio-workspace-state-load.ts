import type { TaskCard } from "@openducktor/contracts";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { logSwitchPerf } from "@/lib/switch-perf-debug";
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
  tasksAreCurrent,
  sessions,
  sessionReadModelLoadState,
  hostClient = host,
}: {
  activeWorkspaceId: string | null;
  tasks: TaskCard[];
  isLoadingTasks: boolean;
  tasksAreCurrent: boolean;
  sessions: AgentSessionSummary[];
  sessionReadModelLoadState: AgentSessionReadModelLoadState;
  hostClient?: AgentStudioWorkspaceStateHost;
}) {
  const [visit, setVisit] = useState({ workspaceId: activeWorkspaceId, key: 0 });
  let currentVisit = visit;
  if (visit.workspaceId !== activeWorkspaceId) {
    currentVisit = { workspaceId: activeWorkspaceId, key: visit.key + 1 };
    setVisit(currentVisit);
  }
  const queryOptions = repoConfigQueryOptions(
    activeWorkspaceId ?? INACTIVE_AGENT_STUDIO_WORKSPACE_ID,
    hostClient,
  );
  const repoConfigQuery = useQuery({
    ...queryOptions,
    enabled: activeWorkspaceId !== null,
    refetchOnMount: false,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
  });
  const loggedRepoConfigWorkspaceRef = useRef<string | null>(null);
  useEffect(() => {
    if (!activeWorkspaceId || !repoConfigQuery.data) {
      return;
    }
    if (loggedRepoConfigWorkspaceRef.current === activeWorkspaceId) {
      return;
    }
    loggedRepoConfigWorkspaceRef.current = activeWorkspaceId;
    logSwitchPerf(`agent studio repo config ready ${activeWorkspaceId}`);
  }, [activeWorkspaceId, repoConfigQuery.data]);
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
  const loggedStudioStateWorkspaceRef = useRef<string | null>(null);
  useEffect(() => {
    if (!activeWorkspaceId || loadModel.isLoading || loadModel.agentStudioState === null) {
      return;
    }
    if (loggedStudioStateWorkspaceRef.current === activeWorkspaceId) {
      return;
    }
    loggedStudioStateWorkspaceRef.current = activeWorkspaceId;
    logSwitchPerf(`agent studio state ready ${activeWorkspaceId}`);
  }, [activeWorkspaceId, loadModel.agentStudioState, loadModel.isLoading]);
  const retry = useCallback((): void => {
    void refetchAgentStudioState();
  }, [refetchAgentStudioState]);

  return {
    ...loadModel,
    agentStudioStateLoadKey:
      loadModel.loadedAgentStudioState === null ? null : `${activeWorkspaceId}:${currentVisit.key}`,
    retry,
  };
}
