import type { RepoConfig, TaskCard, WorkspaceAgentStudioState } from "@openducktor/contracts";
import type { AgentSessionSummary } from "@/state/agent-sessions-store";
import type { AgentSessionReadModelLoadState } from "@/types/agent-session-read-model";
import { reconcileAgentStudioStateForReadModel } from "./agent-studio-workspace-state";

export type AgentStudioWorkspaceStateLoadModel = {
  loadedAgentStudioState: WorkspaceAgentStudioState | null;
  agentStudioState: WorkspaceAgentStudioState | null;
  isLoading: boolean;
  error: Error | null;
  canPersist: boolean;
};

export const resolveAgentStudioWorkspaceStateLoad = ({
  activeWorkspaceId,
  repoConfig,
  queryError,
  isQueryPending,
  isQueryFetching,
  tasks,
  isLoadingTasks,
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
  sessions: readonly AgentSessionSummary[];
  sessionReadModelLoadState: AgentSessionReadModelLoadState;
}): AgentStudioWorkspaceStateLoadModel => {
  const error = queryError instanceof Error ? queryError : null;
  const loadedAgentStudioState =
    activeWorkspaceId && !isQueryFetching && !error ? (repoConfig?.agentStudioState ?? null) : null;
  const isWaitingForSessionList = Boolean(
    loadedAgentStudioState?.activeTask?.externalSessionId &&
    sessionReadModelLoadState.kind !== "ready" &&
    sessionReadModelLoadState.kind !== "failed",
  );
  const agentStudioState =
    loadedAgentStudioState && !isLoadingTasks && !isWaitingForSessionList
      ? reconcileAgentStudioStateForReadModel({
          state: loadedAgentStudioState,
          tasks,
          sessions,
          sessionListAuthoritative: sessionReadModelLoadState.kind === "ready",
        })
      : null;
  const isLoading = isQueryPending || isQueryFetching || isLoadingTasks || isWaitingForSessionList;
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
    canPersist,
  };
};
