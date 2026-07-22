import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { toast } from "sonner";
import { errorMessage } from "@/lib/errors";
import { refreshRepoTaskViewsAfterMutation } from "@/state/queries/task-view-sync";
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

  const refreshTaskMutationViews = useCallback(
    async (repoPath: string, strategy: TaskMutationRefreshStrategy): Promise<void> => {
      if (strategy.kind === "task") {
        await refreshRepoTaskViewsAfterMutation(queryClient, repoPath, {
          forceFreshTaskList: true,
          ignorePrimaryCancellation: true,
          taskDocumentStrategy: "refresh",
          taskIds: [strategy.taskId],
        });
        return;
      }

      if (strategy.kind === "remove-task") {
        await refreshRepoTaskViewsAfterMutation(queryClient, repoPath, {
          forceFreshTaskList: true,
          ignorePrimaryCancellation: true,
          taskDocumentStrategy: "remove",
          taskIds: strategy.taskIds,
        });
        return;
      }

      await refreshRepoTaskViewsAfterMutation(queryClient, repoPath, {
        forceFreshTaskList: true,
        ignorePrimaryCancellation: true,
      });
    },
    [queryClient],
  );

  const runTaskMutation = useCallback(
    async (options: RunTaskMutationOptions): Promise<void> => {
      try {
        const repoPath = requireActiveRepo(activeRepoPath);
        await options.run(repoPath);
        await refreshTaskMutationViews(repoPath, options.refreshStrategy);
        if (options.successTitle) {
          toast.success(options.successTitle, { description: options.successDescription });
        }
      } catch (error) {
        toast.error(options.failureTitle, { description: errorMessage(error) });
        throw error;
      }
    },
    [activeRepoPath, refreshTaskMutationViews],
  );

  return { refreshTaskMutationViews, runTaskMutation };
}
