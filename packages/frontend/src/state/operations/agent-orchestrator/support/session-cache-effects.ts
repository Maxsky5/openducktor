import type { AgentSessionRecord } from "@openducktor/contracts";
import type { QueryClient } from "@tanstack/react-query";
import {
  invalidateAgentSessionListQuery,
  upsertAgentSessionRecordInQuery,
} from "@/state/queries/agent-sessions";
import { invalidateRepoTaskQueries } from "@/state/queries/tasks";
import type { AgentOrchestratorHostPort } from "./orchestrator-ports";
import { requireWorkspaceRepoPath } from "./session-invariants";

type CreateSessionCacheEffectsArgs = {
  workspaceRepoPath: string | null;
  queryClient: QueryClient;
  hostPort: Pick<AgentOrchestratorHostPort, "agentSessionUpsert">;
};

export const createSessionCacheEffects = ({
  workspaceRepoPath,
  queryClient,
  hostPort,
}: CreateSessionCacheEffectsArgs) => {
  const persistSessionRecord = async (
    taskId: string,
    record: AgentSessionRecord,
  ): Promise<void> => {
    const repoPath = requireWorkspaceRepoPath(workspaceRepoPath);
    await hostPort.agentSessionUpsert(repoPath, taskId, record);
    upsertAgentSessionRecordInQuery(queryClient, repoPath, taskId, record);
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

  return { persistSessionRecord, invalidateSessionStopQueries };
};
