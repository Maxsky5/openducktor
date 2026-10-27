import type { QueryClient } from "@tanstack/react-query";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { errorMessage } from "../../lib/errors";
import { taskWorktreeQueryKeys } from "../../queries/build-runtime";
import { taskStopImpactQueryKeys } from "../../queries/task-stop-impact";
import { invalidateCachedTaskDocumentQueries } from "../../queries/documents";
import {
  type AgentSessionReadPort,
  refreshAgentSessionListQuery,
} from "../../queries/agent-sessions";
import { requireActiveRepo } from "./task-operations-model";
import type { UseTaskOperationsResult } from "./task-operations-types";
import { useClientConnection } from "../../connection/client-connection-react";

type UseTaskResetOperationsArgs = {
  activeRepoPath: string | null;
  agentSessionReadPort: AgentSessionReadPort;
  refreshTaskData: UseTaskOperationsResult["refreshTaskData"];
};

export type TaskResetOperations = {
  resetTaskImplementation: (taskId: string) => Promise<void>;
  resetTask: (taskId: string) => Promise<void>;
};

export function useTaskResetOperations({
  activeRepoPath,
  agentSessionReadPort,
  refreshTaskData,
}: UseTaskResetOperationsArgs): TaskResetOperations {
  const queryClient = useQueryClient();
  const { feedback, host } = useClientConnection();
  const hostClient = host.client;

  const resetTaskImplementation = useCallback(
    async (taskId: string): Promise<void> => {
      const repoPath = requireActiveRepo(activeRepoPath);
      try {
        try {
          await hostClient.taskResetImplementation(repoPath, taskId);
        } finally {
          await invalidateTaskStopImpact(queryClient, repoPath);
        }
      } catch (error) {
        feedback.show("error", "Failed to reset implementation", {
          description: errorMessage(error),
        });
        throw error;
      }
      try {
        await refreshTaskAfterReset(
          queryClient,
          repoPath,
          taskId,
          refreshTaskData,
          agentSessionReadPort,
        );
      } catch (error) {
        feedback.show("error", "Implementation reset, but metadata refresh failed", {
          description: `${repoPath} · ${taskId}: ${errorMessage(error)}`,
        });
        return;
      }
      feedback.show("success", "Implementation reset", { description: taskId });
    },
    [activeRepoPath, agentSessionReadPort, feedback, hostClient, queryClient, refreshTaskData],
  );

  const resetTask = useCallback(
    async (taskId: string): Promise<void> => {
      const repoPath = requireActiveRepo(activeRepoPath);
      try {
        try {
          await hostClient.taskReset(repoPath, taskId);
        } finally {
          await invalidateTaskStopImpact(queryClient, repoPath);
        }
      } catch (error) {
        feedback.show("error", "Failed to reset task", { description: errorMessage(error) });
        throw error;
      }
      try {
        await refreshTaskAfterReset(
          queryClient,
          repoPath,
          taskId,
          refreshTaskData,
          agentSessionReadPort,
        );
      } catch (error) {
        feedback.show("error", "Task reset, but metadata refresh failed", {
          description: `${repoPath} · ${taskId}: ${errorMessage(error)}`,
        });
        return;
      }
      feedback.show("success", "Task reset", { description: taskId });
    },
    [activeRepoPath, agentSessionReadPort, feedback, hostClient, queryClient, refreshTaskData],
  );

  return { resetTaskImplementation, resetTask };
}

const refreshTaskAfterReset = async (
  queryClient: QueryClient,
  repoPath: string,
  taskId: string,
  refreshTaskData: UseTaskOperationsResult["refreshTaskData"],
  agentSessionReadPort: AgentSessionReadPort,
): Promise<void> => {
  const results = await Promise.allSettled([
    invalidateTaskWorkflowQueries(queryClient, repoPath, taskId, agentSessionReadPort),
    refreshTaskData(repoPath, taskId),
  ]);
  const errors = results.flatMap((result) => (result.status === "rejected" ? [result.reason] : []));
  if (errors.length === 1) {
    throw errors[0];
  }
  if (errors.length > 1) {
    const details = errors.map(errorMessage).join("; ");
    throw new AggregateError(errors, `Post-reset metadata refreshes failed: ${details}`);
  }
};

const invalidateTaskStopImpact = (queryClient: QueryClient, repoPath: string): Promise<void> =>
  queryClient.invalidateQueries({ queryKey: taskStopImpactQueryKeys.repo(repoPath) });

const invalidateTaskWorkflowQueries = async (
  queryClient: QueryClient,
  repoPath: string,
  taskId: string,
  agentSessionReadPort: AgentSessionReadPort,
): Promise<void> => {
  await Promise.all([
    invalidateCachedTaskDocumentQueries(queryClient, repoPath, [taskId]),
    refreshAgentSessionListQuery(queryClient, repoPath, taskId, agentSessionReadPort),
    queryClient.invalidateQueries({
      queryKey: taskWorktreeQueryKeys.taskWorktree({ repoPath, taskId }),
    }),
  ]);
};
