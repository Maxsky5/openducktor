import type { AgentSessionIdentity, AgentSessionRecord } from "@openducktor/contracts";
import type { QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { errorMessage } from "@/lib/errors";
import {
  invalidateAgentSessionListQuery,
  refreshAgentSessionListQuery,
} from "@/state/queries/agent-sessions";
import { invalidateRepoTaskQueries } from "@/state/queries/tasks";
import type { AgentOrchestratorHostPort } from "./orchestrator-ports";
import { requireWorkspaceRepoPath } from "./session-invariants";

type SessionCacheRefreshFailure = {
  operation: "delete" | "save";
  repoPath: string;
  taskId: string;
  error: unknown;
};

type CreateSessionCacheEffectsArgs = {
  workspaceRepoPath: string | null;
  queryClient: QueryClient;
  hostPort: Pick<
    AgentOrchestratorHostPort,
    "agentSessionDelete" | "agentSessionsList" | "agentSessionUpsert"
  >;
  reportCacheRefreshFailure?: (failure: SessionCacheRefreshFailure) => void;
};

export const sessionCacheRefreshFailureDescription = ({
  repoPath,
  taskId,
  error,
}: {
  repoPath: string;
  taskId: string;
  error: unknown;
}): string => `${repoPath} · ${taskId}: ${errorMessage(error)}`;

const cacheRefreshFailureTitles: Record<SessionCacheRefreshFailure["operation"], string> = {
  delete: "Session deleted, but metadata refresh failed",
  save: "Session saved, but metadata refresh failed",
};

const reportDefaultCacheRefreshFailure = (failure: SessionCacheRefreshFailure): void => {
  toast.error(cacheRefreshFailureTitles[failure.operation], {
    description: sessionCacheRefreshFailureDescription(failure),
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
      await refreshAgentSessionListQuery(queryClient, repoPath, taskId, hostPort);
    } catch (error) {
      reportCacheRefreshFailure({ operation: "save", repoPath, taskId, error });
    }
  };

  const deleteSessionRecord = async (
    taskId: string,
    identity: AgentSessionIdentity,
  ): Promise<void> => {
    const repoPath = requireWorkspaceRepoPath(workspaceRepoPath);
    await hostPort.agentSessionDelete(repoPath, taskId, identity);
    try {
      await refreshAgentSessionListQuery(queryClient, repoPath, taskId, hostPort);
    } catch (error) {
      reportCacheRefreshFailure({ operation: "delete", repoPath, taskId, error });
    }
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
