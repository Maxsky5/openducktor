import type { AgentSessionIdentity, AgentSessionRecord } from "@openducktor/contracts";
import type { QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { errorMessage } from "@/lib/errors";
import { refreshAgentSessionListQuery } from "@/state/queries/agent-sessions";
import { invalidateRepoTaskQueries } from "@/state/queries/tasks";
import type { AgentOrchestratorHostPort } from "./orchestrator-ports";

type SessionCacheRefreshFailure = {
  operation: "delete" | "save";
  repoPath: string;
  taskId: string;
  error: unknown;
};

type CreateSessionCacheEffectsArgs = {
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

const cacheRefreshFailureTitles = {
  delete: "Session deleted, but metadata refresh failed",
  save: "Session saved, but metadata refresh failed",
} satisfies Record<SessionCacheRefreshFailure["operation"], string>;

const reportDefaultCacheRefreshFailure = (failure: SessionCacheRefreshFailure): void => {
  toast.error(cacheRefreshFailureTitles[failure.operation], {
    description: sessionCacheRefreshFailureDescription(failure),
  });
};

export const createSessionCacheEffects = ({
  queryClient,
  hostPort,
  reportCacheRefreshFailure = reportDefaultCacheRefreshFailure,
}: CreateSessionCacheEffectsArgs) => {
  const persistSessionRecord = async (
    repoPath: string,
    taskId: string,
    record: AgentSessionRecord,
  ): Promise<void> => {
    await hostPort.agentSessionUpsert(repoPath, taskId, record);
    try {
      await refreshAgentSessionListQuery(queryClient, repoPath, taskId, hostPort);
    } catch (error) {
      reportCacheRefreshFailure({ operation: "save", repoPath, taskId, error });
    }
  };

  const deleteSessionRecord = async (
    repoPath: string,
    taskId: string,
    identity: AgentSessionIdentity,
  ): Promise<void> => {
    await hostPort.agentSessionDelete(repoPath, taskId, identity);
    try {
      await refreshAgentSessionListQuery(queryClient, repoPath, taskId, hostPort);
    } catch (error) {
      reportCacheRefreshFailure({ operation: "delete", repoPath, taskId, error });
    }
  };

  const invalidateSessionStopQueries = async ({
    repoPath,
  }: {
    repoPath: string;
    taskId: string;
  }): Promise<void> => {
    await invalidateRepoTaskQueries(queryClient, repoPath);
  };

  return { deleteSessionRecord, persistSessionRecord, invalidateSessionStopQueries };
};
