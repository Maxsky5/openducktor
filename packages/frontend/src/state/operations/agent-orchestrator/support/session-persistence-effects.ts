import type { AgentSessionRecord, RuntimeKind } from "@openducktor/contracts";
import type { QueryClient } from "@tanstack/react-query";
import {
  agentSessionQueryKeys,
  upsertAgentSessionRecordInQuery,
} from "@/state/queries/agent-sessions";
import { runtimeQueryKeys } from "@/state/queries/runtime";
import { invalidateRepoTaskQueries, upsertAgentSessionInRepoTaskData } from "@/state/queries/tasks";
import type { AgentOrchestratorHostPort } from "./orchestrator-dependencies";

type CreateSessionPersistenceEffectsArgs = {
  workspaceRepoPath: string | null;
  queryClient: QueryClient;
  hostPort: Pick<AgentOrchestratorHostPort, "agentSessionUpsert">;
};

export const createSessionPersistenceEffects = ({
  workspaceRepoPath,
  queryClient,
  hostPort,
}: CreateSessionPersistenceEffectsArgs) => {
  const persistSessionRecord = async (
    taskId: string,
    record: AgentSessionRecord,
  ): Promise<void> => {
    if (!workspaceRepoPath) {
      return;
    }
    await hostPort.agentSessionUpsert(workspaceRepoPath, taskId, record);
    upsertAgentSessionRecordInQuery(queryClient, workspaceRepoPath, taskId, record);
    upsertAgentSessionInRepoTaskData(queryClient, workspaceRepoPath, taskId, record);
  };

  const invalidateSessionStopQueries = async ({
    repoPath,
    taskId,
    runtimeKind,
  }: {
    repoPath: string;
    taskId: string;
    runtimeKind?: RuntimeKind;
  }): Promise<void> => {
    await Promise.all([
      invalidateRepoTaskQueries(queryClient, repoPath),
      queryClient.invalidateQueries({
        queryKey: agentSessionQueryKeys.list(repoPath, taskId),
        exact: true,
        refetchType: "none",
      }),
      ...(runtimeKind
        ? [
            queryClient.invalidateQueries({
              queryKey: runtimeQueryKeys.list(runtimeKind, repoPath),
              exact: true,
              refetchType: "none",
            }),
          ]
        : []),
    ]);
  };

  return { persistSessionRecord, invalidateSessionStopQueries };
};
