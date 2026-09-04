import type { RepoConfig, TaskCard, WorkspaceAgentStudioState } from "@openducktor/contracts";
import type { AgentSessionSummary } from "@/state/agent-sessions-store";
import type { AgentSessionReadModelLoadState } from "@/types/agent-session-read-model";
import { buildAgentStudioReadState } from "./agent-studio-workspace-state";

export type AgentStudioWorkspaceStateLoadModel = {
  loadedAgentStudioState: WorkspaceAgentStudioState | null;
  agentStudioState: WorkspaceAgentStudioState | null;
  isLoading: boolean;
  error: Error | null;
  canSave: boolean;
};

export const buildAgentStudioStateLoad = ({
  activeWorkspaceId,
  repoConfig,
  queryError,
  isQueryPending,
  isQueryFetching,
  tasks,
  isLoadingTasks,
  tasksAreCurrent,
  sessions,
  sessionReadModelLoadState,
}: {
  activeWorkspaceId: string | null;
  repoConfig: RepoConfig | undefined;
  queryError: unknown;
  isQueryPending: boolean;
  isQueryFetching: boolean;
  tasks: readonly TaskCard[];
  isLoadingTasks: boolean;
  tasksAreCurrent: boolean;
  sessions: readonly AgentSessionSummary[];
  sessionReadModelLoadState: AgentSessionReadModelLoadState;
}): AgentStudioWorkspaceStateLoadModel => {
  const error = queryError instanceof Error ? queryError : null;
  const loadedAgentStudioState =
    activeWorkspaceId && !isQueryFetching && !error ? (repoConfig?.agentStudioState ?? null) : null;
  const waitsForSessions = Boolean(
    loadedAgentStudioState?.activeTask?.externalSessionId &&
    sessionReadModelLoadState.kind !== "ready" &&
    sessionReadModelLoadState.kind !== "failed",
  );
  let agentStudioState: WorkspaceAgentStudioState | null = null;
  if (loadedAgentStudioState && !isLoadingTasks && !waitsForSessions) {
    agentStudioState = tasksAreCurrent
      ? buildAgentStudioReadState({
          state: loadedAgentStudioState,
          tasks,
          sessions,
          sessionsReady: sessionReadModelLoadState.kind === "ready",
        })
      : loadedAgentStudioState;
  }
  const isLoading = isQueryPending || isQueryFetching || isLoadingTasks || waitsForSessions;
  const canSave =
    activeWorkspaceId !== null &&
    agentStudioState !== null &&
    !isLoading &&
    !error &&
    tasksAreCurrent &&
    sessionReadModelLoadState.kind === "ready";

  return {
    loadedAgentStudioState,
    agentStudioState,
    isLoading,
    error,
    canSave,
  };
};
