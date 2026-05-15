import type { QueryClient } from "@tanstack/react-query";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { toast } from "sonner";
import { errorMessage } from "@/lib/errors";
import { documentQueryKeys } from "@/state/queries/documents";
import { agentSessionQueryKeys } from "../../queries/agent-sessions";
import { host } from "../shared/host";
import { requireActiveRepo } from "./task-operations-model";
import type { UseTaskOperationsResult } from "./task-operations-types";

type UseTaskResetOperationsArgs = {
  activeRepoPath: string | null;
  refreshTaskData: UseTaskOperationsResult["refreshTaskData"];
};

export type TaskResetOperations = {
  resetTaskImplementation: (taskId: string) => Promise<void>;
  resetTask: (taskId: string) => Promise<void>;
};

export function useTaskResetOperations({
  activeRepoPath,
  refreshTaskData,
}: UseTaskResetOperationsArgs): TaskResetOperations {
  const queryClient = useQueryClient();

  const resetTaskImplementation = useCallback(
    async (taskId: string): Promise<void> => {
      const repoPath = requireActiveRepo(activeRepoPath);
      try {
        await host.taskResetImplementation(repoPath, taskId);
        await Promise.all([
          invalidateTaskWorkflowQueries(queryClient, repoPath, taskId),
          refreshTaskData(repoPath, taskId),
        ]);
        toast.success("Implementation reset", { description: taskId });
      } catch (error) {
        toast.error("Failed to reset implementation", { description: errorMessage(error) });
        throw error;
      }
    },
    [activeRepoPath, queryClient, refreshTaskData],
  );

  const resetTask = useCallback(
    async (taskId: string): Promise<void> => {
      const repoPath = requireActiveRepo(activeRepoPath);
      try {
        await host.taskReset(repoPath, taskId);
        await Promise.all([
          invalidateTaskWorkflowQueries(queryClient, repoPath, taskId),
          refreshTaskData(repoPath, taskId),
        ]);
        toast.success("Task reset", { description: taskId });
      } catch (error) {
        toast.error("Failed to reset task", { description: errorMessage(error) });
        throw error;
      }
    },
    [activeRepoPath, queryClient, refreshTaskData],
  );

  return { resetTaskImplementation, resetTask };
}

const invalidateTaskWorkflowQueries = async (
  queryClient: QueryClient,
  repoPath: string,
  taskId: string,
): Promise<void> => {
  await Promise.all([
    queryClient.invalidateQueries({
      queryKey: agentSessionQueryKeys.list(repoPath, taskId),
      exact: true,
      refetchType: "none",
    }),
    queryClient.invalidateQueries({
      queryKey: documentQueryKeys.qaReport(repoPath, taskId),
      exact: true,
      refetchType: "none",
    }),
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
  ]);
};
