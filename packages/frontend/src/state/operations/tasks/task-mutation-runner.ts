import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import { toast } from "sonner";
import { errorMessage } from "@/lib/errors";
import { getProductionTaskViewSync } from "@/state/queries/task-view-sync";
import { formatTaskAssetFailure, taskAssetFailureFromError } from "./task-asset-failure-recovery";
import { requireActiveRepo } from "./task-operations-model";
import type { TaskMutationRefreshStrategy } from "./task-operations-types";

type RunTaskMutationOptions = {
  refreshStrategy: TaskMutationRefreshStrategy;
  run: (repoPath: string) => Promise<void>;
  successTitle?: string;
  successDescription: string;
  failureTitle: string;
};

type UseTaskMutationRunnerArgs = {
  activeRepoPath: string | null;
};

export type TaskMutationRunner = {
  refreshTaskMutationViews: (
    repoPath: string,
    strategy: TaskMutationRefreshStrategy,
  ) => Promise<void>;
  runTaskMutation: (options: RunTaskMutationOptions) => Promise<void>;
};

export function useTaskMutationRunner({
  activeRepoPath,
}: UseTaskMutationRunnerArgs): TaskMutationRunner {
  const queryClient = useQueryClient();
  const taskViewSync = useMemo(() => getProductionTaskViewSync(queryClient), [queryClient]);

  const refreshTaskMutationViews = useCallback(
    async (repoPath: string, strategy: TaskMutationRefreshStrategy): Promise<void> => {
      if (strategy.kind === "task") {
        await taskViewSync.refreshAfterLocalMutation(repoPath, {
          kind: "refresh-documents",
          taskIds: [strategy.taskId],
        });
        return;
      }

      if (strategy.kind === "remove-task") {
        await taskViewSync.refreshAfterLocalMutation(repoPath, {
          kind: "remove-documents",
          taskIds: strategy.taskIds,
        });
        return;
      }

      await taskViewSync.refreshAfterLocalMutation(repoPath, { kind: "task-list-only" });
    },
    [taskViewSync],
  );

  const runTaskMutation = useCallback(
    async (options: RunTaskMutationOptions): Promise<void> => {
      let mutationCompleted = false;
      let repoPath: string | null = null;
      try {
        repoPath = requireActiveRepo(activeRepoPath);
        await options.run(repoPath);
        mutationCompleted = true;
        await refreshTaskMutationViews(repoPath, options.refreshStrategy);
        if (options.successTitle) {
          toast.success(options.successTitle, { description: options.successDescription });
        }
      } catch (error) {
        if (mutationCompleted) {
          toast.error("Mutation succeeded, local views failed to refresh", {
            description: errorMessage(error),
          });
          return;
        }
        const taskAssetFailure = taskAssetFailureFromError(error);
        let errorToThrow = error;
        if (repoPath && taskAssetFailure && taskAssetFailure.durableState !== "unchanged") {
          try {
            if (
              taskAssetFailure.operation === "delete" &&
              taskAssetFailure.durableState === "committed_cleanup_pending"
            ) {
              await refreshTaskMutationViews(repoPath, options.refreshStrategy);
            } else if (taskAssetFailure.taskId) {
              await refreshTaskMutationViews(repoPath, {
                kind: "task",
                taskId: taskAssetFailure.taskId,
              });
            } else {
              await refreshTaskMutationViews(repoPath, { kind: "repo" });
            }
          } catch (refreshError) {
            errorToThrow = new AggregateError(
              [error, refreshError],
              `${errorMessage(error)} Task state refresh also failed: ${errorMessage(refreshError)}`,
            );
          }
        }
        let failureDescription = taskAssetFailure
          ? formatTaskAssetFailure(taskAssetFailure)
          : errorMessage(errorToThrow);
        if (taskAssetFailure && errorToThrow instanceof AggregateError) {
          const refreshError = errorToThrow.errors[1];
          failureDescription = `${failureDescription} Task state refresh also failed: ${errorMessage(refreshError)}`;
        }
        toast.error(options.failureTitle, { description: failureDescription });
        throw errorToThrow;
      }
    },
    [activeRepoPath, refreshTaskMutationViews],
  );

  return { refreshTaskMutationViews, runTaskMutation };
}
