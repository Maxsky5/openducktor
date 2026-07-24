import { type MutableRefObject, useCallback, useState } from "react";
import { toast } from "sonner";
import type { TaskRefreshOptions } from "@/state/app-state-contexts";
import { createTaskRefreshController, type TaskRefreshController } from "./task-refresh-controller";
import type { UseTaskReadFlowResult } from "./use-task-read-flow";

type UseTaskRefreshFlowArgs = {
  activeRepoPath: string | null;
  refreshTaskData: UseTaskReadFlowResult["refreshTaskData"];
  lastTaskRefreshToastRef: MutableRefObject<{ repoPath: string; description: string } | null>;
  lastTaskLoadErrorToastRef: MutableRefObject<{ repoPath: string; description: string } | null>;
};

export type TaskRefreshFlow = {
  isManualLoadingTasks: boolean;
  setIsLoadingTasks: (value: boolean) => void;
  resetManualLoading: () => void;
  refreshTasksWithOptions: (options?: TaskRefreshOptions) => Promise<void>;
  refreshTasks: () => Promise<void>;
};

export function useTaskRefreshFlow({
  activeRepoPath,
  refreshTaskData,
  lastTaskRefreshToastRef,
  lastTaskLoadErrorToastRef,
}: UseTaskRefreshFlowArgs): TaskRefreshFlow {
  const [isManualLoadingTasks, setIsManualLoadingTasks] = useState(false);
  const [refreshController] = useState<TaskRefreshController>(() =>
    createTaskRefreshController({
      setIsManualLoading: setIsManualLoadingTasks,
      notificationPort: toast,
      lastTaskRefreshToastRef,
      lastTaskLoadErrorToastRef,
    }),
  );

  const refreshTasksWithOptions = useCallback(
    async (options?: TaskRefreshOptions): Promise<void> => {
      if (!activeRepoPath) {
        return;
      }

      await refreshController.refresh({
        repoPath: activeRepoPath,
        trigger: options?.trigger ?? "manual",
        refreshTaskData,
      });
    },
    [activeRepoPath, refreshController, refreshTaskData],
  );

  const refreshTasks = useCallback(async (): Promise<void> => {
    await refreshTasksWithOptions({ trigger: "manual" });
  }, [refreshTasksWithOptions]);

  const resetManualLoading = useCallback(() => {
    refreshController.resetManualLoading();
  }, [refreshController]);

  return {
    isManualLoadingTasks,
    setIsLoadingTasks: setIsManualLoadingTasks,
    resetManualLoading,
    refreshTasksWithOptions,
    refreshTasks,
  };
}
