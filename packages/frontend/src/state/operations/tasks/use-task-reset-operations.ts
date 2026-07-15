import type { QueryClient } from "@tanstack/react-query";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { toast } from "sonner";
import { errorMessage } from "@/lib/errors";
import { taskWorktreeQueryKeys } from "@/state/queries/build-runtime";
import { documentQueryKeys } from "@/state/queries/documents";
import { invalidateAgentSessionListQuery } from "../../queries/agent-sessions";
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
      } catch (error) {
        toast.error("Failed to reset implementation", { description: errorMessage(error) });
        throw error;
      }
      try {
        await refreshTaskAfterReset(queryClient, repoPath, taskId, refreshTaskData);
      } catch (error) {
        toast.error("Implementation reset, but metadata refresh failed", {
          description: `${repoPath} · ${taskId}: ${errorMessage(error)}`,
        });
        return;
      }
      toast.success("Implementation reset", { description: taskId });
    },
    [activeRepoPath, queryClient, refreshTaskData],
  );

  const resetTask = useCallback(
    async (taskId: string): Promise<void> => {
      const repoPath = requireActiveRepo(activeRepoPath);
      try {
        await host.taskReset(repoPath, taskId);
      } catch (error) {
        toast.error("Failed to reset task", { description: errorMessage(error) });
        throw error;
      }
      try {
        await refreshTaskAfterReset(queryClient, repoPath, taskId, refreshTaskData);
      } catch (error) {
        toast.error("Task reset, but metadata refresh failed", {
          description: `${repoPath} · ${taskId}: ${errorMessage(error)}`,
        });
        return;
      }
      toast.success("Task reset", { description: taskId });
    },
    [activeRepoPath, queryClient, refreshTaskData],
  );

  return { resetTaskImplementation, resetTask };
}

const refreshTaskAfterReset = async (
  queryClient: QueryClient,
  repoPath: string,
  taskId: string,
  refreshTaskData: UseTaskOperationsResult["refreshTaskData"],
): Promise<void> => {
  const results = await Promise.allSettled([
    invalidateTaskWorkflowQueries(queryClient, repoPath, taskId),
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
): Promise<void> => {
  await Promise.all([
    queryClient.invalidateQueries({
      queryKey: documentQueryKeys.qaReport(repoPath, taskId),
      exact: true,
      refetchType: "none",
    }),
    invalidateAgentSessionListQuery(queryClient, repoPath, taskId, { refetchType: "all" }),
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
