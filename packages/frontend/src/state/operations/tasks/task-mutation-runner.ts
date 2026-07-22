import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import { toast } from "sonner";
import { errorMessage } from "@/lib/errors";
import { invalidateCachedTaskDocumentQueries } from "@/state/queries/documents";
import { getProductionTaskViewSync } from "@/state/queries/task-view-sync";
import {
  formatTaskAssetFailure,
  taskAssetFailureFromError,
  taskAssetRecoveryRefreshStrategy,
} from "./task-asset-failure-recovery";
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

export const executeTaskMutation = async ({
  run,
  refresh,
}: {
  run: () => Promise<void>;
  refresh: () => Promise<void>;
}): Promise<{ refreshError: unknown | null }> => {
  await run();
  try {
    await refresh();
    return { refreshError: null };
  } catch (refreshError) {
    return { refreshError };
  }
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
      if (strategy.kind === "invalidate-task") {
        await taskViewSync.refreshAfterLocalMutation(repoPath, { kind: "task-list-only" });
        await invalidateCachedTaskDocumentQueries(queryClient, repoPath, [strategy.taskId]);
        return;
      }
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
    [queryClient, taskViewSync],
  );

  const runTaskMutation = useCallback(
    async (options: RunTaskMutationOptions): Promise<void> => {
      let repoPath: string | null = null;
      try {
        const currentRepoPath = requireActiveRepo(activeRepoPath);
        repoPath = currentRepoPath;
        const result = await executeTaskMutation({
          run: () => options.run(currentRepoPath),
          refresh: () => refreshTaskMutationViews(currentRepoPath, options.refreshStrategy),
        });
        if (result.refreshError) {
          toast.error("Task saved, but the view could not refresh", {
            description: `${errorMessage(result.refreshError)} The saved task will appear after the next refresh.`,
          });
          return;
        }
        if (options.successTitle) {
          toast.success(options.successTitle, { description: options.successDescription });
        }
      } catch (error) {
        const taskAssetFailure = taskAssetFailureFromError(error);
        let errorToThrow = error;
        const recoveryStrategy = taskAssetRecoveryRefreshStrategy(
          taskAssetFailure,
          options.refreshStrategy,
        );
        if (repoPath && recoveryStrategy) {
          try {
            await refreshTaskMutationViews(repoPath, recoveryStrategy);
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
