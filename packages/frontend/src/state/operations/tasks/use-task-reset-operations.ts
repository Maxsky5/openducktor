import type { QueryClient } from "@tanstack/react-query";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { toast } from "sonner";
import { errorMessage } from "@/lib/errors";
import { taskWorktreeQueryKeys } from "@/state/queries/build-runtime";
import { documentQueryKeys } from "@/state/queries/documents";
import {
  type AgentSessionReadPort,
  refreshAgentSessionListQuery,
} from "../../queries/agent-sessions";
import { host } from "../shared/host";
import { requireActiveRepo } from "./task-operations-model";
import type { UseTaskOperationsResult } from "./task-operations-types";

type UseTaskResetOperationsArgs = {
  activeRepoPath: string | null;
  agentSessionReadPort: Pick<AgentSessionReadPort, "agentSessionsList">;
  refreshTaskData: UseTaskOperationsResult["refreshTaskData"];
  hostPort?: Pick<typeof host, "taskReset" | "taskResetImplementation">;
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
  hostPort = host,
  notificationPort = toast,
}: UseTaskResetOperationsArgs): TaskResetOperations {
  const queryClient = useQueryClient();

  const resetTaskImplementation = useCallback(
    async (taskId: string): Promise<void> => {
      const repoPath = requireActiveRepo(activeRepoPath);
      try {
        await hostPort.taskResetImplementation(repoPath, taskId);
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
        await hostPort.taskReset(repoPath, taskId);
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
  agentSessionReadPort: Pick<AgentSessionReadPort, "agentSessionsList">,
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

const invalidateTaskWorkflowQueries = async (
  queryClient: QueryClient,
  repoPath: string,
  taskId: string,
  agentSessionReadPort: Pick<AgentSessionReadPort, "agentSessionsList">,
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
