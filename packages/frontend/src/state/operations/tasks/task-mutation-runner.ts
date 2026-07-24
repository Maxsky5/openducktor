import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import { toast } from "sonner";
import { errorMessage } from "@/lib/errors";
import { getProductionTaskViewSync } from "@/state/queries/task-view-sync";
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
      try {
        const repoPath = requireActiveRepo(activeRepoPath);
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
        toast.error(options.failureTitle, { description: errorMessage(error) });
        throw error;
      }
    },
    [activeRepoPath, refreshTaskMutationViews],
  );

  return { refreshTaskMutationViews, runTaskMutation };
}
