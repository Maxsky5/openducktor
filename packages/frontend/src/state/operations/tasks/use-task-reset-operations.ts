import type { QueryClient } from "@tanstack/react-query";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { toast } from "sonner";
import { errorMessage } from "@openducktor/frontend-core/lib/errors";
import { taskWorktreeQueryKeys } from "@openducktor/frontend-core/queries/build-runtime";
import { documentQueryKeys } from "@openducktor/frontend-core/queries/documents";
import { taskStopImpactQueryKeys } from "@openducktor/frontend-core/queries/task-stop-impact";
import {
  type AgentSessionReadPort,
  refreshAgentSessionListQuery,
} from "@openducktor/frontend-core/queries/agent-sessions";
import { requireActiveRepo } from "./task-operations-model";
import type { UseTaskOperationsResult } from "./task-operations-types";
import { useHostClient } from "@openducktor/frontend-core/connection/client-connection-react";
import type { HostClient } from "@openducktor/host-client";

type UseTaskResetOperationsArgs = {
  activeRepoPath: string | null;
  agentSessionReadPort: AgentSessionReadPort;
  refreshTaskData: UseTaskOperationsResult["refreshTaskData"];
  hostPort?: Pick<HostClient, "taskReset" | "taskResetImplementation">;
  notificationPort?: Pick<typeof toast, "error" | "success">;
};

export type TaskResetOperations = {
  resetTaskImplementation: (taskId: string) => Promise<void>;
  resetTask: (taskId: string) => Promise<void>;
};

export function useTaskResetOperations({
  activeRepoPath,
  agentSessionReadPort,
  refreshTaskData,
  hostPort: suppliedHostPort,
  notificationPort = toast,
}: UseTaskResetOperationsArgs): TaskResetOperations {
  const queryClient = useQueryClient();
  const host = useHostClient();
  const hostPort = suppliedHostPort ?? host;

  const resetTaskImplementation = useCallback(
    async (taskId: string): Promise<void> => {
      const repoPath = requireActiveRepo(activeRepoPath);
      try {
        try {
          await hostPort.taskResetImplementation(repoPath, taskId);
        } finally {
          await invalidateTaskStopImpact(queryClient, repoPath);
        }
      } catch (error) {
        notificationPort.error("Failed to reset implementation", {
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
        notificationPort.error("Implementation reset, but metadata refresh failed", {
          description: `${repoPath} · ${taskId}: ${errorMessage(error)}`,
        });
        return;
      }
      notificationPort.success("Implementation reset", { description: taskId });
    },
    [
      activeRepoPath,
      agentSessionReadPort,
      hostPort,
      notificationPort,
      queryClient,
      refreshTaskData,
    ],
  );

  const resetTask = useCallback(
    async (taskId: string): Promise<void> => {
      const repoPath = requireActiveRepo(activeRepoPath);
      try {
        try {
          await hostPort.taskReset(repoPath, taskId);
        } finally {
          await invalidateTaskStopImpact(queryClient, repoPath);
        }
      } catch (error) {
        notificationPort.error("Failed to reset task", { description: errorMessage(error) });
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
        notificationPort.error("Task reset, but metadata refresh failed", {
          description: `${repoPath} · ${taskId}: ${errorMessage(error)}`,
        });
        return;
      }
      notificationPort.success("Task reset", { description: taskId });
    },
    [
      activeRepoPath,
      agentSessionReadPort,
      hostPort,
      notificationPort,
      queryClient,
      refreshTaskData,
    ],
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
    queryClient.invalidateQueries({
      queryKey: documentQueryKeys.qaReport(repoPath, taskId),
      exact: true,
      refetchType: "none",
    }),
    refreshAgentSessionListQuery(queryClient, repoPath, taskId, agentSessionReadPort),
    queryClient.invalidateQueries({
      queryKey: documentQueryKeys.spec(repoPath, taskId),
      exact: true,
      refetchType: "none",
    }),
    queryClient.invalidateQueries({
      queryKey: documentQueryKeys.plan(repoPath, taskId),
      exact: true,
      refetchType: "none",
    }),
    queryClient.invalidateQueries({
      queryKey: taskWorktreeQueryKeys.taskWorktree({ repoPath, taskId }),
    }),
  ]);
};
