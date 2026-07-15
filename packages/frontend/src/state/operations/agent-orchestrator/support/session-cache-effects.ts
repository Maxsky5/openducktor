import type { AgentSessionIdentity, AgentSessionRecord } from "@openducktor/contracts";
import type { QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { errorMessage } from "@/lib/errors";
import { invalidateAgentSessionListQuery } from "@/state/queries/agent-sessions";
import { invalidateRepoTaskQueries } from "@/state/queries/tasks";
import type { AgentOrchestratorHostPort } from "./orchestrator-ports";
import { requireWorkspaceRepoPath } from "./session-invariants";

type CreateSessionCacheEffectsArgs = {
  workspaceRepoPath: string | null;
  queryClient: QueryClient;
  hostPort: Pick<
    AgentOrchestratorHostPort,
    "agentSessionDelete" | "agentSessionUpsert"
  >;
  reportCacheRefreshFailure?: (failure: {
    repoPath: string;
    taskId: string;
    error: unknown;
  }) => void;
};

const reportDefaultCacheRefreshFailure = ({
  taskId,
  error,
}: {
  repoPath: string;
  taskId: string;
  error: unknown;
}): void => {
  toast.error("Session saved, but metadata refresh failed", {
    description: `${taskId}: ${errorMessage(error)}`,
  });
};

export const createSessionCacheEffects = ({
  workspaceRepoPath,
  queryClient,
  hostPort,
  reportCacheRefreshFailure = reportDefaultCacheRefreshFailure,
}: CreateSessionCacheEffectsArgs) => {
  const persistSessionRecord = async (
    taskId: string,
    record: AgentSessionRecord,
  ): Promise<void> => {
    const repoPath = requireWorkspaceRepoPath(workspaceRepoPath);
    await hostPort.agentSessionUpsert(repoPath, taskId, record);
    try {
      await invalidateAgentSessionListQuery(queryClient, repoPath, taskId, {
        refetchType: "all",
      });
    } catch (error) {
      reportCacheRefreshFailure({ repoPath, taskId, error });
    }
  };

  const deleteSessionRecord = async (
    taskId: string,
    identity: AgentSessionIdentity,
  ): Promise<void> => {
    const repoPath = requireWorkspaceRepoPath(workspaceRepoPath);
    await hostPort.agentSessionDelete(repoPath, taskId, identity);
    await invalidateAgentSessionListQuery(queryClient, repoPath, taskId, {
      refetchType: "all",
    });
  };

  const invalidateSessionStopQueries = async ({
    repoPath,
    taskId,
  }: {
    repoPath: string;
    taskId: string;
  }): Promise<void> => {
    await Promise.all([
      invalidateRepoTaskQueries(queryClient, repoPath),
      invalidateAgentSessionListQuery(queryClient, repoPath, taskId),
    ]);
  };

  return { deleteSessionRecord, persistSessionRecord, invalidateSessionStopQueries };
};
